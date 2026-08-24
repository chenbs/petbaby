import "server-only";

import { ConcurrencyQueue, normalizeConcurrency } from "@/server/ai/concurrency-queue";
import { AppError } from "@/server/errors";
import { isRealProduction } from "@/server/runtime-mode";

export type ImageOutput = { body: Uint8Array; contentType: string };

/**
 * 参考图。有它就走图生图（`/v1/images/edits`），没有就走文生图。
 *
 * PL-10 卖的是「像我家这只」，纯文生图只能得到「某只橘猫」——
 * 用户拿到一张不是自家宠物的图，这个玩法就是坏的。
 */
export type ImageReference = { body: Uint8Array; contentType: string; filename?: string };
export type ImageReferenceInput = ImageReference | readonly ImageReference[];
export type ImageGenerationOptions = { size?: string; quality?: string; inputFidelity?: string };

export type ImageProvider = {
  name: string;
  modelVersion: string;
  /** @param references 有序参考图；生产供应商必须使用全部输入，不支持时应明确失败 */
  generate(prompt: string, count: number, references?: ImageReferenceInput, options?: ImageGenerationOptions): Promise<ImageOutput[]>;
};

function normalizeReferences(input?: ImageReferenceInput) {
  if (!input) return [];
  return Array.isArray(input) ? [...input] : [input as ImageReference];
}

/**
 * 本地占位图。**只用于无凭据的开发环境**，让整条链路能跑通。
 *
 * 它画的是纯色块 + 文字，正是 UI 重构方案点名的「抽象色块」违例，
 * 所以绝不能出现在生产：`selectImageProvider` 在生产缺凭据时直接抛错，
 * 而不是静默回落到这里 —— 否则用户会为一张色块付钱。
 */
class LocalImageProvider implements ImageProvider {
  name = "local";
  modelVersion = "local-v1";

  /** 忽略 references：仅用于开发链路占位，不能作为身份保持或模板质量验证结果 */
  async generate(prompt: string, count: number) {
    return Array.from({ length: count }, (_, index) => {
      const hue = ["#f56643", "#216844", "#e0a52b", "#4380a8"][index % 4];
      const safe = prompt.replace(/[<>&"]/g, "").slice(0, 60);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="${hue}"/><circle cx="512" cy="430" r="260" fill="#fff1b7" opacity=".9"/><text x="512" y="430" text-anchor="middle" font-size="72">PET ${index + 1}</text><text x="512" y="780" text-anchor="middle" font-size="30" fill="#fff">${safe}</text><text x="512" y="850" text-anchor="middle" font-size="22" fill="#fff">AI GENERATED · LOCAL PREVIEW</text></svg>`;
      return { body: new TextEncoder().encode(svg), contentType: "image/svg+xml" };
    });
  }
}

class HttpImageProvider implements ImageProvider {
  name: string;
  modelVersion: string;
  private endpoint: string;
  private key: string;

  constructor(endpoint: string, key: string, name: string, modelVersion: string) {
    this.endpoint = endpoint;
    this.key = key;
    this.name = name;
    this.modelVersion = modelVersion;
  }

  async generate(prompt: string, count: number, references?: ImageReferenceInput) {
    if (normalizeReferences(references).length) {
      throw new AppError("AI_MULTI_REFERENCE_UNSUPPORTED", `${this.name} 不支持必需的多参考图输入`, 502);
    }
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, count, model: this.modelVersion }),
    });
    if (!response.ok) throw new Error(`AI_PROVIDER_${response.status}`);
    const payload = (await response.json()) as { images?: Array<{ url?: string; base64?: string; contentType?: string }> };
    if (!payload.images?.length) throw new Error("AI_PROVIDER_EMPTY");
    return Promise.all(payload.images.slice(0, count).map(async (image) => {
      if (image.base64) return { body: new Uint8Array(Buffer.from(image.base64, "base64")), contentType: image.contentType || "image/png" };
      if (!image.url) throw new Error("AI_PROVIDER_OUTPUT_EMPTY");
      const download = await fetch(image.url);
      if (!download.ok) throw new Error("AI_PROVIDER_DOWNLOAD_FAILED");
      return { body: new Uint8Array(await download.arrayBuffer()), contentType: download.headers.get("content-type") || "image/png" };
    }));
  }
}

/**
 * lingsuan 图像接口（OpenAI images 兼容形态）。
 *
 * 与 HttpImageProvider 不能共用：两边的报文完全不同 ——
 *   HttpImageProvider  发 {prompt,count,model}          收 {images:[{url|base64}]}
 *   lingsuan           发 {model,prompt,n,size,quality}  收 {data:[{url|b64_json}]}
 * 直接改 HttpImageProvider 会打断仍在用旧格式的备用通道，因此另起一个实现。
 *
 * `n` 按文档建议固定为 1，所以 count 张要发 count 次请求 ——
 * PL-10 是四选一，一次任务就是 4 次调用，这也是下面要限并发的原因。
 *
 * **不传 `response_format`**：lingsuan 接受它（传 `b64_json` 实测真给 base64），
 * 但默认的 url 形态更省内存 —— 单张 high 质量约 3.8MB，base64 化后 ~5MB 要整个进堆，
 * 而这里最多 4 张并发。返回形态仍**随模型而变**（lingsuan 默认 `url`、packy 时代的
 * `gpt-image-2` 只给 `b64_json`），所以两条分支都必须保留 —— 按当前默认写死一条，
 * 换模型或换代理站就整条链路失效，而症状是线上生成全失败、本地
 * LocalImageProvider 一切正常。
 *
 * 凭据与离线素材工具（tools/imagegen）共用同一组环境变量名，运维只需配一份。
 */
const LINGSUAN_TIMEOUT_MS = Number(process.env.LINGSUAN_IMAGE_TIMEOUT_MS || 180_000);
const LINGSUAN_CONCURRENCY = normalizeConcurrency(process.env.LINGSUAN_IMAGE_CONCURRENCY, 20);
const lingsuanRequestQueue = new ConcurrencyQueue(LINGSUAN_CONCURRENCY);

type LingsuanItem = { url?: string; b64_json?: string };

class LingsuanImageProvider implements ImageProvider {
  name: string;
  modelVersion: string;
  private baseUrl: string;
  private key: string;
  private size: string;
  private quality: string;
  private inputFidelity: string;

  constructor(baseUrl: string, key: string, name: string, modelVersion: string) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
    this.key = key;
    this.name = name;
    this.modelVersion = modelVersion;
    this.size = process.env.LINGSUAN_IMAGE_SIZE || "1024x1024";
    this.quality = process.env.LINGSUAN_IMAGE_QUALITY || "high";
    // 默认空，见 buildRequest 的说明。
    this.inputFidelity = process.env.LINGSUAN_IMAGE_INPUT_FIDELITY?.trim() || "";
  }

  /**
   * 有参考图时走 `/v1/images/edits`（multipart），否则走 `/v1/images/generations`（JSON）。
   *
   * **不默认传 `input_fidelity`**：它能要求模型保住主体特征，听起来正是这个玩法要的。
   * lingsuan 上 `gpt-image-2` 接受该参数（packy 曾以 400
   * `invalid_input_fidelity_model` 拒绝），但「接受」只说明不报错 ——
   * 产物是否真更贴主体没有验证过，而 PL-10 的判据是用户认不认得出自家宠物。
   * 要开就用 `LINGSUAN_IMAGE_INPUT_FIDELITY=high` 显式打开，并同期人眼比对一批。
   */
  private buildRequest(prompt: string, referenceInput?: ImageReferenceInput, options: ImageGenerationOptions = {}) {
    const references = normalizeReferences(referenceInput);
    const size = options.size || this.size;
    const quality = options.quality || this.quality;
    const inputFidelity = options.inputFidelity || this.inputFidelity;
    if (!references.length) {
      return {
        url: `${this.baseUrl}/v1/images/generations`,
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${this.key}`, "Content-Type": "application/json", Accept: "*/*" },
          // 不传 response_format：默认的 url 形态更省内存，见类注释。
          body: JSON.stringify({ model: this.modelVersion, prompt, size, quality, output_format: "png", n: 1 }),
        } as RequestInit,
      };
    }
    const form = new FormData();
    form.append("model", this.modelVersion);
    form.append("prompt", prompt);
    /*
     * Blob 的 type 必须是真实图片 MIME：接口只认 image/jpeg、image/png、image/webp，
     * 收到 application/octet-stream 会以 unsupported_file_mimetype 拒绝。
     * 上游 contentType 不可信时（存储回落成 octet-stream）统一按 png 送。
     */
    references.forEach((reference, index) => {
      const mime = /^image\/(jpeg|png|webp)$/.test(reference.contentType) ? reference.contentType : "image/png";
      form.append("image", new Blob([reference.body as unknown as BlobPart], { type: mime }), reference.filename || `reference-${index + 1}.png`);
    });
    form.append("size", size);
    form.append("quality", quality);
    form.append("output_format", "png");
    // 同 generations：不传 response_format。input_fidelity 见类注释。
    if (inputFidelity) form.append("input_fidelity", inputFidelity);
    form.append("n", "1");
    return {
      url: `${this.baseUrl}/v1/images/edits`,
      // multipart 的 Content-Type 必须由 fetch 自己带 boundary，不能手写。
      init: { method: "POST", headers: { Authorization: `Bearer ${this.key}`, Accept: "*/*" }, body: form } as RequestInit,
    };
  }

  /** 单张。4xx（除 429）标记为不可重试 —— 提示词违规重试多少次都一样。 */
  private async once(prompt: string, references?: ImageReferenceInput, options?: ImageGenerationOptions): Promise<ImageOutput> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), LINGSUAN_TIMEOUT_MS);
    try {
      const request = this.buildRequest(prompt, references, options);
      const response = await fetch(request.url, { ...request.init, signal: controller.signal });
      if (!response.ok) {
        const error = new Error(`AI_PROVIDER_${response.status}`) as Error & { permanent?: boolean };
        if (response.status >= 400 && response.status < 500 && response.status !== 429) error.permanent = true;
        throw error;
      }
      const payload = (await response.json()) as { data?: LingsuanItem[] };
      const item = payload.data?.[0];
      if (!item) throw new Error("AI_PROVIDER_EMPTY");
      /*
       * 两种返回形态都要收，顺序是「有 b64_json 且非空就用它，否则用 url」：
       * b64_json 已经是图片本体，省一次往返；url 还要再下载一次，而且**下载主机与
       * API 主机不同**（lingsuan 实测下发 `img.junliai.org`）—— 出网白名单只放
       * `lingsuan.top` 会让取字节这一步整条失败，而生成本身是成功的。
       *
       * `item.b64_json` 的空串必须落到 url 分支 —— 空字符串是假值，直接
       * `Buffer.from("", "base64")` 会得到 0 字节的「成功」结果，
       * 存进对象存储后端上表现为裂图且不报错。
       */
      if (item.b64_json) return { body: new Uint8Array(Buffer.from(item.b64_json, "base64")), contentType: "image/png" };
      if (!item.url) throw new Error("AI_PROVIDER_OUTPUT_EMPTY");
      const download = await fetch(item.url, { signal: controller.signal });
      if (!download.ok) throw new Error("AI_PROVIDER_DOWNLOAD_FAILED");
      const body = new Uint8Array(await download.arrayBuffer());
      // 下载到 0 字节同样要当失败：让熔断和主备切换有机会介入，而不是把空图入库。
      if (!body.byteLength) throw new Error("AI_PROVIDER_DOWNLOAD_EMPTY");
      return { body, contentType: download.headers.get("content-type") || "image/png" };
    } finally {
      clearTimeout(timer);
    }
  }

  /** 429/5xx/网络错误最多重试 3 次；明确不可恢复的 4xx 立即失败。 */
  private async withRetry(prompt: string, references?: ImageReferenceInput, options?: ImageGenerationOptions): Promise<ImageOutput> {
    let lastError: unknown;
    for (let retry = 0; retry <= 3; retry += 1) {
      try {
        return await this.once(prompt, references, options);
      } catch (error) {
        lastError = error;
        if ((error as { permanent?: boolean }).permanent || retry === 3) throw error;
        await new Promise((resolve) => setTimeout(resolve, 1500));
      }
    }
    throw lastError instanceof Error ? lastError : new Error("AI_PROVIDER_RETRY_EXHAUSTED");
  }

  async generate(prompt: string, count: number, references?: ImageReferenceInput, options?: ImageGenerationOptions) {
    /*
     * `n=1` 迫使我们发 count 次请求。这里必须使用模块级共享队列，而不是每次
     * `generate()` 各建一个工作池：同一进程内的 PL-10、岛立绘和并行任务会共享
     * 同一组供应商槽位，环境变量即使误配为大于 20 也会被硬截断。
     *
     * 任一张失败仍整体抛错：PL-10 承诺的是「四选一」，只给两张属于降级交付，
     * 交给上层熔断/主备重跑更合适。失败任务的槽位由队列 finally 释放。
     */
    return Promise.all(Array.from(
      { length: count },
      () => lingsuanRequestQueue.run(() => this.withRetry(prompt, references, options)),
    ));
  }
}

/**
 * 生产缺凭据时的占位实现。
 *
 * 与 `LocalImageProvider` 的区别是它**不产出任何图**，直接抛 503 ——
 * 参照 `ConfiguredCloudStorage.config()` 的口径：正式生产宁可明确失败，
 * 也不能把纯色块当成 AI 肖像交付给付了钱的用户。
 */
class UnconfiguredImageProvider implements ImageProvider {
  name = "unconfigured";
  modelVersion = "unconfigured";

  async generate(): Promise<ImageOutput[]> {
    throw new AppError("AI_PROVIDER_CONFIG_PENDING", "AI 图片服务尚未配置", 503);
  }
}

const localProvider = new LocalImageProvider();
/*
 * 主通道优先级：lingsuan > 通用 HTTP > 本地占位图。
 *
 * lingsuan 优先是因为它是当前实际接入的服务；通用 HTTP 分支保留给尚未迁移的备用供应商，
 * 不能直接删 —— 线上可能正靠它兜底。
 *
 * 两者都没配时按环境分岔：开发/测试机回落 LocalImageProvider（无凭据也能跑通链路），
 * **正式生产回落到 UnconfiguredImageProvider 直接失败** —— 色块不是可交付的产物。
 */
const fallbackProvider: ImageProvider = isRealProduction() ? new UnconfiguredImageProvider() : localProvider;
const lingsuanPrimary = process.env.LINGSUAN_IMAGE_BASE_URL && process.env.LINGSUAN_IMAGE_API_KEY
  ? new LingsuanImageProvider(process.env.LINGSUAN_IMAGE_BASE_URL, process.env.LINGSUAN_IMAGE_API_KEY, "lingsuan", process.env.LINGSUAN_IMAGE_MODEL || "gpt-image-2")
  : null;
const primaryProvider = lingsuanPrimary
  || (process.env.AI_IMAGE_ENDPOINT && process.env.AI_IMAGE_API_KEY
    ? new HttpImageProvider(process.env.AI_IMAGE_ENDPOINT, process.env.AI_IMAGE_API_KEY, "primary", process.env.AI_IMAGE_MODEL || "provider-v1")
    : fallbackProvider);
/*
 * 备用通道：显式配置的 SECONDARY 最优先；没配但 lingsuan 已占据主位时，
 * 把原来的 AI_IMAGE_ENDPOINT 顺延为备用 —— 否则接入 lingsuan 等于把原主通道直接下线，
 * 反而削弱了容灾能力。
 */
const secondaryProvider = process.env.AI_IMAGE_SECONDARY_ENDPOINT && process.env.AI_IMAGE_SECONDARY_API_KEY
  ? new HttpImageProvider(process.env.AI_IMAGE_SECONDARY_ENDPOINT, process.env.AI_IMAGE_SECONDARY_API_KEY, "secondary", process.env.AI_IMAGE_SECONDARY_MODEL || "provider-v1")
  : (lingsuanPrimary && process.env.AI_IMAGE_ENDPOINT && process.env.AI_IMAGE_API_KEY
    ? new HttpImageProvider(process.env.AI_IMAGE_ENDPOINT, process.env.AI_IMAGE_API_KEY, "secondary", process.env.AI_IMAGE_MODEL || "provider-v1")
    : fallbackProvider);

export const imageProvider = primaryProvider;
export const imageProviders = [primaryProvider, secondaryProvider].filter((item, index, list) => list.findIndex((candidate) => candidate.name === item.name) === index);

export async function generateWithFailover(prompt: string, count: number, isOpen: (provider: string) => Promise<boolean>, onFailure: (provider: string, error: unknown) => Promise<void>, references?: ImageReferenceInput, options?: ImageGenerationOptions) {
  let lastError: unknown;
  for (const provider of imageProviders) {
    if (await isOpen(provider.name)) continue;
    try {
      const images = await provider.generate(prompt, count, references, options);
      return { provider, images };
    } catch (error) {
      lastError = error;
      await onFailure(provider.name, error);
    }
  }
  throw lastError instanceof Error ? lastError : new Error("AI_PROVIDER_UNAVAILABLE");
}
