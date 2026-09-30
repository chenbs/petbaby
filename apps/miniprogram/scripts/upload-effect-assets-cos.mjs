import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { sign } from "../../../deploy/scripts/upload-samples-cos.mjs";

const root = path.resolve(import.meta.dirname, "../../..");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.join(root, "apps/platform")] }));
const stage = path.join(root, "apps/platform/.data/miniprogram-effects");
const planFile = path.join(stage, "plan.json");
const remoteRoot = path.join(stage, "remote") + path.sep;
const mode = process.argv[2] || "--dry-run";
const staticBucket = "babykitty-static-one-1252454114";
const staticRegion = "ap-shanghai";

function hash(body) { return createHash("sha256").update(body).digest("hex"); }

async function credentials() {
  const bucket = process.env.OSS_BUCKET || staticBucket;
  const region = process.env.STORAGE_REGION || staticRegion;
  let accessKey = process.env.OSS_ACCESS_KEY_ID;
  let secret = process.env.OSS_ACCESS_KEY_SECRET;
  if ((!accessKey || !secret) && process.env.COS_CREDENTIALS_FILE) {
    const filename = path.resolve(root, process.env.COS_CREDENTIALS_FILE);
    if (!filename.startsWith(root + path.sep)) throw new Error("凭据文件必须位于当前工作区");
    const content = await readFile(filename, "utf8");
    if (content.length > 4096) throw new Error("凭据文件格式异常");
    const match = content.match(/\bSecretId\s*[:=]\s*(\S+)\s+SecretKey\s*[:=]\s*(\S+)\s*$/i);
    if (!match) throw new Error("凭据文件需包含 SecretId 和 SecretKey");
    accessKey = accessKey || match[1];
    secret = secret || match[2];
  }
  if (!bucket || !region || !accessKey || !secret) throw new Error("请先配置 OSS_BUCKET、STORAGE_REGION、OSS_ACCESS_KEY_ID、OSS_ACCESS_KEY_SECRET");
  if (bucket !== staticBucket || region !== staticRegion) throw new Error("本任务只能上传到已确认的静态样片 COS Bucket 和地域");
  if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket) || !/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region)) throw new Error("COS Bucket 或地域格式错误");
  return { host: `${bucket}.cos.${region}.myqcloud.com`, accessKey, secret, token: process.env.OSS_SESSION_TOKEN };
}

async function request(method, item, auth, body) {
  const headers = { host: auth.host };
  if (method === "PUT") {
    headers["content-type"] = "image/jpeg";
    headers["content-md5"] = createHash("md5").update(body).digest("base64");
    headers["x-cos-acl"] = "public-read";
  }
  if (auth.token) headers["x-cos-security-token"] = auth.token;
  const url = `https://${auth.host}/${item.key.split("/").map(encodeURIComponent).join("/")}`;
  const response = await fetch(url, { method, headers: { ...headers, Authorization: sign(method, item.key, headers, auth) },
    body, redirect: "error", signal: AbortSignal.timeout(30000) });
  if (method === "GET" && response.status === 404) return null;
  if (!response.ok) throw new Error(`COS ${method} ${item.key}: HTTP ${response.status}`);
  return response;
}

async function verify(item) {
  const response = await fetch(item.url, { redirect: "error", signal: AbortSignal.timeout(30000) });
  if (response.status === 404) return false;
  if (!response.ok) throw new Error(`公开样片无法读取：${item.key} HTTP ${response.status}`);
  const body = Buffer.from(await response.arrayBuffer());
  const originalMd5 = createHash("md5").update(await readFile(path.resolve(root, item.file))).digest("hex");
  const etag = response.headers.get("etag")?.replaceAll('"', "").toLowerCase();
  const slimmed = response.headers.get("x-slimflag") === "1" &&
    response.headers.get("x-orisize") === String(item.bytes);
  const exact = body.length === item.bytes && hash(body) === item.sha256;
  const image = await sharp(body).metadata();
  if (etag !== originalMd5 || (!exact && !slimmed) ||
      response.headers.get("content-type")?.split(";")[0] !== "image/jpeg" ||
      image.format !== "jpeg" || image.width !== item.width || image.height !== item.height) {
    throw new Error("COS 文件与本地清单不一致：" + item.key);
  }
  return true;
}

async function verifyAfterUpload(item) {
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      if (await verify(item)) return;
    } catch (error) {
      if (attempt === 5) throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  throw new Error("COS 上传后无法读取：" + item.key);
}

async function main() {
  if (!["--dry-run", "--upload", "--verify-only"].includes(mode) || process.argv.length > 3) throw new Error("用法：node scripts/upload-effect-assets-cos.mjs [--dry-run|--upload|--verify-only]");
  const planBody = await readFile(planFile);
  const plan = JSON.parse(planBody.toString("utf8"));
  if (plan.version !== 1 || plan.remote.length !== 94 || plan.home.length !== 30) throw new Error("效果图清单数量或版本不符，请重新生成");
  for (const item of plan.remote) {
    if (!/^samples\/miniprogram-effects\/v[23]\/(?:scenes|templates|movie|album|interactive|funTests)\/[a-z0-9-]+-[a-f0-9]{64}\.jpg$/.test(item.key)) throw new Error("非法 COS 对象路径：" + item.key);
    const filename = path.resolve(root, item.file);
    if (item.url !== `https://${staticBucket}.cos.${staticRegion}.myqcloud.com/${item.key}`) throw new Error("公开 URL 与静态桶不一致：" + item.key);
    if (!filename.startsWith(remoteRoot)) throw new Error("素材超出暂存目录：" + item.file);
    const body = await readFile(filename);
    if (body.length !== item.bytes || hash(body) !== item.sha256) throw new Error("暂存素材与清单不一致：" + item.file);
  }
  console.log(`本地校验通过：${plan.remote.length} 张，${(plan.remote.reduce((sum, item) => sum + item.bytes, 0) / 1048576).toFixed(2)} MiB`);
  if (mode === "--dry-run") return;
  const auth = await credentials();
  let uploaded = 0;
  for (const [index, item] of plan.remote.entries()) {
    if (!await verify(item)) {
      if (mode === "--verify-only") throw new Error("COS 缺少对象：" + item.key);
      await request("PUT", item, auth, await readFile(path.resolve(root, item.file)));
      await verifyAfterUpload(item);
      uploaded++;
    }
    if ((index + 1) % 20 === 0) console.log(`已核对 ${index + 1}/${plan.remote.length} 张`);
  }
  await writeFile(path.join(stage, "verification.json"), JSON.stringify({ planSha256: hash(planBody), count: plan.remote.length, verifiedAt: new Date().toISOString() }, null, 2) + "\n");
  console.log(`COS 校验完成：新增 ${uploaded} 张，合计 ${plan.remote.length} 张`);
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
