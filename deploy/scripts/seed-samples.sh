#!/usr/bin/env sh
# 把 tools/imagegen/out 下的样例图灌进对象存储卷。
# 用法：./deploy/scripts/seed-samples.sh [staging|production]
#
# 为什么需要这一步：registry.ts 里的 samples 路径带内容哈希，指向对象存储中的
# samples/<名字>-<哈希>.jpg。这些字节**不在镜像里**——构建上下文是 apps/platform，
# 而素材在仓库根的 tools/imagegen/out。不灌就是首页与玩法入口图全部 404，
# 小程序端表现为大面积裂图（`<image>` 拿不到字节不会有任何报错）。
#
# 幂等：键名由内容哈希决定，重复执行只是覆盖同名文件。
set -eu

. "$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)/lib.sh"

resolve_mode "${1:-}"
require_env_file
require_docker

PLUGINS_DIR="$REPO_DIR/tools/imagegen/out/plugins"
STYLES_DIR="$REPO_DIR/tools/imagegen/out/styles"
IMAGE_ASSET_MANIFEST="$REPO_DIR/tools/imagegen/out/reference-v1/deploy-assets.tsv"
RETIRED_IMAGE_KEYS="$REPO_DIR/tools/imagegen/out/reference-v1/retired-storage-keys.txt"
[ -d "$PLUGINS_DIR" ] || fail "缺少 $PLUGINS_DIR，请先在有凭据的机器上执行 node tools/imagegen/generate.mjs plugins"

WEB_CONTAINER=$(compose ps -q web)
[ -n "$WEB_CONTAINER" ] || fail "web 容器未运行，请先执行：$SCRIPT_DIR/deploy.sh $MODE"

# 先在宿主机把文件按内容哈希摆成对象存储的键名布局，再整目录拷进容器。
# 逐个 docker cp 会慢且容易半途失败，摆好再拷是一次原子性更强的操作。
STAGE_DIR=$(mktemp -d)
trap 'rm -rf "$STAGE_DIR"' EXIT
mkdir -p "$STAGE_DIR/samples"

sha256_of() {
  if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | cut -d ' ' -f1
  else shasum -a 256 "$1" | cut -d ' ' -f1; fi
}

hash_of() {
  sha256_of "$1" | cut -c1-12
}

count=0
put() {
  src=$1; base=$2
  digest=$(hash_of "$src")
  target="$STAGE_DIR/samples/$base-$digest.jpg"
  cp "$src" "$target"
  # .meta 旁文件是 LocalObjectStorage 的约定，缺了它 get() 会连正文一起判为不存在
  printf '{"contentType":"image/jpeg"}' > "$target.meta"
  count=$((count + 1))
}

for file in "$PLUGINS_DIR"/*.jpg; do
  [ -f "$file" ] || continue
  name=$(basename "$file" .jpg)
  put "$file" "$name"
done

if [ -d "$STYLES_DIR" ]; then
  for file in "$STYLES_DIR"/style-*.jpg; do
    [ -f "$file" ] || continue
    name=$(basename "$file" .jpg)
    put "$file" "$name"
  done
fi

# 自有冻结母版供运行时图生图使用。第三方效果图不在这里，也不进入对象存储。
# 键名与 apps/platform/src/server/image-template-registry.ts 一一对应。这里只灌入
# 已获用户批准的自有冻结母版，不包含主人身份原图或第三方效果参考图。
[ -f "$IMAGE_ASSET_MANIFEST" ] || fail "缺少 $IMAGE_ASSET_MANIFEST，请先运行 node tools/imagegen/promote-frozen-master-remediation-20260819.mjs"
template_count=0
preview_count=0
while IFS="$(printf '\t')" read -r asset_kind storage_key source_path expected_sha256; do
  [ -n "$asset_kind" ] || continue
  case "$asset_kind" in \#*) continue ;; esac
  case "$asset_kind" in master|preview) ;; *) fail "未知图片资产类型：$asset_kind" ;; esac
  case "$storage_key" in samples/image-templates/*|samples/image-template-previews/*) ;; *) fail "图片对象键越界：$storage_key" ;; esac
  src="$REPO_DIR/$source_path"
  [ -f "$src" ] || fail "缺少图片资产 $src"
  actual_sha256=$(sha256_of "$src")
  [ "$actual_sha256" = "$expected_sha256" ] || fail "图片资产哈希不一致：$source_path"
  target="$STAGE_DIR/$storage_key"
  mkdir -p "$(dirname "$target")"
  cp "$src" "$target"
  printf '{"contentType":"image/webp"}' > "$target.meta"
  if [ "$asset_kind" = "master" ]; then template_count=$((template_count + 1))
  else preview_count=$((preview_count + 1)); fi
done < "$IMAGE_ASSET_MANIFEST"
[ "$template_count" = "76" ] || fail "冻结母版数量错误：$template_count/76"
[ "$preview_count" = "76" ] || fail "公开展示图数量错误：$preview_count/76"

# 宠物小岛素材（22 号文 5.3、24 号文 7.4）。
#
# **不能像上面那样按裸文件名 + 内容哈希直接灌**：岛素材要先抠品红底、按槽位裁切，
# 而那两步只有 tools/imagegen/upload-island.mjs 会做 —— out/island/ 里躺的是人工
# 投放的原图（品红底、尺寸未裁），直接灌进去等于给端上一张带品红背景的图。
# 而且需要 alpha 的槽位输出 PNG，上面的 put() 写死 .jpg + image/jpeg 也不对。
#
# 所以约定：在有 sharp 的机器上先跑
#   node tools/imagegen/upload-island.mjs --stage tools/imagegen/out/island/staged
# 它会按最终对象键布局（samples/island/<名字>-<哈希>.<ext> + .meta）摆好文件，
# 这里整目录拷进暂存区即可。缺这一步时只提示不失败：素材清单为空是正式状态，
# 端上走「素材未就绪」路径（纯色底 + 立绘），功能可用。
ISLAND_STAGED="$REPO_DIR/tools/imagegen/out/island/staged/samples/island"
if [ -d "$ISLAND_STAGED" ]; then
  mkdir -p "$STAGE_DIR/samples/island"
  island_count=0
  for file in "$ISLAND_STAGED"/*; do
    [ -f "$file" ] || continue
    cp "$file" "$STAGE_DIR/samples/island/"
    # .meta 旁文件不计入张数，它是每张图的伴生文件
    case "$file" in *.meta) ;; *) island_count=$((island_count + 1)) ;; esac
  done
  log "岛素材 $island_count 张已并入暂存目录"
else
  warn "未找到 $ISLAND_STAGED —— 岛素材不会被灌入。"
  echo "        素材到齐后请在有 sharp 的机器上执行：" >&2
  echo "        node tools/imagegen/upload-island.mjs --stage tools/imagegen/out/island/staged" >&2
  echo "        （清单为空是正式状态，端上走「素材未就绪」路径，不影响其余功能）" >&2
fi

log "已在暂存目录摆好 $count 张插件样例图、$template_count 张冻结母版和 $preview_count 张公开展示图，开始写入 object-data 卷"
# 目标目录必须先建：应用只在写对象时才 mkdir，全新机器上 samples/ 还不存在，
# 而 docker cp 到不存在的目录会直接失败。
docker exec -u root "$WEB_CONTAINER" mkdir -p /app/.data/objects/samples
if [ -f "$RETIRED_IMAGE_KEYS" ]; then
  while IFS= read -r storage_key; do
    [ -n "$storage_key" ] || continue
    case "$storage_key" in samples/image-templates/*|samples/image-template-previews/*) ;; *) fail "退役对象键越界：$storage_key" ;; esac
    docker exec -u root "$WEB_CONTAINER" rm -f "/app/.data/objects/$storage_key" "/app/.data/objects/$storage_key.meta"
  done < "$RETIRED_IMAGE_KEYS"
fi
docker cp "$STAGE_DIR/samples/." "$WEB_CONTAINER:/app/.data/objects/samples/"

# 容器里的应用以 nextjs 用户运行，docker cp 进去的文件属主是 root，
# 只读不受影响，但后续同名覆盖会失败，所以显式改回去。
docker exec -u root "$WEB_CONTAINER" chown -R nextjs:nodejs /app/.data/objects/samples

log "完成。抽查一张："
# 只挑普通文件：samples/ 下现在还有 island/ 子目录（岛素材），
# 挑中目录会让下面的 ls -l 与 curl 提示都指向一个不存在的对象键。
SAMPLE=$(find "$STAGE_DIR/samples" -maxdepth 1 -type f ! -name '*.meta' -exec basename {} \; | head -1)
docker exec "$WEB_CONTAINER" sh -c "ls -l /app/.data/objects/samples/$SAMPLE"
echo
echo "验证下发（应为 200 与 image/jpeg）："
echo "  curl -sI $(env_value PUBLIC_APP_URL)/api/plugin-samples/samples/$SAMPLE | head -3"
echo
echo "注意：registry.ts 里的哈希必须与这里算出的一致。"
echo "换过图但没更新 registry.ts 时，下发的仍是旧键 —— 此时请在本机执行："
echo "  node tools/imagegen/upload-samples.mjs   # 打印新的 manifest 片段"
