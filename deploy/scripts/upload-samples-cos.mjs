#!/usr/bin/env node
import { createHash, createHmac } from "node:crypto";
import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "tools/imagegen/out");
const manifest = path.join(output, "reference-v1/deploy-assets.tsv");
const retired = path.join(output, "reference-v1/retired-storage-keys.txt");
const keyPattern = /^samples\/[a-zA-Z0-9/_-]+\.(?:jpg|webp)$/;

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function addAsset(assets, key, filename, expectedHash, contentType) {
  if (!keyPattern.test(key) || key.includes("..") || assets.has(key)) {
    throw new Error(`对象键无效或重复：${key}`);
  }
  const resolved = await realpath(filename);
  if (!resolved.startsWith(`${output}${path.sep}`)) throw new Error(`素材路径越界：${filename}`);
  const body = await readFile(resolved);
  const hash = sha256(body);
  if (expectedHash && hash !== expectedHash) throw new Error(`素材哈希不符：${filename}`);
  assets.set(key, { filename: resolved, hash, size: body.length, contentType });
}

export async function buildPlan() {
  const assets = new Map();
  const pluginDir = path.join(output, "plugins");
  const plugins = (await readdir(pluginDir)).filter((name) => /^[a-zA-Z0-9_-]+\.jpg$/.test(name)).sort();
  if (!plugins.length) throw new Error(`没有插件样例图：${pluginDir}`);
  for (const name of plugins) {
    const filename = path.join(pluginDir, name);
    const hash = sha256(await readFile(filename));
    await addAsset(assets, `samples/${name.slice(0, -4)}-${hash.slice(0, 12)}.jpg`, filename, hash, "image/jpeg");
  }

  const styleDir = path.join(output, "styles");
  const styles = (await readdir(styleDir).catch((error) => {
    if (error.code === "ENOENT") return [];
    throw error;
  })).filter((name) => /^style-[a-zA-Z0-9_-]+\.jpg$/.test(name)).sort();
  for (const name of styles) {
    const filename = path.join(styleDir, name);
    const hash = sha256(await readFile(filename));
    await addAsset(assets, `samples/${name.slice(0, -4)}-${hash.slice(0, 12)}.jpg`, filename, hash, "image/jpeg");
  }

  const counts = { master: 0, preview: 0 };
  const lines = (await readFile(manifest, "utf8")).split(/\r?\n/);
  for (const [index, line] of lines.entries()) {
    if (!line || line.startsWith("#")) continue;
    const fields = line.split("\t");
    if (fields.length !== 4) throw new Error(`部署清单第 ${index + 1} 行格式错误`);
    const [kind, key, source, hash] = fields;
    if (!(kind in counts) || !/^samples\/image-templates\/[a-zA-Z0-9_-]+\.webp$/.test(key) &&
        !/^samples\/image-template-previews\/[a-zA-Z0-9_-]+\.webp$/.test(key)) {
      throw new Error(`部署清单第 ${index + 1} 行类型或对象键无效`);
    }
    const prefix = kind === "master" ? "samples/image-templates/" : "samples/image-template-previews/";
    if (!key.startsWith(prefix) || !/^tools\/imagegen\/out\/reference-v1\//.test(source) ||
        source.split("/").some((segment) => segment === "." || segment === "..") ||
        !/^[a-f0-9]{64}$/.test(hash)) {
      throw new Error(`部署清单第 ${index + 1} 行路径或哈希无效`);
    }
    await addAsset(assets, key, path.join(root, source), hash, "image/webp");
    counts[kind]++;
  }
  if (counts.master !== 76 || counts.preview !== 76) {
    throw new Error(`部署清单数量错误：母版 ${counts.master}/76，预览 ${counts.preview}/76`);
  }

  const retiredKeys = (await readFile(retired, "utf8")).split(/\r?\n/).filter(Boolean);
  for (const key of retiredKeys) {
    if (!/^samples\/image-(?:templates|template-previews)\/[a-zA-Z0-9/_-]+\.(?:png|webp)$/.test(key) || assets.has(key)) {
      throw new Error(`退役对象键无效或仍在发布清单中：${key}`);
    }
  }
  return { assets, plugins: plugins.length, styles: styles.length, counts };
}

function config() {
  const bucket = process.env.OSS_BUCKET;
  const region = process.env.STORAGE_REGION;
  const accessKey = process.env.OSS_ACCESS_KEY_ID;
  const secret = process.env.OSS_ACCESS_KEY_SECRET;
  if (!bucket || !region || !accessKey || !secret) throw new Error("缺少 COS 配置：OSS_BUCKET、STORAGE_REGION、OSS_ACCESS_KEY_ID 或 OSS_ACCESS_KEY_SECRET");
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket) || !/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region)) throw new Error("COS Bucket 或地域格式错误");
  const host = `${bucket}.cos.${region}.myqcloud.com`;
  if (process.env.OSS_ENDPOINT && process.env.OSS_ENDPOINT.replace(/\/$/, "") !== `https://${host}`) throw new Error("OSS_ENDPOINT 与 Bucket/地域不一致");
  return { host, accessKey, secret, token: process.env.OSS_SESSION_TOKEN };
}

function encode(value) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function sign(method, key, headers, credentials, now = Date.now()) {
  const start = Math.floor(now / 1000);
  const keyTime = `${start};${start + 600}`;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${encode(name.toLowerCase())}=${encode(headers[name])}`).join("&");
  const canonical = `${method.toLowerCase()}\n/${key}\n\n${canonicalHeaders}\n`;
  const signKey = createHmac("sha1", credentials.secret).update(keyTime).digest("hex");
  const stringToSign = `sha1\n${keyTime}\n${createHash("sha1").update(canonical).digest("hex")}\n`;
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");
  return `q-sign-algorithm=sha1&q-ak=${encode(credentials.accessKey)}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${names.join(";")}&q-url-param-list=&q-signature=${signature}`;
}

async function request(method, key, credentials, body, contentType) {
  const headers = { host: credentials.host };
  if (method === "PUT") {
    headers["content-type"] = contentType;
    headers["content-md5"] = createHash("md5").update(body).digest("base64");
    headers["x-cos-acl"] = "private";
  }
  if (credentials.token) headers["x-cos-security-token"] = credentials.token;
  const response = await fetch(`https://${credentials.host}/${key.split("/").map(encode).join("/")}`, {
    method,
    headers: { ...headers, Authorization: sign(method, key, headers, credentials) },
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
  });
  if (method === "GET" && response.status === 404) return null;
  if (!response.ok) throw new Error(`COS ${method} ${key} 失败：HTTP ${response.status}`);
  return response;
}

export async function verify(key, asset, credentials) {
  const response = await request("GET", key, credentials);
  if (!response) return false;
  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type")?.split(";")[0];
  if (body.length !== asset.size || sha256(body) !== asset.hash || contentType !== asset.contentType) {
    throw new Error(`COS 对象内容或类型与本地不一致：${key}`);
  }
  return true;
}

async function main() {
  const mode = process.argv[2] || "--upload";
  if (!["--dry-run", "--upload", "--verify-only"].includes(mode) || process.argv.length > 3) {
    throw new Error("用法：node deploy/scripts/upload-samples-cos.mjs [--dry-run|--upload|--verify-only]");
  }
  const plan = await buildPlan();
  const size = [...plan.assets.values()].reduce((sum, asset) => sum + asset.size, 0);
  console.log(`本地校验通过：${plan.plugins} 张插件图、${plan.styles} 张风格图、${plan.counts.master} 张母版、${plan.counts.preview} 张预览，共 ${plan.assets.size} 个对象，${(size / 1048576).toFixed(2)} MiB`);
  if (mode === "--dry-run") return;

  const credentials = config();
  let uploaded = 0;
  let existing = 0;
  for (const [key, asset] of plan.assets) {
    if (await verify(key, asset, credentials)) {
      existing++;
      continue;
    }
    if (mode === "--verify-only") throw new Error(`COS 缺少对象：${key}`);
    const body = await readFile(asset.filename);
    if (body.length !== asset.size || sha256(body) !== asset.hash) throw new Error(`上传前素材已变化：${asset.filename}`);
    await request("PUT", key, credentials, body, asset.contentType);
    if (!await verify(key, asset, credentials)) throw new Error(`上传后 COS 对象不存在：${key}`);
    uploaded++;
    if ((uploaded + existing) % 20 === 0) console.log(`已验证 ${uploaded + existing}/${plan.assets.size} 个 COS 对象`);
  }
  console.log(`COS 校验完成：新增 ${uploaded}，已存在且一致 ${existing}，合计 ${plan.assets.size}`);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch((error) => {
    console.error(`[fail] ${error.message}`);
    process.exitCode = 1;
  });
}
