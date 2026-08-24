import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 锁定 lingsuan 的报文契约。
 *
 * 这组测试的价值在于：provider 与真实接口对不上时，症状是线上生成全失败，
 * 而本地跑 LocalImageProvider 一切正常，等于没有任何早期信号。
 * 报文字段（n=1、不传 response_format、data[].b64_json 与 data[].url 两种形态）
 * 因此必须在单测里钉死。
 *
 * provider.ts 在模块加载时读环境变量决定主备，所以每个用例都要先设环境再动态 import，
 * 并配合 resetModules 拿到干净实例。
 */
const ENV = {
  LINGSUAN_IMAGE_BASE_URL: "https://lingsuan.test/api/",
  LINGSUAN_IMAGE_API_KEY: "test-key",
  LINGSUAN_IMAGE_MODEL: "gpt-image-2",
};

function pngPayload() {
  return { data: [{ b64_json: Buffer.from("fake-png-bytes").toString("base64") }] };
}

function jsonResponse(body: unknown, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body, headers: new Headers() } as unknown as Response;
}

async function loadProvider() {
  vi.resetModules();
  for (const [key, value] of Object.entries(ENV)) vi.stubEnv(key, value);
  return import("@/server/ai/provider");
}

describe("LingsuanImageProvider", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  it("请求体符合 lingsuan 契约，且 n 恒为 1", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const images = await imageProvider.generate("一只橘猫", 1);

    expect(images).toHaveLength(1);
    expect(images[0].contentType).toBe("image/png");
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    // baseUrl 末尾斜杠要被规整掉，否则会请求出 //v1/...
    expect(url).toBe("https://lingsuan.test/api/v1/images/generations");
    const body = JSON.parse(String(init.body));
    expect(body).toMatchObject({ model: "gpt-image-2", prompt: "一只橘猫", n: 1 });
    // 不传 response_format：接口默认给 url，比 base64 省内存（单张 high 约 3.8MB）。
    expect(body).not.toHaveProperty("response_format");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
  });

  it("count=4 时发 4 次请求（接口不支持批量）", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const images = await imageProvider.generate("四选一", 4);

    expect(images).toHaveLength(4);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    for (const call of fetchMock.mock.calls) {
      expect(JSON.parse(String((call as unknown as [string, RequestInit])[1].body)).n).toBe(1);
    }
    // 每张都要真有内容，避免并发写入 results 时留下空洞
    for (const image of images) expect(image.body.byteLength).toBeGreaterThan(0);
  });

  it("不同 generate 调用共享队列，配置再大也最多同时请求 20 张", async () => {
    vi.stubEnv("LINGSUAN_IMAGE_CONCURRENCY", "99");
    let active = 0;
    let peak = 0;
    const fetchMock = vi.fn(async () => {
      active += 1;
      peak = Math.max(peak, active);
      await new Promise((resolve) => setTimeout(resolve, 10));
      active -= 1;
      return jsonResponse(pngPayload());
    });
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const [first, second] = await Promise.all([
      imageProvider.generate("第一批", 12),
      imageProvider.generate("第二批", 12),
    ]);

    expect(first).toHaveLength(12);
    expect(second).toHaveLength(12);
    expect(fetchMock).toHaveBeenCalledTimes(24);
    expect(peak).toBe(20);
  });

  /**
   * 返回形态随模型与代理站而变：lingsuan 上 `gpt-image-2` 默认给 url
   * （**且下载主机与 API 主机不同**），packy 时代同一模型只给 b64_json。
   * 两条分支都必须能走通 —— 按当前默认写死一条，换模型或换站就整条链路失效。
   *
   * url 是当前的默认路径，所以这条用例覆盖的是主路径而非兜底。
   */
  it("返回 url 而非 b64_json 时下载补齐", async () => {
    const fetchMock = vi.fn(async (input: string) => (input.includes("/v1/images/generations")
      ? jsonResponse({ data: [{ url: "https://cdn.test/a.png" }] })
      : ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("downloaded").buffer, headers: new Headers({ "content-type": "image/png" }) } as unknown as Response)));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const images = await imageProvider.generate("走 url 分支", 1);

    expect(new TextDecoder().decode(images[0].body)).toBe("downloaded");
  });

  /**
   * 空 b64_json 必须落到 url 分支。
   *
   * 空串是假值，若写成 `item.b64_json !== undefined` 之类的判断，
   * `Buffer.from("", "base64")` 会得到 0 字节的「成功」结果，
   * 存进对象存储后端上表现为裂图且不报错。
   */
  it("b64_json 为空串时回落到 url", async () => {
    const fetchMock = vi.fn(async (input: string) => (input.includes("/v1/images/generations")
      ? jsonResponse({ data: [{ b64_json: "", url: "https://cdn.test/b.png" }] })
      : ({ ok: true, status: 200, arrayBuffer: async () => new TextEncoder().encode("from-url").buffer, headers: new Headers({ "content-type": "image/png" }) } as unknown as Response)));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const images = await imageProvider.generate("空 b64", 1);

    expect(new TextDecoder().decode(images[0].body)).toBe("from-url");
  });

  it("两者都缺时报错，不产出空图", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [{}] })));
    const { imageProvider } = await loadProvider();
    await expect(imageProvider.generate("空响应", 1)).rejects.toThrow("AI_PROVIDER_OUTPUT_EMPTY");
  });

  /** 下载到 0 字节也要当失败，让熔断与主备切换有机会介入 */
  it("url 下载到 0 字节时报错", async () => {
    const fetchMock = vi.fn(async (input: string) => (input.includes("/v1/images/generations")
      ? jsonResponse({ data: [{ url: "https://cdn.test/empty.png" }] })
      : ({ ok: true, status: 200, arrayBuffer: async () => new ArrayBuffer(0), headers: new Headers({ "content-type": "image/png" }) } as unknown as Response)));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();
    await expect(imageProvider.generate("空下载", 1)).rejects.toThrow("AI_PROVIDER_DOWNLOAD_EMPTY");
  });

  it("5xx 最多重试三次并在第四次请求成功", async () => {
    let calls = 0;
    const fetchMock = vi.fn(async () => {
      calls += 1;
      return calls <= 3 ? jsonResponse({ error: "boom" }, 503) : jsonResponse(pngPayload());
    });
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    const images = await imageProvider.generate("抖动", 1);

    expect(images).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(4);
  });

  it("4xx 不重试，直接抛错", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ error: "bad prompt" }, 400));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    await expect(imageProvider.generate("违规提示词", 1)).rejects.toThrow("AI_PROVIDER_400");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  /**
   * 有参考图时必须走 /v1/images/edits 的 multipart，并带 input_fidelity=high。
   *
   * PL-10 卖的是「像我家这只」：走文生图只会得到「某只橘猫」，
   * 用户拿到一张不是自家宠物的图，这个玩法就是坏的。
   */
  it("带参考图时走 edits 端点的 multipart", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    await imageProvider.generate("温柔胶片风", 1, { body: new Uint8Array([1, 2, 3]), contentType: "image/jpeg", filename: "cat.jpg" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lingsuan.test/api/v1/images/edits");
    const form = init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect(form.get("prompt")).toBe("温柔胶片风");
    /*
     * 默认不带 input_fidelity。lingsuan 上接口**接受**它（packy 曾以 400
     * invalid_input_fidelity_model 拒绝），但「接受」只说明不报错 ——
     * 产物是否真更贴主体未验证过，要开先人眼比对一批。
     */
    expect(form.get("input_fidelity")).toBeNull();
    expect(form.get("n")).toBe("1");
    expect(form.get("response_format")).toBeNull();
    const image = form.get("image") as Blob;
    expect(image).toBeInstanceOf(Blob);
    // 接口只认 image/jpeg|png|webp；octet-stream 会以 unsupported_file_mimetype 拒绝。
    expect(image.type).toBe("image/jpeg");
    // multipart 的 Content-Type 必须由 fetch 自带 boundary，手写会让服务端解不出分段。
    expect((init.headers as Record<string, string>)["Content-Type"]).toBeUndefined();
  });

  it("多参考图按母版、主人、宠物顺序重复上传 image 字段", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    await imageProvider.generate("三参考角色替换", 1, [
      { body: new Uint8Array([1]), contentType: "image/png", filename: "01-master.png" },
      { body: new Uint8Array([2]), contentType: "image/jpeg", filename: "02-owner.jpg" },
      { body: new Uint8Array([3]), contentType: "image/webp", filename: "03-pet.webp" },
    ], { size: "720x1280", quality: "high", inputFidelity: "high" });

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lingsuan.test/api/v1/images/edits");
    const form = init.body as FormData;
    const images = form.getAll("image") as File[];
    expect(images.map((image) => image.name)).toEqual(["01-master.png", "02-owner.jpg", "03-pet.webp"]);
    expect(images.map((image) => image.type)).toEqual(["image/png", "image/jpeg", "image/webp"]);
    expect(form.get("size")).toBe("720x1280");
    expect(form.get("quality")).toBe("high");
    expect(form.get("input_fidelity")).toBe("high");
  });

  /** 换到支持 input_fidelity 的模型时，用环境变量显式打开 */
  it("配了 LINGSUAN_IMAGE_INPUT_FIDELITY 时才带该参数", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("LINGSUAN_IMAGE_INPUT_FIDELITY", "high");
    const { imageProvider } = await loadProvider();

    await imageProvider.generate("保住主体", 1, { body: new Uint8Array([1]), contentType: "image/png" });

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect(form.get("input_fidelity")).toBe("high");
  });

  /** 上游 contentType 不可信时（存储回落成 octet-stream）不能原样送出 */
  it("非图片 MIME 的参考图统一按 png 送", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    await imageProvider.generate("兜底 MIME", 1, { body: new Uint8Array([1]), contentType: "application/octet-stream" });

    const form = (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1].body as FormData;
    expect((form.get("image") as Blob).type).toBe("image/png");
  });

  it("无参考图时仍走 generations 的 JSON 端点", async () => {
    const fetchMock = vi.fn(async () => jsonResponse(pngPayload()));
    vi.stubGlobal("fetch", fetchMock);
    const { imageProvider } = await loadProvider();

    await imageProvider.generate("纯文生图", 1);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://lingsuan.test/api/v1/images/generations");
    expect(typeof init.body).toBe("string");
  });

  it("lingsuan 占主位时，原 AI_IMAGE_ENDPOINT 顺延为备用通道", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse(pngPayload())));
    vi.stubEnv("AI_IMAGE_ENDPOINT", "https://legacy.test/generate");
    vi.stubEnv("AI_IMAGE_API_KEY", "legacy-key");
    const { imageProviders } = await loadProvider();

    expect(imageProviders.map((provider) => provider.name)).toEqual(["lingsuan", "secondary"]);
  });
});

/**
 * 无凭据时的回落分岔。
 *
 * 这些用例不设 LINGSUAN_* 环境变量，所以不能走 loadProvider()。
 */
describe("无凭据时的回落", () => {
  beforeEach(() => { vi.restoreAllMocks(); });
  afterEach(() => { vi.unstubAllEnvs(); });

  async function loadBare(env: Record<string, string> = {}) {
    vi.resetModules();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    return import("@/server/ai/provider");
  }

  it("开发环境回落本地占位图，链路能跑通", async () => {
    const { imageProvider } = await loadBare();
    expect(imageProvider.name).toBe("local");
    const images = await imageProvider.generate("占位", 2);
    expect(images).toHaveLength(2);
    expect(images[0].contentType).toBe("image/svg+xml");
  });

  /**
   * 正式生产缺凭据必须明确失败，而不是静默回落到色块 ——
   * 那是「抽象色块」违例，且用户为它付了钱。口径与
   * `ConfiguredCloudStorage.config()` 抛 503 一致。
   */
  it("正式生产缺凭据时抛 503，不产出色块", async () => {
    const { imageProvider } = await loadBare({ NODE_ENV: "production" });
    expect(imageProvider.name).toBe("unconfigured");
    await expect(imageProvider.generate("生产无凭据", 1)).rejects.toMatchObject({ code: "AI_PROVIDER_CONFIG_PENDING", status: 503 });
  });

  /** 测试机（staging）仍允许占位图：它的用途是验证链路，不面向付费用户 */
  it("staging 仍回落本地占位图", async () => {
    const { imageProvider } = await loadBare({ NODE_ENV: "production", APP_ENV: "staging" });
    expect(imageProvider.name).toBe("local");
  });
});
