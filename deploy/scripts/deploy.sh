#!/usr/bin/env sh
# 构建镜像 → 启动数据库 → 执行迁移 → 更新 web/worker。
# 迁移失败时不会更新应用容器。
# 用法：./deploy/scripts/deploy.sh [staging|production]
#   SKIP_BUILD=1 跳过构建（回滚到已有镜像标签时使用）
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
"$SCRIPT_DIR/preflight.sh" "$MODE"

if [ "${SKIP_BUILD:-0}" = "1" ]; then
  log "跳过构建，使用镜像 $(env_value PETBABY_IMAGE)"
else
  log "构建应用镜像"
  compose build
fi

log "启动 PostgreSQL"
compose up -d db

log "执行数据库迁移"
compose run --rm migrate

log "更新应用容器"
compose up -d web worker

log "等待 web 健康检查通过"
WEB_CONTAINER=$(compose ps -q web)
[ -n "$WEB_CONTAINER" ] || fail "web 容器没有启动，请执行：$SCRIPT_DIR/logs.sh $MODE web"
state=""
i=1
while [ "$i" -le 40 ]; do
  state=$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$WEB_CONTAINER" 2>/dev/null || echo "")
  [ "$state" = "healthy" ] && break
  [ "$state" = "none" ] && break
  sleep 3
  i=$((i + 1))
done
case "$state" in
  healthy) ;;
  none) warn "web 容器没有健康检查定义，跳过等待" ;;
  *) fail "web 容器未进入 healthy 状态（当前 $state），请执行：$SCRIPT_DIR/logs.sh $MODE web" ;;
esac

log "部署完成：$(env_value PUBLIC_APP_URL)"
if [ "$MODE" = "staging" ]; then
  echo "    请确认宿主机 Nginx 已配置并 reload，随后执行："
  echo "      $SCRIPT_DIR/health-check.sh $MODE"
  echo "      $SCRIPT_DIR/smoke-test.sh $MODE"
else
  echo "    配置反向代理后验证 /api/health。"
fi
