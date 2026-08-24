#!/usr/bin/env sh
# 生成 deploy/.env.<mode>：写入域名并随机生成所有本地可生成的密钥。
# 用法：./deploy/scripts/gen-env.sh <域名> [ACME 邮箱] [staging|production]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

DOMAIN=${1:-}
EMAIL=${2:-}
resolve_mode "${3:-}"

[ -n "$DOMAIN" ] || fail "用法：$0 <域名> [ACME 邮箱] [staging|production]"
echo "$DOMAIN" | grep -Eq '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$' || fail "域名格式不正确：$DOMAIN"
[ -f "$ENV_EXAMPLE" ] || fail "缺少模板：$ENV_EXAMPLE"

if [ -f "$ENV_FILE" ] && [ "${FORCE:-0}" != "1" ]; then
  fail "$ENV_FILE 已存在。要重新生成请先备份，然后执行：FORCE=1 $0 $DOMAIN"
fi

cp "$ENV_EXAMPLE" "$ENV_FILE"
chmod 600 "$ENV_FILE"

DB_PASSWORD=$(random_hex 24)
DB_USER=$(env_value POSTGRES_USER)
DB_NAME=$(env_value POSTGRES_DB)
[ -n "$DB_USER" ] || DB_USER=petbaby
[ -n "$DB_NAME" ] || DB_NAME=petbaby

set_env PETBABY_DOMAIN "$DOMAIN"
set_env PUBLIC_APP_URL "https://$DOMAIN"
set_env ACME_EMAIL "${EMAIL:-admin@$DOMAIN}"
set_env POSTGRES_USER "$DB_USER"
set_env POSTGRES_DB "$DB_NAME"
set_env POSTGRES_PASSWORD "$DB_PASSWORD"
set_env DATABASE_URL "postgresql://$DB_USER:$DB_PASSWORD@db:5432/$DB_NAME"
set_env SESSION_SECRET "$(random_hex 32)"
set_env WORKER_SECRET "$(random_hex 32)"
set_env ADDRESS_ENCRYPTION_KEY "$(random_hex 32)"
set_env PNPM_VERSION "10.13.1"
if [ "$MODE" = "staging" ]; then
  set_env NPM_REGISTRY "https://registry.npmmirror.com/"
else
  set_env NPM_REGISTRY "https://registry.npmjs.org/"
fi

if [ "$MODE" = "staging" ]; then
  INVITE_CODE=$(random_hex 6)
  set_env PASSWORD_AUTH_INVITE_CODE "$INVITE_CODE"
  set_env WECHAT_PAY_NOTIFY_URL "https://$DOMAIN/api/payments/wechat/notify"
  set_env WECHAT_REFUND_NOTIFY_URL "https://$DOMAIN/api/payments/wechat/notify"
fi

log "已生成 $ENV_FILE（权限 600，不进入版本库）"
log "域名：https://$DOMAIN"
if [ "$MODE" = "staging" ]; then
  log "注册邀请码：$INVITE_CODE"
  echo "    注册页面需要填写该邀请码，避免公网测试机被陌生人注册。"
  echo "    不想要邀请码：把 $ENV_FILE 里的 PASSWORD_AUTH_INVITE_CODE 清空后重新执行 deploy.sh。"
fi
echo "    数据库密码、SESSION_SECRET、WORKER_SECRET、ADDRESS_ENCRYPTION_KEY 已随机写入，请勿手工改动。"
echo "    下一步：$SCRIPT_DIR/deploy.sh $MODE"
