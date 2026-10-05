import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { adviseWithMeta, buildTriageUserText, parseTriageContent, resetTriageProviderForTest, selectTriageProvider, type TriageRequest } from "@/server/health/provider";

const REQUEST: TriageRequest = {
  description: "今天吐了两次，精神还行",
  pet: { name: "年糕", species: "cat", ageMonths: 30, weightGrams: 4200, lifeStage: "active" },
  recentRecords: ["10-03 呕吐 · 1 次", "10-04 吃饭 · 吃了一点"],
  images: [],
};

const ENV_KEYS = [
  "HEALTH_MODEL", "HEALTH_MODEL_ENDPOINT", "HEALTH_MODEL_API_KEY", "HEALTH_MODEL_VISION",
  "HEALTH_MODEL_SECONDARY", "HEALTH_MODEL_SECONDARY_ENDPOINT", "HEALTH_MODEL_SECONDARY_API_KEY",
  "HEALTH_MODEL_JSON_MODE", "HEALTH_MODEL_TIMEOUT_MS",
];

function reply(content: string, status = 200) {
  return new Response(JSON.stringify({ choices: [{ message: { content } }] }), { status, headers: { "content-type": "application/json" } });
}

describe("健康分诊 HTTP provider", () => {
  const saved: Record<string, string | undefined> = {};
  beforeEach(() => {
    for (const key of ENV_KEYS) { saved[key] = process.env[key]; delete process.env[key]; }
    resetTriageProviderForTest();
  });
  afterEach(() => {
    for (const key of ENV_KEYS) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
    vi.unstubAllGlobals();
    resetTriageProviderForTest();
  });

  it("用户消息带上物种、月龄、体重与近 7 天记录", () => {
    const text = buildTriageUserText(REQUEST);
    expect(text).toContain("物种：猫");
    expect(text).toContain("月龄：30");
    expect(text).toContain("体重：4.20 公斤");
    expect(text).toContain("- 10-03 呕吐 · 1 次");
    expect(text.endsWith("主人这次的描述：今天吐了两次，精神还行")).toBe(true);
  });

  it("无图走纯文本 content、开 JSON 模式、低温度；有图切多模态模型", async () => {
    process.env.HEALTH_MODEL_ENDPOINT = "https://primary.example/v1/chat/completions";
    process.env.HEALTH_MODEL_API_KEY = "key";
    process.env.HEALTH_MODEL_ENDPOINT = "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";
    process.env.HEALTH_MODEL = "qwen-flash";
    process.env.HEALTH_MODEL_VISION = "qwen3-vl-flash";
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      bodies.push(JSON.parse(String(init.body)));
      return reply('```json\n{"level":"urgent_24h","summary":"前天也吐过一次，建议 24 小时内就医。","relatedAreas":["消化"],"watchFor":["持续呕吐"],"visitPreparation":["带上呕吐物照片"]}\n```');
    }));
    const provider = selectTriageProvider();
    const text = await adviseWithMeta(provider, REQUEST);
    expect(text).toMatchObject({ provider: "primary", model: "qwen-flash" });
    expect(text.advisory.level).toBe("urgent_24h");
    expect(typeof (bodies[0].messages as Array<{ content: unknown }>)[1].content).toBe("string");
    // 百炼地址默认显式关闭思考：新版 Flash 默认开思考，开着慢且 JSON 模式可能失效
    expect(bodies[0]).toMatchObject({ model: "qwen-flash", temperature: 0.2, enable_thinking: false, response_format: { type: "json_object" } });

    const image = await adviseWithMeta(provider, { ...REQUEST, images: [{ body: new Uint8Array([1, 2]), contentType: "image/png" }] });
    expect(image.model).toBe("qwen3-vl-flash");
    const content = (bodies[1].messages as Array<{ content: unknown }>)[1].content as Array<{ type: string }>;
    expect(content.map((part) => part.type)).toEqual(["text", "image_url"]);
  });

  it("主通道失败时切备用，审计里留下失败通道", async () => {
    process.env.HEALTH_MODEL_ENDPOINT = "https://primary.example";
    process.env.HEALTH_MODEL_API_KEY = "a";
    process.env.HEALTH_MODEL_SECONDARY_ENDPOINT = "https://secondary.example";
    process.env.HEALTH_MODEL_SECONDARY_API_KEY = "b";
    process.env.HEALTH_MODEL_SECONDARY = "deepseek-flash";
    process.env.HEALTH_MODEL_JSON_MODE = "false";
    const urls: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      urls.push(url);
      const body = JSON.parse(String(init.body));
      expect(body.response_format).toBeUndefined();
      // 非百炼地址不发 enable_thinking：DeepSeek 等网关不认识这个参数
      expect(body.enable_thinking).toBeUndefined();
      return url.includes("primary") ? reply("", 503) : reply('{"level":"observe","summary":"暂可观察。","watchFor":["精神变差"]}');
    }));
    const result = await adviseWithMeta(selectTriageProvider(), REQUEST);
    expect(urls).toEqual(["https://primary.example", "https://secondary.example"]);
    expect(result).toMatchObject({ provider: "secondary", model: "deepseek-flash", errors: ["primary:HEALTH_PROVIDER_503"] });
  });

  it("两条通道都失败时抛错，由 health-service 落库 failed", async () => {
    process.env.HEALTH_MODEL_ENDPOINT = "https://primary.example";
    process.env.HEALTH_MODEL_API_KEY = "a";
    vi.stubGlobal("fetch", vi.fn(async () => reply("", 500)));
    await expect(adviseWithMeta(selectTriageProvider(), REQUEST)).rejects.toThrow("HEALTH_PROVIDER_500");
  });

  it("模型输出提到药物时整段降级，保留档位", () => {
    const advisory = parseTriageContent('{"level":"urgent_24h","summary":"可以先喂点止吐药","watchFor":["持续呕吐"]}');
    expect(advisory.level).toBe("urgent_24h");
    expect(advisory.summary).not.toContain("止吐药");
  });

  it("非 JSON 输出降级为暂可观察", () => {
    expect(parseTriageContent("我觉得问题不大").level).toBe("observe");
    expect(parseTriageContent("{不是 JSON}").level).toBe("observe");
  });
});
