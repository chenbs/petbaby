#!/usr/bin/env sh
# 创建运营后台管理员账号（或给已有账号重设密码），写入 ADMIN_USER_IDS 并重启 web/worker。
# 用法：./deploy/scripts/create-admin.sh <账号名> [staging|production]
#
# 2026-10-11 起后台用独立的账号密码登录（/admin/login），正式生产同样可用；
# 小程序与 H5 用户仍只有微信账号，没有账号密码注册入口。密码交互输入，不出现在命令行与 shell 历史里。
# 已有的微信用户也可以直接加白名单：传用户 ID（UUID）时只写白名单、不创建账号（该用户无法登录 Web 后台）。
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

ACCOUNT=${1:-}
resolve_mode "${2:-}"
require_env_file
require_docker

[ -n "$ACCOUNT" ] || fail "用法：$0 <账号名> [staging|production]"
UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'

if echo "$ACCOUNT" | grep -Eq "$UUID_PATTERN"; then
  USER_ID=$ACCOUNT
else
  # 与后端一致的账号名规则；脚本不拼 SQL，账号名只作为参数传给容器里的 Node 脚本。
  echo "$ACCOUNT" | grep -Eq '^[a-zA-Z][a-zA-Z0-9._-]{2,31}$' || fail "账号名格式不正确：$ACCOUNT（字母开头，3-32 位）"
  printf '为 %s 设置后台登录密码（至少 10 位，含字母和数字）：' "$ACCOUNT" >&2
  stty -echo 2>/dev/null || true
  IFS= read -r PASSWORD
  stty echo 2>/dev/null || true
  printf '\n再输入一次：' >&2
  stty -echo 2>/dev/null || true
  IFS= read -r PASSWORD_CONFIRM
  stty echo 2>/dev/null || true
  printf '\n' >&2
  [ "$PASSWORD" = "$PASSWORD_CONFIRM" ] || fail "两次输入的密码不一致"
  # 密码经标准输入传进容器，不进环境变量与进程参数
  OUTPUT=$(printf '%s\n' "$PASSWORD" | compose exec -T web pnpm --silent admin:account "$ACCOUNT")
  unset PASSWORD PASSWORD_CONFIRM
  USER_ID=$(printf '%s\n' "$OUTPUT" | sed -n 's/^ADMIN_USER_ID=//p' | tr -d '\r' | head -n 1)
fi

echo "$USER_ID" | grep -Eq "$UUID_PATTERN" || fail "没有拿到合法的用户 ID：$USER_ID"

CURRENT=$(env_value ADMIN_USER_IDS)
if echo ",$CURRENT," | grep -q ",$USER_ID,"; then
  log "$ACCOUNT（$USER_ID）已经在管理员白名单中；如果刚重设了密码，已经生效"
  exit 0
fi

if [ -n "$CURRENT" ]; then
  set_env ADMIN_USER_IDS "$CURRENT,$USER_ID"
else
  set_env ADMIN_USER_IDS "$USER_ID"
fi
log "已写入 ADMIN_USER_IDS：$ACCOUNT → $USER_ID"

log "重启 web 与 worker 以加载新环境变量"
compose up -d web worker
log "完成。打开 $(env_value PUBLIC_APP_URL)/admin/login 用该账号登录"
