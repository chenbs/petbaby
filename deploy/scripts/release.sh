#!/usr/bin/env sh
# 日常发布：拉代码 → 备份 → 构建迁移启动 → 灌样例图 → 健康检查 → 冒烟测试。
# 用法：./deploy/scripts/release.sh [staging|production]
#
# 这是更新已部署环境的唯一入口。首次部署用 bootstrap.sh（它会先生成环境变量）。
#
# 开关（都是为了出问题时能缩小范围，正常发布一个都不用加）：
#   SKIP_PULL=1    不拉代码，只重新部署当前工作区
#   SKIP_BACKUP=1  跳过发布前备份（迁移是单向的，不建议跳）
#   SKIP_SMOKE=1   跳过冒烟测试（它会真实写库并在结束时软删除测试账号）
#   SKIP_BUILD=1   跳过镜像构建，直接用现有标签（回滚时用）
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
require_docker

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BEFORE=""

# ── 1. 拉代码 ────────────────────────────────────────────────────────────────
# 不检查工作区是否干净：部署机上 chmod +x 这类权限位变更也会被 git 记成改动，
# 拦住发布得不偿失。拉取用 --ff-only，真有冲突时 git 自己会拒绝并保留现场。
if [ "${SKIP_PULL:-0}" = "1" ]; then
  warn "SKIP_PULL=1，使用当前工作区代码，不拉取远端"
elif ! command -v git >/dev/null 2>&1; then
  warn "未找到 git，跳过拉取"
elif [ ! -d "$REPO_DIR/.git" ]; then
  warn "$REPO_DIR 不是 git 仓库，跳过拉取"
else
  git_at rev-parse --git-dir >/dev/null 2>&1 || fail "在 $REPO_DIR 执行 git 失败。git 版本：$(git --version 2>&1 | head -1)"
  BEFORE=$(git_at rev-parse --short HEAD)
  log "拉取远端代码（当前 $BEFORE）"
  if ! git_at pull --ff-only; then
    echo >&2
    warn "拉取失败。常见原因与处理："
    echo "  · 本地文件有改动挡住了合并 —— 部署机上多半是 chmod 造成的权限位差异。" >&2
    echo "    一次性关掉权限位跟踪即可根治：(cd $REPO_DIR && git config core.fileMode false)" >&2
    echo "    确认没有真实改动要保留时，也可以丢弃：(cd $REPO_DIR && git checkout -- .)" >&2
    echo "  · 本地有提交导致无法快进 —— 用 git log --oneline HEAD..@{u} 看差异后自行取舍。" >&2
    echo "  · 只想用当前工作区代码发布：SKIP_PULL=1 $0 $MODE" >&2
    fail "已停在拉取步骤，未做任何部署动作。"
  fi
  AFTER=$(git_at rev-parse --short HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    log "代码已是最新（$AFTER），仍继续重新部署"
  else
    log "代码更新：$BEFORE → $AFTER"
    git_at log --oneline "$BEFORE..$AFTER" | head -20
  fi
fi

# ── 2. 发布前备份 ────────────────────────────────────────────────────────────
# 迁移是单向的（没有 down 脚本），出问题只能靠备份回去，所以默认先备。
if [ "${SKIP_BACKUP:-0}" = "1" ]; then
  warn "SKIP_BACKUP=1，跳过发布前备份"
elif [ -z "$(compose ps -q db 2>/dev/null)" ]; then
  log "数据库容器未运行（首次发布），跳过备份"
else
  log "发布前备份"
  "$SCRIPT_DIR/backup.sh" "$MODE"
fi

# ── 3. 构建 + 迁移 + 启动（内含 preflight）────────────────────────────────────
"$SCRIPT_DIR/deploy.sh" "$MODE"

# ── 4. 灌样例图 ──────────────────────────────────────────────────────────────
# 素材不在镜像里（构建上下文是 apps/platform，素材在仓库根的 tools/imagegen/out），
# 每次都灌一遍：键名由内容哈希决定，没换图时就是覆盖同名文件，代价是 13 个小文件的 cp。
# 换了图或卷被 down -v 重建过时，这一步是唯一能补上字节的地方。
"$SCRIPT_DIR/seed-samples.sh" "$MODE"

# ── 5. 健康检查 ──────────────────────────────────────────────────────────────
"$SCRIPT_DIR/health-check.sh" "$MODE"

# ── 6. 冒烟测试（含样例图逐张取字节）────────────────────────────────────────
if [ "${SKIP_SMOKE:-0}" = "1" ]; then
  warn "SKIP_SMOKE=1，跳过冒烟测试 —— 样例图是否真能取到字节也就没验"
else
  "$SCRIPT_DIR/smoke-test.sh" "$MODE"
fi

echo
log "发布完成：$(env_value PUBLIC_APP_URL)"
echo "    开始于 $STARTED_AT，当前提交 $(git_at rev-parse --short HEAD 2>/dev/null || echo '未知')"
echo
echo "出问题时："
echo "  $SCRIPT_DIR/logs.sh $MODE web              # 看日志"
echo "  $SCRIPT_DIR/health-check.sh $MODE          # 单独复查健康"
if [ -n "$BEFORE" ]; then
  echo "  代码回滚：(cd $REPO_DIR && git checkout $BEFORE) && SKIP_PULL=1 $0 $MODE"
fi
echo "  数据回滚：$SCRIPT_DIR/restore.sh <db备份.sql.gz> [objects备份.tar.gz] $MODE"
echo "            迁移是单向的（无 down 脚本），改过库结构后只能靠备份回去；恢复前先停 web/worker。"
echo "            备份在 $DEPLOY_DIR/backups/，本次发布前那份是最新的一对。"
