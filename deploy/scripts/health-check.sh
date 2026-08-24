#!/usr/bin/env sh
# 轮询 /api/health，要求 status=ok。
# 用法：./deploy/scripts/health-check.sh [staging|production]
#   或   ./deploy/scripts/health-check.sh https://petbaby.example.com
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

case "${1:-}" in
  http://*|https://*) BASE_URL=$1 ;;
  *)
    resolve_mode "${1:-}"
    require_env_file
    BASE_URL=$(env_value PUBLIC_APP_URL)
    ;;
esac

[ -n "$BASE_URL" ] || fail "无法确定站点地址，请传入 https://your-domain"
ATTEMPTS=${ATTEMPTS:-30}
i=1
while [ "$i" -le "$ATTEMPTS" ]; do
  body=$(curl -fsS --max-time 10 "${BASE_URL%/}/api/health" 2>/dev/null || true)
  if echo "$body" | grep -q '"status":"ok"'; then
    log "健康检查通过：${BASE_URL%/}/api/health"
    echo "$body"
    exit 0
  fi
  sleep 3
  i=$((i + 1))
done
fail "健康检查超时。请确认 DNS、宿主机 Nginx、80/443 端口和 web 容器状态，再查看 Nginx 错误日志与 deploy/scripts/logs.sh $MODE web"
