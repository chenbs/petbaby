#!/usr/bin/env sh
# 官网发布：拉代码 → 构建 → 原子切换 → 校验 → 清理旧版本。
# 用法：./deploy/scripts/release-website.sh [staging|production]
#
# 与 platform 的发布完全解耦：**不碰 Docker、不重启容器、不跑数据库迁移**。
# 官网改一行文案不该让应用停一下（方案 1 章第 2 条）。
#
# 开关（都是为了出问题时能缩小范围，正常发布一个都不用加）：
#   SKIP_PULL=1     不拉代码，只重新构建当前工作区
#   SKIP_VERIFY=1   跳过发布后校验（不建议：死链与缺图只有这一步能发现）
#   WEBSITE_ROOT=…  改部署根目录，默认 /srv/petbaby-website
#   SITE_URL=…      覆盖构建时的站点域名（canonical / sitemap / robots 的基准）
#   KEEP_RELEASES=n 保留几个历史版本供回滚，默认 5
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"

WEBSITE_DIR="$REPO_DIR/apps/website"
ROOT=${WEBSITE_ROOT:-/srv/petbaby-website}
KEEP=${KEEP_RELEASES:-5}

[ -d "$WEBSITE_DIR" ] || fail "找不到 $WEBSITE_DIR"

# 域名优先级：显式 SITE_URL > 环境变量文件里的 WEBSITE_URL > 报错。
# 不给默认值：canonical 与 sitemap 用错域名比构建失败更难发现（搜索引擎会
# 按错域名索引，而页面本身完全正常）。
if [ -n "${SITE_URL:-}" ]; then
  :
elif [ -f "$ENV_FILE" ] && [ -n "$(env_value WEBSITE_URL)" ]; then
  SITE_URL=$(env_value WEBSITE_URL)
else
  fail "缺少站点域名。在 $ENV_FILE 里加 WEBSITE_URL=https://your-domain，或 SITE_URL=… $0 $MODE"
fi
export SITE_URL

STARTED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
BEFORE=""

# ── 1. 拉代码 ────────────────────────────────────────────────────────────────
# 与 release.sh 同一套处理：不检查工作区是否干净（部署机上 chmod +x 这类权限位
# 变更也会被 git 记成改动，拦住发布得不偿失），拉取用 --ff-only。
if [ "${SKIP_PULL:-0}" = "1" ]; then
  warn "SKIP_PULL=1，使用当前工作区代码，不拉取远端"
elif ! command -v git >/dev/null 2>&1; then
  warn "未找到 git，跳过拉取"
elif [ ! -d "$REPO_DIR/.git" ]; then
  warn "$REPO_DIR 不是 git 仓库，跳过拉取"
else
  BEFORE=$(git_at rev-parse --short HEAD)
  log "拉取远端代码（当前 $BEFORE）"
  if ! git_at pull --ff-only; then
    echo >&2
    warn "拉取失败。常见原因与处理："
    echo "  · 本地文件有改动挡住了合并 —— 部署机上多半是 chmod 造成的权限位差异。" >&2
    echo "    一次性关掉权限位跟踪即可根治：(cd $REPO_DIR && git config core.fileMode false)" >&2
    echo "  · 只想用当前工作区代码发布：SKIP_PULL=1 $0 $MODE" >&2
    fail "已停在拉取步骤，未做任何部署动作。"
  fi
  AFTER=$(git_at rev-parse --short HEAD)
  if [ "$BEFORE" = "$AFTER" ]; then
    log "代码已是最新（$AFTER），仍继续重新构建"
  else
    log "代码更新：$BEFORE → $AFTER"
    git_at log --oneline "$BEFORE..$AFTER" | head -20
  fi
fi

# ── 2. 素材三处同步检查 ──────────────────────────────────────────────────────
# 真源在 tools/imagegen/out/website/，原型与官网各存一份副本（方案 2 章）。
# 只报差异不自动同步：哪份是新的只有人知道，脚本猜错会把新图覆盖成旧图。
SRC_ASSETS="$REPO_DIR/tools/imagegen/out/website"
WEB_ASSETS="$WEBSITE_DIR/public/assets"
PROTO_ASSETS="$REPO_DIR/docs/website/prototype/assets"
if [ -d "$SRC_ASSETS" ]; then
  for f in "$SRC_ASSETS"/*.jpg; do
    [ -f "$f" ] || continue
    name=$(basename "$f")
    if [ ! -f "$WEB_ASSETS/$name" ]; then
      warn "素材 $name 在真源里有、官网 public/assets 里没有"
    elif ! cmp -s "$f" "$WEB_ASSETS/$name"; then
      warn "素材 $name 与真源 tools/imagegen/out/website/ 不一致"
    fi
    if [ -f "$PROTO_ASSETS/$name" ] && ! cmp -s "$f" "$PROTO_ASSETS/$name"; then
      warn "素材 $name 与原型 docs/website/prototype/assets/ 不一致"
    fi
  done
fi

# ── 3. 构建 ─────────────────────────────────────────────────────────────────
command -v pnpm >/dev/null 2>&1 || fail "未找到 pnpm，请先安装 pnpm 10.13.1"
command -v node >/dev/null 2>&1 || fail "未找到 node，Astro 7 要求 ≥22.12.0（且不支持奇数大版本）"

NODE_MAJOR=$(node -p 'process.versions.node.split(".")[0]')
NODE_MINOR=$(node -p 'process.versions.node.split(".")[1]')
if [ "$NODE_MAJOR" -lt 22 ] || { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -lt 12 ]; }; then
  fail "Node $(node -v) 过低，Astro 7 要求 ≥22.12.0"
fi
if [ $((NODE_MAJOR % 2)) -eq 1 ]; then
  fail "Node $(node -v) 是奇数大版本，Astro 明确不支持（用 22.x 或 24.x）"
fi

# 本仓库不是 pnpm workspace，一律 cd 进目录执行，不能用 --filter（方案 8 章）
log "安装依赖并构建（SITE_URL=$SITE_URL）"
( cd "$WEBSITE_DIR" && pnpm install --frozen-lockfile && pnpm build )

[ -f "$WEBSITE_DIR/dist/index.html" ] || fail "构建产物里没有 index.html，构建可能失败了"

log "校验站内链接与 sitemap"
( cd "$WEBSITE_DIR" && pnpm check:links )

# ── 4. 原子切换 ─────────────────────────────────────────────────────────────
# 直接 rsync 到 current/ 会有几秒的半新半旧状态：用户可能拿到新 HTML + 旧 CSS。
# 切软链是瞬时的（rename 是原子操作），回滚也只是把软链指回上一个目录。
RELEASE_ID=$(date -u +%Y%m%d-%H%M%S)
RELEASE_DIR="$ROOT/releases/$RELEASE_ID"

log "部署到 $RELEASE_DIR"
mkdir -p "$ROOT/releases"
rm -rf "$RELEASE_DIR"
cp -a "$WEBSITE_DIR/dist" "$RELEASE_DIR"

PREVIOUS=""
if [ -L "$ROOT/current" ]; then
  PREVIOUS=$(readlink "$ROOT/current" || true)
elif [ -e "$ROOT/current" ]; then
  # 不是软链却存在：可能是早期手工 rsync 上去的目录。不自动删 —— 那可能是
  # 唯一一份线上产物，删错就下线了。让人确认后自己挪走。
  fail "$ROOT/current 存在但不是软链。本脚本靠切软链做原子发布；请先备份并移除它：mv $ROOT/current $ROOT/current.bak"
fi

# 先建临时软链再 mv -T 覆盖。两点都要紧：
#   · ln -sfn 对「已存在且指向目录」的软链行为不一致 —— 有的实现会把新链建到
#     那个目录里面去（变成 current/current），而不是替换 current 本身。
#   · mv -T 是 rename(2)，原子替换；不带 -T 时若目标是软链，同样会往里面搬。
# 失败就直接失败，不做 rm 兜底：rm -f 删不掉目录（会静默留下旧版本继续对外服务，
# 而脚本照样报「发布完成」），rm -rf 又有删错线上产物的风险。
rm -f "$ROOT/current.tmp"
ln -s "$RELEASE_DIR" "$ROOT/current.tmp" || fail "无法创建软链 $ROOT/current.tmp"
mv -T "$ROOT/current.tmp" "$ROOT/current" \
  || fail "软链切换失败。$ROOT/current 的当前状态：$(ls -ld "$ROOT/current" 2>&1)"

# 切换必须真的生效：mv 成功但 current 指向别处（或根本不是软链）时，
# 下面的校验会去请求线上地址，而线上还是旧版本 —— 那种「发布完成」是假的。
[ -L "$ROOT/current" ] || fail "切换后 $ROOT/current 不是软链，发布未生效"
ACTUAL=$(readlink "$ROOT/current")
[ "$ACTUAL" = "$RELEASE_DIR" ] || fail "切换后 current 指向 $ACTUAL，不是本次的 $RELEASE_DIR"
log "current → $RELEASE_DIR"

# ── 5. 发布后校验 ───────────────────────────────────────────────────────────
if [ "${SKIP_VERIFY:-0}" = "1" ]; then
  warn "SKIP_VERIFY=1，跳过发布后校验 —— 首页、文章列表与素材是否真能取到就没验"
else
  log "校验线上产物"
  BASE=${SITE_URL%/}
  for pth in / /blog/ /legal/terms/ /sitemap-index.xml /robots.txt /llms.txt /rss.xml; do
    if curl -fsS --max-time 15 -o /dev/null "$BASE$pth"; then
      echo "  ✓ $pth"
    else
      fail "取不到 $BASE$pth。请确认 DNS、证书、Nginx server_name 与 root 指向 $ROOT/current"
    fi
  done

  # 素材抽查：官网的图不在任何容器里，靠 public/assets 直接进产物 ——
  # 但 Nginx 的 root 指错时首页仍可能从缓存返回，只有取字节才暴露。
  for asset in /assets/bg-poster.jpg /assets/play-id-card.jpg /assets/work-golden.jpg; do
    curl -fsS --max-time 20 -o /dev/null "$BASE$asset" \
      && echo "  ✓ $asset" \
      || fail "取不到素材 $BASE$asset"
  done

  # sitemap 要能解析且域名与站点一致 —— 域名写错时 sitemap 照样是合法 XML，
  # 只有比对 origin 才能发现（canonical 与 sitemap 逐字一致是硬要求）。
  SITEMAP=$(curl -fsS --max-time 15 "$BASE/sitemap-index.xml")
  echo "$SITEMAP" | grep -q "<sitemapindex" || fail "sitemap-index.xml 不是合法的 sitemap"
  echo "$SITEMAP" | grep -q "$BASE" || fail "sitemap 里的域名与 $BASE 不一致，canonical 会分叉"
  echo "  ✓ sitemap 可解析且域名一致"

  # 404 必须真的返回 404 状态码，不能是 200 —— error_page 配错时页面看着对，
  # 但搜索引擎会把它当成一个正常页面收录。
  CODE=$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE/this-path-should-not-exist/")
  [ "$CODE" = "404" ] || warn "不存在的路径返回 $CODE 而不是 404，检查 Nginx 的 error_page 与 try_files"
fi

# ── 6. 清理旧版本 ───────────────────────────────────────────────────────────
if [ -d "$ROOT/releases" ]; then
  COUNT=$(ls -1 "$ROOT/releases" | wc -l | tr -d ' ')
  if [ "$COUNT" -gt "$KEEP" ]; then
    log "清理旧版本（保留最近 $KEEP 个，共 $COUNT 个）"
    ls -1 "$ROOT/releases" | sort | head -n "$((COUNT - KEEP))" | while read -r old; do
      # 别删掉 current 正指着的那个
      [ "$ROOT/releases/$old" = "$PREVIOUS" ] && continue
      [ "$old" = "$RELEASE_ID" ] && continue
      rm -rf "$ROOT/releases/$old"
      echo "  已删除 $old"
    done
  fi
fi

echo
log "官网发布完成：$SITE_URL"
echo "    开始于 $STARTED_AT，当前提交 $(git_at rev-parse --short HEAD 2>/dev/null || echo '未知')"
echo
echo "回滚（切软链，瞬时生效，不需要重新构建）："
if [ -n "$PREVIOUS" ]; then
  echo "  ln -sfn $PREVIOUS $ROOT/current.tmp && mv -Tf $ROOT/current.tmp $ROOT/current"
else
  echo "  ls $ROOT/releases   # 挑一个版本后同上切软链"
fi
echo "  历史版本在 $ROOT/releases/（保留最近 $KEEP 个）"
