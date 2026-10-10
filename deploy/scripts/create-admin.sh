#!/usr/bin/env sh
# 把已注册账号加入后台管理员白名单（ADMIN_USER_IDS），并重启 web/worker 生效。
# 用法：./deploy/scripts/create-admin.sh <账号名|用户ID> [staging|production]
# 正式生产只有微信账号、没有账号名（2026-10-09），传用户 ID（后台「用户」页或数据库里查）。
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

ACCOUNT=${1:-}
resolve_mode "${2:-}"
require_env_file
require_docker

[ -n "$ACCOUNT" ] || fail "用法：$0 <账号名|用户ID> [staging|production]"
# 参数直接拼进 SQL，这里用与后端一致的白名单规则挡掉注入：UUID 或账号名二选一。
UUID_PATTERN='^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
if echo "$ACCOUNT" | grep -Eq "$UUID_PATTERN"; then
  LOOKUP="id='$ACCOUNT'"
else
  echo "$ACCOUNT" | grep -Eq '^[a-zA-Z][a-zA-Z0-9._-]{2,31}$' || fail "账号名或用户 ID 格式不正确：$ACCOUNT"
  LOOKUP="lower(account_name)=lower('$ACCOUNT')"
fi

DB_USER=$(env_value POSTGRES_USER)
DB_NAME=$(env_value POSTGRES_DB)
USER_ID=$(compose exec -T db psql -U "$DB_USER" -d "$DB_NAME" -tAc "SELECT id FROM users WHERE $LOOKUP AND deleted_at IS NULL" | tr -d '\r' | head -n 1)

[ -n "$USER_ID" ] || fail "数据库里没有账号 $ACCOUNT（生产请先用微信登录小程序，再传用户 ID）"
echo "$USER_ID" | grep -Eq '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' || fail "查询到的用户 ID 不是合法 UUID：$USER_ID"

CURRENT=$(env_value ADMIN_USER_IDS)
if echo ",$CURRENT," | grep -q ",$USER_ID,"; then
  log "$ACCOUNT（$USER_ID）已经在管理员白名单中"
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
log "完成。用该账号访问 $(env_value PUBLIC_APP_URL)/admin"
