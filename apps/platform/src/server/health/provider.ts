import "server-only";

import { AppError } from "@/server/errors";
import {
  TRIAGE_DISCLAIMER,
  fallbackAdvisory,
  normalizeLevel,
  sanitizeAdvisory,
  type TriageAdvisory,
} from "@/server/health/triage";

/*
 * 健康分诊的模型 provider。沿用 ai/provider.ts 的模式：
 * 本地零配置实现 + HTTP 实现，按环境变量切换。
 */

export interface TriageRequest {
  description: string;
  pet: { name: string; species: string; ageMonths?: number; weightGrams?: number; lifeStage: string };
  /** 图片字节。有图时走多模态，无图时纯文本。 */
  images: Array<{ body: Uint8Array; contentType: string }>;
}

export interface TriageProvider {
  readonly name: string;
  readonly modelVersion: string;
  advise(request: TriageRequest): Promise<TriageAdvisory>;
}

/*
 * 提示词。三条硬约束写进系统指令，但**不依赖它生效** ——
 * triage.ts 的 sanitizeAdvisory 才是最后一道闸。
 * 提示词降低命中率，过滤保证正确性。
 */
const SYSTEM_PROMPT = [
  "你是宠物健康分诊助手。你的任务是判断紧急程度并给出就医准备建议。",
  "严格禁止：给出疾病诊断结论；提到任何药物名称、类别、剂量或用法；给出准确率数字；说「不用去医院」。",
  "允许：说明症状可能与哪些身体部位相关；给出观察指标；列出就医时该准备什么。",
  "紧急程度分四档：emergency（立即就医）、urgent_24h（24 小时内就医）、observe（暂可观察）、routine（通常无需担心）。",
  "每一档都必须给出「出现什么情况要立即就医」的升级条件。",
  '只返回 JSON：{"level":"...","summary":"...","relatedAreas":[],"watchFor":[],"visitPreparation":[]}',
].join("\n");

/**
 * 本地实现。**不是随机文本，而是基于关键词的确定性规则输出**。
 *
 * 这样 E2E 可断言，且开发时看到的结构与生产一致 —— 随机占位会让
 * 「本地能跑」变成一句空话（同 ai/provider.ts 那条「不能把纯色块当 AI 肖像
 * 交付给付了钱的用户」的判断）。
 */
class LocalTriageProvider implements TriageProvider {
  readonly name = "local";
  readonly modelVersion = "rule-v1";

  async advise(request: TriageRequest): Promise<TriageAdvisory> {
    const text = request.description;
    // 紧急档由 health-service 的关键词直通处理，走到这里说明未命中。
    const urgent = /(不吃|不喝|拒食)(东西|饭|水)?|精神(很)?差|嗜睡|发[烧热]|拉稀|腹泻|呕吐|吐了|出血|疼|叫得?厉害|跛|瘸/.test(text);
    const mild = /(掉毛|挠|痒|打喷嚏|眼泪|眼屎|耳朵(脏|味))/.test(text);
    const level = urgent ? "urgent_24h" : mild ? "observe" : "routine";
    const areas: string[] = [];
    if (/拉稀|腹泻|呕吐|吐了|不吃/.test(text)) areas.push("消化");
    if (/挠|痒|掉毛|皮肤|红肿/.test(text)) areas.push("皮肤");
    if (/眼泪|眼屎|眼睛/.test(text)) areas.push("眼部");
    if (/耳朵|甩头/.test(text)) areas.push("耳部");
    if (/跛|瘸|腿|关节/.test(text)) areas.push("运动");
    if (request.images.length) areas.push("影像仅作记录，未做判读");

    return sanitizeAdvisory({
      level,
      summary: level === "urgent_24h"
        ? "建议 24 小时内就医，由执业兽医面诊确认。"
        : level === "observe"
          ? "暂可观察，出现下列情况请立即就医。"
          : "这类表现通常无需担心，若持续或加重请就医。",
      relatedAreas: areas,
      watchFor: [
        "症状持续超过 24 小时或明显加重",
        "精神、食欲或饮水量下降",
        "出现呼吸急促、抽搐、无法排尿等情况",
      ],
      visitPreparation: [
        "带上疫苗与驱虫记录",
        "记下症状开始的时间与变化过程",
        `说明${request.pet.name}的品种、年龄与体重`,
      ],
      disclaimer: TRIAGE_DISCLAIMER,
    });
  }
}

class HttpTriageProvider implements TriageProvider {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string,
    readonly name = "http",
    readonly modelVersion = process.env.HEALTH_MODEL || "unknown",
  ) {}

  async advise(request: TriageRequest): Promise<TriageAdvisory> {
    const petLine = `品种：${request.pet.species}；名字：${request.pet.name}；${request.pet.ageMonths ? `月龄：${request.pet.ageMonths}；` : ""}${request.pet.weightGrams ? `体重：${(request.pet.weightGrams / 1000).toFixed(2)} 公斤；` : ""}生命阶段：${request.pet.lifeStage}`;
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.modelVersion,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `${petLine}\n主人描述：${request.description}` },
              ...request.images.map((image) => ({
                type: "image_url",
                image_url: { url: `data:${image.contentType};base64,${Buffer.from(image.body).toString("base64")}` },
              })),
            ],
          },
        ],
      }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`HEALTH_PROVIDER_${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const content = payload.choices?.[0]?.message?.content;
    if (!content) throw new Error("HEALTH_PROVIDER_EMPTY");

    /*
     * 模型可能把 JSON 包在 ```json 围栏里，也可能前后带解释文字。
     * 取第一个 { 到最后一个 } 之间的片段，解析失败就整体降级 ——
     * 宁可给通用建议，也不要把模型的自由文本当结论展示。
     */
    const start = content.indexOf("{");
    const end = content.lastIndexOf("}");
    if (start < 0 || end <= start) return fallbackAdvisory("observe");
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(content.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return fallbackAdvisory("observe");
    }

    const toStrings = (value: unknown) =>
      Array.isArray(value) ? value.map((item) => String(item)).filter(Boolean).slice(0, 6) : [];

    return sanitizeAdvisory({
      level: normalizeLevel(parsed.level),
      summary: String(parsed.summary || "").slice(0, 300) || fallbackAdvisory("observe").summary,
      relatedAreas: toStrings(parsed.relatedAreas),
      watchFor: toStrings(parsed.watchFor),
      visitPreparation: toStrings(parsed.visitPreparation),
      disclaimer: TRIAGE_DISCLAIMER,
    });
  }
}

let cached: TriageProvider | undefined;

export function selectTriageProvider(): TriageProvider {
  if (cached) return cached;
  const endpoint = process.env.HEALTH_MODEL_ENDPOINT;
  const apiKey = process.env.HEALTH_MODEL_API_KEY;
  if (endpoint && apiKey) {
    cached = new HttpTriageProvider(endpoint, apiKey);
    return cached;
  }
  /*
   * 生产环境不允许用本地规则实现顶替。
   *
   * 与 ai/provider.ts 同一个判断：本地实现是给开发用的，
   * 拿规则输出当健康建议交付给真实用户是另一种性质的问题。
   */
  if (process.env.NODE_ENV === "production" && process.env.APP_ENV !== "staging") {
    throw new AppError("HEALTH_PROVIDER_CONFIG_PENDING", "健康分诊服务尚未配置", 503);
  }
  cached = new LocalTriageProvider();
  return cached;
}

/** 测试用：清掉 provider 缓存，让环境变量改动生效。 */
export function resetTriageProviderForTest() {
  cached = undefined;
}
