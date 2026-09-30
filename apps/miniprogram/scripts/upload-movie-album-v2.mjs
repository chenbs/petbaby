import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { sign } from "../../../deploy/scripts/upload-samples-cos.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const sourceRoot = path.join(root, "tools/imagegen/out/movie-album-v3");
const albumRoot = path.join(root, "tools/imagegen/out/movie-album-v2");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.join(root, "apps/platform")] }));
const host = "babykitty-static-one-1252454114.cos.ap-shanghai.myqcloud.com";
const groups = {
  movie: ["highseas", "musical", "webcity", "starvoyage"],
  album: ["growth", "birthday", "healing", "holiday"]
};

function hash(body) { return createHash("sha256").update(body).digest("hex"); }

async function credentials() {
  let accessKey = process.env.OSS_ACCESS_KEY_ID;
  let secret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!accessKey || !secret) {
    const file = path.resolve(root, process.env.COS_CREDENTIALS_FILE || "docs/ui-refactor/cos.txt");
    if (!file.startsWith(root + path.sep)) throw new Error("凭据文件必须位于工作区");
    const content = await readFile(file, "utf8");
    if (content.length > 4096) throw new Error("凭据文件格式异常");
    const match = content.match(/\bSecretId\s*[:=]\s*(\S+)\s+SecretKey\s*[:=]\s*(\S+)\s*$/i);
    if (!match) throw new Error("COS 凭据格式异常");
    accessKey = accessKey || match[1];
    secret = secret || match[2];
  }
  return { host, accessKey, secret, token: process.env.OSS_SESSION_TOKEN };
}

async function verify(url, body) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`样片读取失败：HTTP ${response.status}`);
  const remote = Buffer.from(await response.arrayBuffer());
  const etag = response.headers.get("etag")?.replaceAll('"', "").toLowerCase();
  if (etag !== createHash("md5").update(body).digest("hex") ||
      response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" ||
      (hash(remote) !== hash(body) && response.headers.get("x-slimflag") !== "1")) {
    throw new Error("COS 样片与本地文件不一致：" + url);
  }
  return true;
}

const mode = process.argv[2] || "--dry-run";
if (!["--dry-run", "--upload", "--verify-only"].includes(mode) || process.argv.length > 3) throw new Error("用法：node scripts/upload-movie-album-v2.mjs [--dry-run|--upload|--verify-only]");

const items = [];
const rooftopSource = path.join(root, "tools/imagegen/out/plugins/mp26-pet-movie-poster-v4.jpg");
const rooftopRaw = await sharp(await readFile(rooftopSource))
  .extract({ left: 800, top: 0, width: 750, height: 1000 })
  .resize(900, 1200)
  .jpeg({ quality: 90, mozjpeg: true })
  .toBuffer();
if (mode === "--upload") await writeFile(path.join(sourceRoot, "movie-rooftop-raw.jpg"), rooftopRaw);
for (const [group, ids] of Object.entries(groups)) {
  for (const id of ids) {
    const groupRoot = group === "album" ? albumRoot : sourceRoot;
    const file = path.join(groupRoot, `${group}-${id}.jpg`);
    const body = await readFile(file);
    const metadata = JSON.parse(await readFile(path.join(groupRoot, `${group}-${id}.json`), "utf8"));
    const digest = hash(body);
    if (digest !== metadata.sha256) throw new Error(`本地样片哈希不符：${group}/${id}`);
    const key = `samples/miniprogram-effects/v3/${group}/${id}-${digest}.jpg`;
    items.push({ group, id, key, body, url: `https://${host}/${key}` });
  }
}
for (const id of ["rooftop", ...groups.movie]) {
  const body = id === "rooftop" ? rooftopRaw : await readFile(path.join(sourceRoot, `movie-${id}-raw.jpg`));
  const digest = hash(body);
  const key = `samples/miniprogram-effects/v3/movie-master/${id}-${digest}.jpg`;
  items.push({ group: "movie-master", id, key, body, url: `https://${host}/${key}` });
}
console.log(`准备校验 ${items.length} 张电影、画册样片及生成母版`);

if (mode !== "--dry-run") {
  const auth = mode === "--upload" ? await credentials() : null;
  for (const item of items) {
    if (await verify(item.url, item.body)) continue;
    if (mode === "--verify-only") throw new Error(`COS 缺少 ${item.group}/${item.id}`);
    const headers = {
      host,
      "content-type": "image/jpeg",
      "content-md5": createHash("md5").update(item.body).digest("base64"),
      "x-cos-acl": "public-read"
    };
    if (auth.token) headers["x-cos-security-token"] = auth.token;
    const response = await fetch(item.url, { method: "PUT", headers: { ...headers, Authorization: sign("PUT", item.key, headers, auth) },
      body: item.body, redirect: "error", signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`COS 上传 ${item.group}/${item.id}：HTTP ${response.status}`);
    let readable = false;
    for (let attempt = 0; attempt < 6 && !readable; attempt++) {
      try { readable = await verify(item.url, item.body); } catch (error) { if (attempt === 5) throw error; }
      if (!readable) await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!readable) throw new Error(`COS 上传后不可读取：${item.group}/${item.id}`);
    console.log(`已上传 ${item.group}/${item.id}`);
  }
  await writeFile(path.join(sourceRoot, "cos-urls.json"), JSON.stringify(Object.fromEntries(items.map((item) => [`${item.group}/${item.id}`, item.url])), null, 2) + "\n");
  console.log("COS 样片与电影生成母版均可公开读取");
}
