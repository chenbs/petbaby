/**
 * 2026-10-06：只发布 v14 变动的 20 套写真小程序样片（11 套加装饰、4 套时尚大片、5 套换宠物或改棚拍）。
 *
 * 与 publish-art-duo-assets.mjs 同规格（远程图为端上缩略图的 1.5 倍、JPEG q78、键名带完整 sha256），
 * 只改 manifest 里对应的 scenes 键，其余逐字不动；人宠写真模板本轮未变，不碰。
 *
 * 用法：node scripts/publish-art-v14-assets.mjs [--dry-run|--upload]
 * 上传凭据：OSS_ACCESS_KEY_ID / OSS_ACCESS_KEY_SECRET，或 COS_CREDENTIALS_FILE 指向工作区内的凭据文件。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sign } from "../../../deploy/scripts/upload-samples-cos.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const mini = path.join(root, "apps/miniprogram");
const platform = path.join(root, "apps/platform");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const { scenes, thumbnail } = require("./build-sample-assets.js");
const { BOSS_SCENE_IDS } = require("../services/home-effect-ids.js");
const bucket = "babykitty-static-one-1252454114";
const host = `${bucket}.cos.ap-shanghai.myqcloud.com`;
const stage = path.join(platform, ".data/miniprogram-effects/art-v14");
const manifestPath = path.join(mini, "assets/samples/manifest.js");
const mode = process.argv[2] || "--dry-run";
if (!["--dry-run", "--upload"].includes(mode) || process.argv.length > 3) throw new Error("用法：publish-art-v14-assets.mjs [--dry-run|--upload]");

const sha256 = (body) => createHash("sha256").update(body).digest("hex");
const items = [];

async function prepare(group, id, source, legacy, remote) {
  // 端上旧缩略图（packOptions 已忽略，只供比例测试与离线预览）
  await thumbnail(source, path.join(mini, "assets/samples", group, id + ".jpg"), legacy.width, legacy.height);
  const draft = path.join(stage, group, id + ".jpg");
  await mkdir(path.dirname(draft), { recursive: true });
  await thumbnail(source, draft, remote.width, remote.height, { quality: 78 });
  const body = await readFile(draft);
  const digest = sha256(body);
  const home = group === "scenes" && BOSS_SCENE_IDS.includes(id);
  if (home) {
    // 首页默认写真样片留在包内（首屏不等网络）
    const local = path.join(mini, "assets/home-effects/scenes", id + ".jpg");
    await writeFile(local, body);
    items.push({ group, id, home: true, url: `/assets/home-effects/scenes/${id}.jpg` });
    return;
  }
  const key = `samples/miniprogram-effects/v2/${group}/${id}-${digest}.jpg`;
  items.push({ group, id, key, body, digest, url: `https://${host}/${key}` });
}

const v14 = Object.entries(scenes).filter(([, version]) => version === "v14").map(([id]) => id);
if (v14.length !== 20) throw new Error(`v14 写真应为 20 套，实际 ${v14.length}`);
for (const id of v14) {
  await prepare("scenes", id, path.join(root, "tools/imagegen/out/scenes", `scene-${id}-v14.jpg`), { width: 280, height: 374 }, { width: 420, height: 560 });
}
console.log(`准备完成：${items.filter((item) => !item.home).length} 张远程、${items.filter((item) => item.home).length} 张包内`);

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
  for (const item of items.filter((entry) => !entry.home)) {
    if (await readable(item)) continue;
    const headers = { host, "content-type": "image/jpeg", "content-md5": createHash("md5").update(item.body).digest("base64"), "x-cos-acl": "public-read" };
    if (auth.token) headers["x-cos-security-token"] = auth.token;
    const response = await fetch(item.url, { method: "PUT", headers: { ...headers, Authorization: sign("PUT", item.key, headers, auth) }, body: item.body, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`COS 上传 ${item.key}: HTTP ${response.status}`);
    let ok = false;
    for (let attempt = 0; attempt < 6 && !ok; attempt++) {
      ok = await readable(item).catch((error) => { if (attempt === 5) throw error; return false; });
      if (!ok) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!ok) throw new Error("COS 上传后不可读取：" + item.key);
    console.log("已上传 " + item.key);
  }
  // 只在上传并校验通过后改 manifest，避免端上指向不存在的对象
  const manifest = require(manifestPath);
  for (const item of items) manifest.scenes[item.id] = item.url;
  await writeFile(manifestPath, "module.exports = " + JSON.stringify(manifest, null, 2) + ";\n");
  console.log(`manifest 已更新 ${items.length} 个键`);
}
