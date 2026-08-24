#!/usr/bin/env sh
# 全新测试机一键部署：生成环境变量 → 预检 → 构建部署 → 健康检查 → 主链路冒烟测试。
# 用法：./deploy/scripts/bootstrap.sh <域名> [ACME 邮箱]
# 已经生成过 deploy/.env.staging 时会直接复用，不会覆盖。
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

DOMAIN=${1:-}
EMAIL=${2:-}
resolve_mode staging

[ -n "$DOMAIN" ] || fail "用法：$0 <域名> [ACME 邮箱]"
require_docker

if [ -f "$ENV_FILE" ]; then
  log "复用已有环境变量文件 $ENV_FILE"
  CURRENT_DOMAIN=$(env_value PETBABY_DOMAIN)
  [ "$CURRENT_DOMAIN" = "$DOMAIN" ] || warn "$ENV_FILE 里的域名是 $CURRENT_DOMAIN，与参数 $DOMAIN 不一致；如需重建请执行 FORCE=1 $SCRIPT_DIR/gen-env.sh $DOMAIN"
else
  "$SCRIPT_DIR/gen-env.sh" "$DOMAIN" "$EMAIL" staging
fi

"$SCRIPT_DIR/deploy.sh" staging
# 样例图不在镜像里（构建上下文是 apps/platform，素材在仓库根的 tools/imagegen/out），
# 必须单独灌进 object-data 卷，否则首页与玩法入口图全部 404、小程序端大面积裂图。
"$SCRIPT_DIR/seed-samples.sh" staging
"$SCRIPT_DIR/health-check.sh" staging
"$SCRIPT_DIR/smoke-test.sh" staging

INVITE=$(env_value PASSWORD_AUTH_INVITE_CODE)
log "测试机就绪：https://$DOMAIN"
echo
echo "接下来手工完成三步："
echo "  1. 打开 https://$DOMAIN/login 注册一个账号${INVITE:+（邀请码：$INVITE）}"
echo "  2. 执行 $SCRIPT_DIR/create-admin.sh <刚注册的账号名> 拿到后台权限"
echo "  3. 小程序端把 apps/miniprogram/config.local.js 的 apiBaseUrl 指向 https://$DOMAIN"
echo
echo "常用运维命令："
echo "  $SCRIPT_DIR/logs.sh staging web       # 查看日志"
echo "  $SCRIPT_DIR/health-check.sh staging   # 健康检查"
echo "  $SCRIPT_DIR/smoke-test.sh staging     # 重新跑主链路"
echo "  $SCRIPT_DIR/seed-samples.sh staging   # 重灌样例图（换图后）"
echo "  $SCRIPT_DIR/backup.sh staging         # 备份数据库与对象文件"
echo
echo "以后更新代码不用再跑 bootstrap，一条即可（含备份、灌图与冒烟）："
echo "  $SCRIPT_DIR/release.sh staging"
