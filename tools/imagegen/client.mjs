/**
 * lingsuan 图像 API 客户端（离线素材生成用）。
 *
 * 与 apps/platform 的运行时 provider 刻意分开：本文件是构建期工具，允许长超时、
 * 允许落盘、允许 3840px 高分辨率；运行时 provider 有请求预算与熔断约束。
 *
 * 凭据只从环境变量或 .env.imagegen 读，绝不写进任何进版本控制的文件。
 */
import { readFile } from "node:fs/promises";
import path from "node:path";

import { createRequestQueue, normalizeConcurrency } from "./request-queue.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const TIMEOUT_MS = 300_000; // 实测 46–62 秒（quality=low），high 更久，留足余量
const requestQueue = createRequestQueue(1);

/** 读 .env.imagegen，已存在的进程环境变量优先。 */
export async function loadEnv() {
  const env = {};
  try {
    const text = await readFile(path.join(ROOT, ".env.imagegen"), "utf8");
    for (const line of text.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (match) env[match[1]] = match[2].trim();
    }
  } catch { /* 文件缺失时只依赖进程环境变量 */ }
  const baseUrl = process.env.LINGSUAN_IMAGE_BASE_URL || env.LINGSUAN_IMAGE_BASE_URL;
  const apiKey = process.env.LINGSUAN_IMAGE_API_KEY || env.LINGSUAN_IMAGE_API_KEY;
  const model = process.env.LINGSUAN_IMAGE_MODEL || env.LINGSUAN_IMAGE_MODEL || "gpt-image-2";
  const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
  const concurrency = normalizeConcurrency(
    process.env.LINGSUAN_IMAGE_CONCURRENCY
      || concurrencyArgument?.split("=")[1]
      || env.LINGSUAN_IMAGE_CONCURRENCY,
    1
  );
  // 不给 baseUrl 默认值：域名写死在代码里，换代理站时会出现「改了 .env 却没生效」
  if (!baseUrl || !apiKey) throw new Error("缺少 LINGSUAN_IMAGE_BASE_URL / LINGSUAN_IMAGE_API_KEY");
  requestQueue.configure(concurrency);
  return { baseUrl: baseUrl.replace(/\/+$/, ""), apiKey, model, concurrency };
}

async function withTimeout(run) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try { return await run(controller.signal); } finally { clearTimeout(timer); }
}

/**
 * 把响应项统一成 Buffer。
 *
 * lingsuan **默认返回 url**（文档说默认 `b64_json`，实测不是），下载主机与 API 主机
 * 不同（`img.junliai.org`）。两条分支都保留：`response_format=b64_json` 实测可用，
 * 只是我们不传（见 generate 的说明），删掉哪一条都会在对面调整默认值时炸。
 */
async function toBuffer(item) {
  if (item.b64_json) return Buffer.from(item.b64_json, "base64");
  if (!item.url) throw new Error("响应缺 url");
  const response = await withTimeout((signal) => fetch(item.url, { signal }));
  if (!response.ok) throw new Error(`下载失败 ${response.status}`);
  return Buffer.from(await response.arrayBuffer());
}

/** 网络抖动与 5xx 退避重试；4xx 直接抛，重试无意义。 */
async function attempt(run, retries = 3) {
  let lastError;
  for (let index = 0; index <= retries; index += 1) {
    try { return await run(); } catch (error) {
      lastError = error;
      if (error && error.fatal) throw error;
      if (index < retries) await new Promise((resolve) => setTimeout(resolve, 2000 * (index + 1)));
    }
  }
  throw lastError;
}

async function parse(response) {
  const text = await response.text();
  if (!response.ok) {
    const error = new Error(`API ${response.status}: ${text.slice(0, 300)}`);
    if (response.status >= 400 && response.status < 500 && response.status !== 429) error.fatal = true;
    throw error;
  }
  let payload;
  try { payload = JSON.parse(text); } catch { throw new Error(`响应非 JSON: ${text.slice(0, 300)}`); }
  const item = payload?.data?.[0];
  if (!item) throw new Error(`响应缺 data: ${text.slice(0, 300)}`);
  return { buffer: await toBuffer(item), revisedPrompt: item.revised_prompt || "" };
}

/**
 * 文生图。n 固定为 1（文档建议先传 1），多张由调用方循环。
 *
 * size 实测**只对方形生效**：请求 1024x1024 得到 1024x1024，但请求 1600x1000
 * 得到 2048x1376（比例接近、尺寸不符）。所以比例仍必须本地强制（`crop.mjs`），
 * 不能因为「size 好像生效了」就省掉裁切。
 *
 * @param background 传 `"transparent"` 要求直出带 alpha 的 PNG。**默认不传**。
 *        lingsuan 对该参数的表现与 packy 不同：**不报错，但也不生效** ——
 *        实测返回 200 且产物 `alpha=false`。所以调用方不能靠捕获 4xx 判断回落，
 *        必须**回读产物的 alpha 通道**（`generate.mjs` 的 islandJobs 已这样做），
 *        否则岛的立绘会拿到不透明底、抠图无从下手，最终变成一张贴纸。
 */
export async function generate(config, { prompt, size = "1024x1024", quality = "high", outputFormat = "png", background = "", maxRetries = 3 }) {
  return requestQueue.run(() => attempt(async () => {
    const response = await withTimeout((signal) => fetch(`${config.baseUrl}/v1/images/generations`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json", Accept: "*/*" },
      /*
       * 不传 response_format。lingsuan 接受它（传 b64_json 实测真给 base64），
       * 但默认的 url 形态更省内存 —— 单张 high 质量约 3.8MB，base64 后 ~5MB
       * 全在内存里过一遍；批量并发 4 时没有必要。
       */
      body: JSON.stringify({
        model: config.model,
        prompt,
        size,
        quality,
        output_format: outputFormat,
        ...(background ? { background } : {}),
        n: 1
      }),
      signal
    }));
    return parse(response);
  }, maxRetries));
}

/**
 * 图生图。支持一张或多张参考图：`imagePaths` 按顺序重复上传为 multipart 的
 * `image` 字段，调用方可以把构图/效果参考放在前、身份参考放在后。
 * 传入旧的 `imagePath` 仍保持单图调用兼容。
 *
 * @param inputFidelity 传 "high" 可要求保住主体特征。lingsuan 上 `gpt-image-2`
 *        **接受**该参数（packy 曾以 400 `invalid_input_fidelity_model` 拒绝），
 *        但默认仍不传：实测「接受」只说明不报错，产物是否真更贴主体没有验证过，
 *        而这批素材的判据是人眼比对。要用时由调用方显式开启。
 * @param maskPath 可选 PNG 遮罩；透明区域允许编辑，不透明区域要求保留。
 */
export async function edit(config, { imagePath, imagePaths = [], maskPath = "", prompt, size = "1024x1024", quality = "high", outputFormat = "png", inputFidelity = "", maxRetries = 3 }) {
  const paths = imagePaths.length ? imagePaths : imagePath ? [imagePath] : [];
  if (!paths.length) throw new Error("图生图至少需要一张输入图");
  const inputs = await Promise.all(paths.map(async (inputPath) => ({
    inputPath,
    bytes: await readFile(inputPath)
  })));
  const maskBytes = maskPath ? await readFile(maskPath) : null;
  /*
   * Blob 必须显式带 MIME type。
   *
   * `new Blob([bytes])` 的 type 是空串，FormData 会以
   * `application/octet-stream` 发出，接口直接拒绝：
   * `unsupported mimetype ('application/octet-stream')`。
   * 按扩展名推断即可 —— 这里的输入都是自己刚落盘的素材。
   */
  return requestQueue.run(() => attempt(async () => {
    const form = new FormData();
    form.append("model", config.model);
    form.append("prompt", prompt);
    for (const input of inputs) {
      const extension = path.extname(input.inputPath).toLowerCase();
      const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".webp" ? "image/webp" : "image/png";
      // lingsuan 多图编辑沿用重复的 image multipart 字段，顺序就是模型收到的参考图顺序。
      form.append("image", new Blob([input.bytes], { type: mime }), path.basename(input.inputPath));
    }
    if (maskBytes) {
      form.append("mask", new Blob([maskBytes], { type: "image/png" }), path.basename(maskPath));
    }
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", outputFormat);
    // 同 generate：不传 response_format，默认的 url 形态更省内存。
    // input_fidelity 默认不传，理由见函数注释。
    if (inputFidelity) form.append("input_fidelity", inputFidelity);
    form.append("n", "1");
    const response = await withTimeout((signal) => fetch(`${config.baseUrl}/v1/images/edits`, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, Accept: "*/*" },
      body: form,
      signal
    }));
    return parse(response);
  }, maxRetries));
}
