/**
 * 2026-10：高清样片，只给「大图位置」用——写真 / 人宠写真 / 全部图片模板的制作页大预览、首页写真馆入口卡、
 * 写真馆人宠网格，以及图文 / 短片玩法详情页（create、video-create）的全宽封面。
 *
 * 原因：端上原有样片是缩略图（写真 420×560、人宠 330×587，JPEG q78），制作页预览框按 2–3 倍屏要 ~900 像素，
 * 等于把缩略图放大 2 倍以上，所以发虚。高清版直接取原图分辨率（写真 900×1200、人宠 720×1280），
 * 轻度 USM 锐化 + q85 + 4:4:4 色度（红格子、细毛发边缘不糊），不重新生图。
 * 横滑、网格等小图位置继续用原缩略图，不增加首页流量。
 *
 * 人宠写真的运行时冻结母版不动；这里的高清图只是展示副本，键名独立。
 *
 * 用法：node scripts/publish-hd-samples.mjs [--dry-run|--upload]
 * 上传凭据：OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，或 COS_CREDENTIALS_FILE 指向工作区内的凭据文件。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sign } from "../../../deploy/scripts/upload-samples-cos.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const mini = path.join(root, "apps/miniprogram");
const platform = path.join(root, "apps/platform");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const { scenes, templates, overrides, pluginSources } = require("./build-sample-assets.js");
const host = "babykitty-static-one-1252454114.cos.ap-shanghai.myqcloud.com";
const manifestPath = path.join(mini, "assets/samples/manifest.js");
const mode = process.argv[2] || "--dry-run";
if (!["--dry-run", "--upload"].includes(mode) || process.argv.length > 3) throw new Error("用法：publish-hd-samples.mjs [--dry-run|--upload]");

const sha256 = (body) => createHash("sha256").update(body).digest("hex");

/** 原图分辨率 + 轻度锐化。sigma 小、阈值低，只把缩放与 JPEG 带来的软边找回来，不在毛发边缘出白边。 */
async function render(source, width, height) {
  return sharp(source)
    .resize(width, height, { fit: "cover", withoutEnlargement: true })
    .sharpen({ sigma: 0.6, m1: 0.6, m2: 2 })
    .jpeg({ quality: 85, mozjpeg: true, chromaSubsampling: "4:4:4" })
    .toBuffer();
}

const items = [];
async function prepare(group, id, source, width, height) {
  const body = await render(source, width, height);
  const meta = await sharp(body).metadata();
  if (meta.width !== width || meta.height !== height) throw new Error(`${group}/${id} 尺寸不符：${meta.width}x${meta.height}`);
  const key = `samples/miniprogram-effects/v2/${group}/${id}-${sha256(body)}.jpg`;
  items.push({ group, id, key, body, url: `https://${host}/${key}` });
}

for (const [id, version] of Object.entries(scenes)) {
  await prepare("scenesHd", id, path.join(root, "tools/imagegen/out/scenes", `scene-${id}-${version}.jpg`), 900, 1200);
}
const duo = templates.filter((item) => item.entryId === "duo");
if (duo.length !== 16) throw new Error(`人宠写真应为 16 张，实际 ${duo.length}`);
for (const item of duo) {
  // 取文生图原稿（q91 JPEG），不取二次压缩过的 WebP 展示图
  await prepare("templatesHd", item.templateId, path.join(root, "tools/imagegen/out/duo-v2", `${item.templateId}.jpg`), 720, 1280);
}
// 其他图片模板（如果我是人、和我合照、好笑出片等）：制作页大预览同样按 ~700–950 像素显示，端上缩略图只有 330 宽。
// 取公开展示图（人化是同一个对象），不取冻结母版：公开图可能是去水印或改配色后的版本。
for (const item of templates.filter((entry) => entry.entryId !== "duo")) {
  const key = item.subjectMode === "pet-human" ? item.masterStorageKey
    : overrides[item.templateId] || item.masterStorageKey.replace("/image-templates/", "/image-template-previews/");
  const source = path.join(platform, ".data/objects", key);
  const meta = await sharp(source).metadata();
  await prepare("templatesHd", item.templateId, source, meta.width, meta.height);
}
// 图文 / 短片玩法封面：create 与 video-create 页全宽 16:10 展示，3 倍屏要 ~1030 像素，端上封面只有 720 宽
for (const [id, filename] of Object.entries(pluginSources)) {
  await prepare("pluginsHd", id, path.join(root, "tools/imagegen/out/plugins", filename), 1080, 675);
}
const bytes = items.reduce((sum, item) => sum + item.body.length, 0);
console.log(`准备完成：${items.length} 张高清样片，合计 ${(bytes / 1048576).toFixed(2)} MiB，单张平均 ${Math.round(bytes / items.length / 1024)} KB`);

async function credentials() {
  let accessKey = process.env.OSS_ACCESS_KEY_ID;
  let secret = process.env.OSS_ACCESS_KEY_SECRET;
  if ((!accessKey || !secret) && process.env.COS_CREDENTIALS_FILE) {
    const file = path.resolve(root, process.env.COS_CREDENTIALS_FILE);
    if (!file.startsWith(root + path.sep)) throw new Error("凭据文件必须位于工作区");
    const content = await readFile(file, "utf8");
    if (content.length > 4096) throw new Error("凭据文件格式异常");
    const match = content.match(/\bSecretId\s*[:=]\s*(\S+)\s+SecretKey\s*[:=]\s*(\S+)\s*$/i);
    if (!match) throw new Error("凭据文件需包含 SecretId 和 SecretKey");
    accessKey = accessKey || match[1];
    secret = secret || match[2];
  }
  if (!accessKey || !secret) throw new Error("缺少 COS 凭据");
  return { host, accessKey, secret, token: process.env.OSS_SESSION_TOKEN };
}

async function readable(item) {
  const response = await fetch(item.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`样片读取失败 ${item.key}: HTTP ${response.status}`);
  const etag = response.headers.get("etag")?.replaceAll('"', "").toLowerCase();
  if (etag !== createHash("md5").update(item.body).digest("hex")) throw new Error("COS 文件与本地不一致：" + item.key);
  return true;
}

if (mode === "--upload") {
  const auth = await credentials();
  for (const item of items) {
    if (await readable(item)) continue;
    const headers = { host, "content-type": "image/jpeg", "content-md5": createHash("md5").update(item.body).digest("base64"), "x-cos-acl": "public-read" };
    if (auth.token) headers["x-cos-security-token"] = auth.token;
    const response = await fetch(item.url, { method: "PUT", headers: { ...headers, Authorization: sign("PUT", item.key, headers, auth) }, body: item.body, redirect: "error", signal: AbortSignal.timeout(60000) });
    if (!response.ok) throw new Error(`COS 上传 ${item.key}: HTTP ${response.status}`);
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      ok = await readable(item).catch((error) => { if (attempt === 5) throw error; return false; });
      if (!ok) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ok) throw new Error("COS 上传后不可读取：" + item.key);
  }
  // 只在全部上传并校验通过后写 manifest；整组替换，换图后旧键不残留
  const manifest = require(manifestPath);
  manifest.scenesHd = Object.fromEntries(items.filter((item) => item.group === "scenesHd").map((item) => [item.id, item.url]));
  manifest.templatesHd = Object.fromEntries(items.filter((item) => item.group === "templatesHd").map((item) => [item.id, item.url]));
  manifest.pluginsHd = Object.fromEntries(items.filter((item) => item.group === "pluginsHd").map((item) => [item.id, item.url]));
  await writeFile(manifestPath, "module.exports = " + JSON.stringify(manifest, null, 2) + ";\n");
  console.log(`manifest 已写入 ${Object.keys(manifest.scenesHd).length} 张写真、${Object.keys(manifest.templatesHd).length} 张模板、${Object.keys(manifest.pluginsHd).length} 张玩法封面高清样片`);
}
