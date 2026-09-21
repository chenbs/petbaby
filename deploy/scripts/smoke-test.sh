#!/usr/bin/env sh
# 主链路冒烟测试：注册 → 建档 → 上传 → 生成 → 解锁 → 分享 → 清理。
# 在 Compose 网络内直连 web:3000 执行，会真实写入数据库和对象存储，结束时软删除测试账号。
# 用法：./deploy/scripts/smoke-test.sh [staging|production]
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
require_docker

log "在 Compose 网络内执行冒烟测试"
compose run --rm --no-deps -T --entrypoint sh web -c 'pnpm exec tsx scripts/smoke.ts http://web:3000'

# 样例图单独查一遍：它们不在镜像里，靠 seed-samples.sh 灌进卷，
# 漏灌时 /api/plugins 照样返回 200（manifest 里只是路径字符串），
# 只有真去取字节才会暴露 404 —— 端上表现是入口图裂开，不报任何错。
log "校验玩法样例图可下发"
compose run --rm --no-deps -T --entrypoint sh web -c '
set -eu
urls=$(wget -qO- http://web:3000/api/plugins \
  | tr "," "\n" | grep -o "/api/plugin-samples/[^\"]*" | sort -u)
[ -n "$urls" ] || { echo "[fail] /api/plugins 没有任何样例图路径，registry.ts 的 samples 字段是否丢了？" >&2; exit 1; }
total=0; bad=0
for path in $urls; do
  total=$((total + 1))
  # 看退出码而非解析响应头：容器是 alpine，busybox wget 的 -S 输出格式与 GNU 不同，
  # 解析头部容易在不同基础镜像上失配。取不到字节就非 0，这个判断跨实现都成立。
  if wget -q -O /dev/null "http://web:3000$path"; then :; else
    echo "  ✗ 取不到 $path" >&2; bad=$((bad + 1))
  fi
done
echo "  样例图 $total 张，失败 $bad 张"
[ "$bad" = "0" ] || { echo "[fail] 有样例图取不到字节，请执行 deploy/scripts/seed-samples.sh" >&2; exit 1; }
'

log "冒烟测试结束"
