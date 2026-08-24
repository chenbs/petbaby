#!/usr/bin/env sh
# 部署前检查：环境变量完整性、占位值、DNS 解析、端口占用、编排文件语法。
# 用法：./deploy/scripts/preflight.sh [staging|production]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
require_docker
check_host_compatibility

NODE_BASE_IMAGE=$(env_value NODE_BASE_IMAGE)
POSTGRES_IMAGE=$(env_value POSTGRES_IMAGE)
PNPM_VERSION=$(env_value PNPM_VERSION)
NPM_REGISTRY=$(env_value NPM_REGISTRY)
[ -n "$NODE_BASE_IMAGE" ] || NODE_BASE_IMAGE=node:22-alpine
[ -n "$POSTGRES_IMAGE" ] || POSTGRES_IMAGE=postgres:17-alpine
[ -n "$PNPM_VERSION" ] || PNPM_VERSION=10.13.1
if [ -z "$NPM_REGISTRY" ]; then
  [ "$MODE" = "staging" ] && NPM_REGISTRY=https://registry.npmmirror.com/ || NPM_REGISTRY=https://registry.npmjs.org/
fi

[ "$PNPM_VERSION" = "10.13.1" ] || warn "PNPM_VERSION=$PNPM_VERSION；当前锁文件和 packageManager 按 pnpm 10.13.1 维护"
if command -v curl >/dev/null 2>&1; then
  curl -fsSI --max-time 10 "$NPM_REGISTRY" >/dev/null 2>&1 || fail "无法访问 NPM_REGISTRY=$NPM_REGISTRY。请改用可访问的国内/企业 npm 镜像，例如 https://registry.npmmirror.com/"
fi

# 构建真正开始前预拉取基础镜像；docker pull 会使用 daemon.json 中的镜像加速器。
if ! docker image inspect "$NODE_BASE_IMAGE" >/dev/null 2>&1 && ! docker pull "$NODE_BASE_IMAGE" >/dev/null 2>&1; then
  fail "无法访问基础镜像 $NODE_BASE_IMAGE。请在 $ENV_FILE 设置 NODE_BASE_IMAGE 为可访问的国内/企业镜像地址，并先执行 docker pull $NODE_BASE_IMAGE"
fi
if ! docker image inspect "$POSTGRES_IMAGE" >/dev/null 2>&1 && ! docker pull "$POSTGRES_IMAGE" >/dev/null 2>&1; then
  fail "无法访问数据库镜像 $POSTGRES_IMAGE。请在 $ENV_FILE 设置 POSTGRES_IMAGE 为可访问的国内/企业镜像地址，并先执行 docker pull $POSTGRES_IMAGE"
fi

# 两种模式都必须具备：真实数据库、独立密钥、HTTPS 域名。
COMMON_REQUIRED="PETBABY_DOMAIN PUBLIC_APP_URL POSTGRES_DB POSTGRES_USER POSTGRES_PASSWORD DATABASE_URL SESSION_SECRET WORKER_SECRET ADDRESS_ENCRYPTION_KEY OBJECT_STORAGE_PROVIDER PAYMENT_PROVIDER"
# 只有正式生产强制要求微信与云存储凭据。
PRODUCTION_REQUIRED="ADMIN_USER_IDS WECHAT_APP_ID WECHAT_APP_SECRET WECHAT_MCH_ID WECHAT_PAY_KEY WECHAT_CERT_SERIAL WECHAT_MCH_PRIVATE_KEY WECHAT_PLATFORM_PUBLIC_KEY WECHAT_PAY_NOTIFY_URL WECHAT_REFUND_NOTIFY_URL OSS_ENDPOINT OSS_BUCKET OSS_ACCESS_KEY_ID OSS_ACCESS_KEY_SECRET STORAGE_REGION"

REQUIRED="$COMMON_REQUIRED"
[ "$MODE" = "production" ] && REQUIRED="$REQUIRED $PRODUCTION_REQUIRED"

for key in $REQUIRED; do
  value=$(env_value "$key")
  [ -n "$value" ] || fail "$key 尚未填写（$ENV_FILE）"
  if echo "$value" | grep -Eq 'replace-with|placeholder|example\.com'; then
    fail "$key 仍是模板占位值：$value"
  fi
done

for key in SESSION_SECRET WORKER_SECRET ADDRESS_ENCRYPTION_KEY; do
  length=$(env_value "$key" | tr -d '\n' | wc -c | tr -d ' ')
  [ "$length" -ge 32 ] || fail "$key 长度只有 $length，至少需要 32 位"
done

env_value DATABASE_URL | grep -q '^postgres' || fail "DATABASE_URL 必须是 PostgreSQL 连接串，禁止使用 PGlite"
env_value PUBLIC_APP_URL | grep -q '^https://' || fail "PUBLIC_APP_URL 必须是 HTTPS 地址"
[ "$(env_value NODE_ENV)" = "production" ] || fail "NODE_ENV 必须是 production"

APP_ENV_VALUE=$(env_value APP_ENV)
if [ "$MODE" = "staging" ]; then
  [ "$APP_ENV_VALUE" = "staging" ] || fail "staging 模式必须设置 APP_ENV=staging，否则本地磁盘存储与模拟支付会被拒绝"
  [ "$(env_value PASSWORD_AUTH_ENABLED)" = "true" ] || warn "PASSWORD_AUTH_ENABLED 不是 true，测试机将无法用账号密码登录"
  [ -n "$(env_value PASSWORD_AUTH_INVITE_CODE)" ] || warn "PASSWORD_AUTH_INVITE_CODE 为空，公网上任何人都能注册账号"
else
  [ "$APP_ENV_VALUE" != "staging" ] || fail "正式生产禁止 APP_ENV=staging（会放行本地磁盘存储和模拟支付）"
  [ "$(env_value OBJECT_STORAGE_PROVIDER)" != "local" ] || fail "正式生产禁止 OBJECT_STORAGE_PROVIDER=local"
  [ "$(env_value PAYMENT_PROVIDER)" = "wechat" ] || fail "正式生产 PAYMENT_PROVIDER 必须是 wechat"
fi

ALERT_URL=$(env_value ALERT_WEBHOOK_URL)
if [ -n "$ALERT_URL" ]; then
  echo "$ALERT_URL" | grep -q '^https://' || fail "ALERT_WEBHOOK_URL 只接受 HTTPS 地址"
fi

DOMAIN=$(env_value PETBABY_DOMAIN)
if [ "${SKIP_DNS_CHECK:-0}" != "1" ]; then
  RESOLVED=""
  if command -v getent >/dev/null 2>&1; then
    RESOLVED=$(getent ahostsv4 "$DOMAIN" 2>/dev/null | awk 'NR==1{print $1}' || true)
  fi
  if [ -z "$RESOLVED" ] && command -v nslookup >/dev/null 2>&1; then
    RESOLVED=$(nslookup "$DOMAIN" 2>/dev/null | awk '/^Address: /{print $2; exit}' || true)
  fi
  [ -n "$RESOLVED" ] || fail "$DOMAIN 无法解析，Let's Encrypt 证书会申请失败。确认 DNS A 记录已生效，或用 SKIP_DNS_CHECK=1 跳过"
  log "$DOMAIN 解析到 $RESOLVED —— 请确认这是本机的公网 IP"
fi

if command -v ss >/dev/null 2>&1; then
  for port in 80 443; do
    if ss -ltn 2>/dev/null | grep -q ":$port "; then
      docker ps --format '{{.Ports}}' | grep -q ":$port->" || log "端口 $port 已由宿主机反向代理或云负载均衡占用"
    fi
  done
fi

compose config --quiet
log "$MODE 预检通过"
