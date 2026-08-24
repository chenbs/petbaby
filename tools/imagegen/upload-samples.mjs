/**
 * 把插件样图、风格图和获批冻结母版推进对象存储，并打印插件 registry 片段。
 *
 * 用法：
 *   node tools/imagegen/upload-samples.mjs                       推本地存储（.data/objects）
 *   LOCAL_STORAGE_DIR=/srv/objects node ... upload-samples.mjs    指定存储目录
 *
 * 打印的是站内相对路径，不含域名 —— 域名由 /api/plugins 出口按 PUBLIC_APP_URL 拼，
 * 见 apps/platform/src/app/api/plugins/route.ts。这样同一份 registry.ts 可跨环境复用。
 *
 * 只打印不自动改 registry.ts：样例图换代表运营决策（用户看到的入口图变了），
 * 应当走一次人工 review，而不是被脚本静默写入。
 *
 * 键名带内容哈希：/api/plugin-samples 对样例图下发 immutable 长缓存，
 * 换图必须换键，否则 CDN 与客户端会一直拿旧图。
 */
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const OUT = path.resolve(import.meta.dirname, "out", "plugins");
const STYLES_OUT = path.resolve(import.meta.dirname, "out", "styles");
const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const MASTERS_INDEX = path.resolve(import.meta.dirname, "out", "reference-v1", "masters", "index.json");
const PUBLIC_PREVIEWS_INDEX = path.resolve(import.meta.dirname, "out", "reference-v1", "public-previews", "index.json");
const STORAGE_DIR = process.env.LOCAL_STORAGE_DIR
  ? path.resolve(process.env.LOCAL_STORAGE_DIR)
  : path.resolve(import.meta.dirname, "../../apps/platform/.data/objects");

/** 落盘一张图并返回站内相对路径。键名带内容哈希，换图即换键。 */
async function push(body, baseName) {
  const digest = createHash("sha256").update(body).digest("hex").slice(0, 12);
  const key = `samples/${baseName}-${digest}.jpg`;
  const target = path.join(STORAGE_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  // .meta 旁文件是 LocalObjectStorage 的约定，缺了它 get() 会连正文一起判为不存在
  await writeFile(target, body);
  await writeFile(`${target}.meta`, JSON.stringify({ contentType: "image/jpeg" }), "utf8");
  console.log(`已推送 ${key}`);
  return `/api/plugin-samples/${key}`;
}

async function pushExact(body, key, contentType) {
  const target = path.join(STORAGE_DIR, key);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  await writeFile(`${target}.meta`, JSON.stringify({ contentType }), "utf8");
  console.log(`已推送 ${key}`);
}

const files = (await readdir(OUT).catch(() => [])).filter((name) => name.endsWith(".jpg"));
if (!files.length) throw new Error(`${OUT} 下没有图，请先跑 node tools/imagegen/generate.mjs plugins`);

const entries = [];
for (const name of files) {
  const pluginId = name.replace(/\.jpg$/, "");
  const url = await push(await readFile(path.join(OUT, name)), pluginId);
  entries.push({ pluginId, url });
}

/*
 * 风格对比图（out/styles/style-*.jpg）。文件名里的 id 必须与三处枚举一致：
 * growth-service 的 style enum、ai-create.js 的 STYLES、prompts.mjs 的 AI_STYLES。
 * 键名即 style id，端上按 id 取图，不依赖数组顺序 —— 顺序错位不会报错，只会静默配错风格。
 */
const styleFiles = (await readdir(STYLES_OUT).catch(() => [])).filter((name) => /^style-.+\.jpg$/.test(name));
const styleUrls = {};
for (const name of styleFiles.sort()) {
  const styleId = name.replace(/^style-/, "").replace(/\.jpg$/, "");
  styleUrls[styleId] = await push(await readFile(path.join(STYLES_OUT, name)), `style-${styleId}`);
}

/*
 * 图片模板运行时母版。唯一输入清单是已审批的 masters/index.json；主人身份原图、
 * 稳定性输出和第三方效果参考均不在这个索引里，因此不会被本地灌入脚本误发布。
 */
const masterIndex = JSON.parse(await readFile(MASTERS_INDEX, "utf8"));
if (masterIndex.status !== "approved-frozen-master-set" || !Array.isArray(masterIndex.templates)) {
  throw new Error(`${MASTERS_INDEX} 不是已批准冻结母版索引`);
}
for (const item of masterIndex.templates) {
  const source = path.resolve(REPO_ROOT, item.path);
  const body = await readFile(source);
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== item.sha256) throw new Error(`${item.templateId} 冻结母版哈希不一致`);
  const key = `samples/image-templates/${item.templateId}-${digest.slice(0, 12)}.webp`;
  await pushExact(body, key, "image/webp");
}


/*
 * 小程序公开展示图。与运行时母版使用不同对象键：即使尚未定制的模板暂时复用
 * 同一份图像字节，也不能让公开样图 API 暴露 masterStorageKey。
 */
const publicPreviewIndex = JSON.parse(await readFile(PUBLIC_PREVIEWS_INDEX, "utf8"));
if (publicPreviewIndex.status !== "approved-public-preview-set" || !Array.isArray(publicPreviewIndex.templates)) {
  throw new Error(`${PUBLIC_PREVIEWS_INDEX} 不是已批准公开样图索引`);
}
if (publicPreviewIndex.templates.length !== masterIndex.templates.length) {
  throw new Error(`公开样图与冻结母版数量不一致：${publicPreviewIndex.templates.length}/${masterIndex.templates.length}`);
}
for (const item of publicPreviewIndex.templates) {
  const source = path.resolve(REPO_ROOT, item.path);
  const body = await readFile(source);
  const digest = createHash("sha256").update(body).digest("hex");
  if (digest !== item.sha256) throw new Error(`${item.templateId} 公开样图哈希不一致`);
  if (!item.sampleStorageKey?.startsWith("samples/image-template-previews/")) {
    throw new Error(`${item.templateId} 公开样图对象键不合法`);
  }
  await pushExact(body, item.sampleStorageKey, "image/webp");
}

entries.sort((a, b) => a.pluginId.localeCompare(b.pluginId));
console.log(`\n共 ${entries.length + styleFiles.length} 张插件/风格图、${masterIndex.templates.length} 张冻结母版和 ${publicPreviewIndex.templates.length} 张独立键公开样图，落盘于 ${STORAGE_DIR}`);
console.log("把下面每段并入 registry.ts 里对应 plugin 的 manifest：\n");
for (const entry of entries) {
  console.log(`  // ${entry.pluginId}`);
  console.log(`  samples: { heroUrl: "${entry.url}" },\n`);
}
if (styleFiles.length) {
  console.log("  // PL-10（AI 四选一肖像）：风格对比图，键为 style 枚举值");
  console.log("  samples: {");
  console.log("    heroUrl: \"…保留现有值…\",");
  console.log("    styleUrls: {");
  for (const [styleId, url] of Object.entries(styleUrls)) console.log(`      "${styleId}": "${url}",`);
  console.log("    },\n  },\n");
}
console.log("提示：上线前确认服务端已配 PUBLIC_APP_URL，且该域名在小程序后台的 downloadFile 白名单内。");
