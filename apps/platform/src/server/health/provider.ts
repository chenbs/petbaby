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
  /** 近 7 天的日常记录（已转成文字行，见 daily-log-context）。只作背景，不替代主人这次的描述 */
  recentRecords?: string[];
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
  "如果提供了「近 7 天日常记录」，把它当作主人记下的事实背景：同类表现反复出现、持续多天或叠加食欲下降时，紧急程度应相应提高，并在 summary 里用一句话点出你注意到的记录（只复述事实，不推测病因）。",
  "visitPreparation 要具体到这只宠物：例如带上呕吐物照片、记下最近几次进食与排便的时间。",
  "summary 不超过 80 字；relatedAreas、watchFor、visitPreparation 各不超过 5 条，每条不超过 30 字。全部使用简体中文。",
  '只返回 JSON：{"level":"...","summary":"...","relatedAreas":[],"watchFor":[],"visitPreparation":[]}',
].join("\n");

/** 用户消息正文。品种、月龄、体重、生命阶段 + 近期记录 + 这次的描述 */
export function buildTriageUserText(request: TriageRequest) {
  const species = { cat: "猫", dog: "狗" }[request.pet.species] || request.pet.species;
  const petLine = `物种：${species}；名字：${request.pet.name}；${request.pet.ageMonths !== undefined ? `月龄：${request.pet.ageMonths}；` : ""}${request.pet.weightGrams ? `体重：${(request.pet.weightGrams / 1000).toFixed(2)} 公斤；` : ""}生命阶段：${request.pet.lifeStage}`;
  const records = request.recentRecords?.length ? `\n近 7 天日常记录（主人记录）：\n${request.recentRecords.map((line) => `- ${line}`).join("\n")}` : "";
  return `${petLine}${records}\n主人这次的描述：${request.description}`;
}

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
    const records = request.recentRecords || [];
    // 紧急档由 health-service 的关键词直通处理，走到这里说明未命中。
    const urgentNow = /(不吃|不喝|拒食)(东西|饭|水)?|精神(很)?差|嗜睡|发[烧热]|拉稀|腹泻|呕吐|吐了|出血|疼|叫得?厉害|跛|瘸/.test(text);
    // 近 7 天里同类身体状况记了 2 天以上，也按 24 小时内就医处理（与提示词里「反复出现应提高档位」同口径）
    const bodilyDays = new Set(records.filter((line) => /呕吐|便便 · (偏软|糊状|水样)|不舒服/.test(line)).map((line) => line.slice(0, 5))).size;
    const urgent = urgentNow || bodilyDays >= 2;
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
        ? bodilyDays >= 2 && !urgentNow
          ? `近 7 天有 ${bodilyDays} 天记了类似情况，建议 24 小时内就医，由执业兽医面诊确认。`
          : "建议 24 小时内就医，由执业兽医面诊确认。"
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
        records.length ? "打开日常记录里的「给兽医看」，把最近的记录给医生看" : "记下症状开始的时间与变化过程",
        `说明${request.pet.name}的品种、年龄与体重`,
      ],
      disclaimer: TRIAGE_DISCLAIMER,
    });
  }
}


interface HttpTriageOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  /** 有图时改用的多模态模型。不配则用 `model`（要求它本身支持图片） */
  visionModel?: string;
  /** 是否带 `response_format: json_object`。百炼、DeepSeek 等 OpenAI 兼容接口都支持；个别网关不认时可关 */
  jsonMode: boolean;
  timeoutMs: number;
}

/**
 * OpenAI Chat Completions 兼容的 HTTP 实现。
 *
 * 无图时 `content` 走纯字符串：部分纯文本模型不接受数组形式的 content，
 * 只在有图时才拼 `image_url` 数组并切到多模态模型。
 */
class HttpTriageProvider {
  constructor(readonly name: string, private readonly options: HttpTriageOptions) {}

  modelFor(request: TriageRequest) {
    return request.images.length && this.options.visionModel ? this.options.visionModel : this.options.model;
  }

  async advise(request: TriageRequest): Promise<TriageAdvisory> {
    const text = buildTriageUserText(request);
    const content = request.images.length
      ? [
        { type: "text", text },
        ...request.images.map((image) => ({
          type: "image_url",
          image_url: { url: `data:${image.contentType};base64,${Buffer.from(image.body).toString("base64")}` },
        })),
      ]
      : text;
    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        model: this.modelFor(request),
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }],
        // 分诊要稳定，不要创意：同样的描述两次给出不同档位是最糟的体验
        temperature: 0.2,
        max_tokens: 800,
        ...(this.options.jsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
      signal: AbortSignal.timeout(this.options.timeoutMs),
    });
    if (!response.ok) throw new Error(`HEALTH_PROVIDER_${response.status}`);
    const payload = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
    const raw = payload.choices?.[0]?.message?.content;
    if (!raw) throw new Error("HEALTH_PROVIDER_EMPTY");
    return parseTriageContent(raw);
  }
}

/**
 * 解析模型返回的 JSON。
 *
 * 模型可能把 JSON 包在 ```json 围栏里，也可能前后带解释文字。
 * 取第一个 { 到最后一个 } 之间的片段，解析失败就整体降级 ——
 * 宁可给通用建议，也不要把模型的自由文本当结论展示。
 */
export function parseTriageContent(content: string): TriageAdvisory {
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
    Array.isArray(value) ? value.map((item) => String(item).slice(0, 60)).filter(Boolean).slice(0, 6) : [];

  return sanitizeAdvisory({
    level: normalizeLevel(parsed.level),
    summary: String(parsed.summary || "").slice(0, 300) || fallbackAdvisory("observe").summary,
    relatedAreas: toStrings(parsed.relatedAreas),
    watchFor: toStrings(parsed.watchFor),
    visitPreparation: toStrings(parsed.visitPreparation),
    disclaimer: TRIAGE_DISCLAIMER,
  });
}

/**
 * 主备两条通道。主通道超时或报错时切备用，两条都失败才抛错（由 health-service 落库 failed）。
 * 与 ai/provider.ts 的 generateWithFailover 同思路，但不做熔断：健康线量小，
 * 每次请求都先试主通道，恢复后自然回到主通道。
 */
class FailoverTriageProvider implements TriageProvider {
  readonly name: string;
  readonly modelVersion: string;

  constructor(private readonly channels: HttpTriageProvider[]) {
    this.name = channels.map((channel) => channel.name).join("+");
    this.modelVersion = channels.map((channel) => channel.modelFor({ description: "", pet: { name: "", species: "", lifeStage: "" }, images: [] })).join("|");
  }

  async adviseWithMeta(request: TriageRequest) {
    const errors: string[] = [];
    for (const channel of this.channels) {
      try {
        return { advisory: await channel.advise(request), provider: channel.name, model: channel.modelFor(request), errors };
      } catch (error) {
        errors.push(`${channel.name}:${error instanceof Error ? error.message.slice(0, 60) : "UNKNOWN"}`);
      }
    }
    throw new Error(errors.join(";").slice(0, 100) || "HEALTH_PROVIDER_UNAVAILABLE");
  }

  async advise(request: TriageRequest) {
    return (await this.adviseWithMeta(request)).advisory;
  }
}

function channelFromEnv(prefix: string, name: string): HttpTriageProvider | undefined {
  const endpoint = process.env[`${prefix}_ENDPOINT`];
  const apiKey = process.env[`${prefix}_API_KEY`];
  if (!endpoint || !apiKey) return undefined;
  return new HttpTriageProvider(name, {
    endpoint,
    apiKey,
    model: process.env[prefix] || "qwen-plus",
    visionModel: process.env[`${prefix}_VISION`] || undefined,
    jsonMode: process.env.HEALTH_MODEL_JSON_MODE !== "false",
    timeoutMs: Math.min(60_000, Math.max(5_000, Number(process.env.HEALTH_MODEL_TIMEOUT_MS) || 20_000)),
  });
}

let cached: TriageProvider | undefined;

/**
 * 环境变量：
 * - `HEALTH_MODEL_ENDPOINT` / `HEALTH_MODEL_API_KEY` / `HEALTH_MODEL`（缺省 qwen-plus）/ `HEALTH_MODEL_VISION`（有图时用）
 * - 备用通道同名加 `_SECONDARY`：`HEALTH_MODEL_SECONDARY_ENDPOINT` / `..._API_KEY` / `HEALTH_MODEL_SECONDARY` / `HEALTH_MODEL_SECONDARY_VISION`
 * - `HEALTH_MODEL_TIMEOUT_MS`（缺省 20000）、`HEALTH_MODEL_JSON_MODE`（缺省开启，填 false 关闭）
 */
export function selectTriageProvider(): TriageProvider {
  if (cached) return cached;
  const channels = [channelFromEnv("HEALTH_MODEL", "primary"), channelFromEnv("HEALTH_MODEL_SECONDARY", "secondary")].filter(Boolean) as HttpTriageProvider[];
  if (channels.length) {
    cached = new FailoverTriageProvider(channels);
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

/** 取一次建议并带上实际用到的通道与模型，供落库审计。 */
export async function adviseWithMeta(provider: TriageProvider, request: TriageRequest) {
  if (provider instanceof FailoverTriageProvider) return provider.adviseWithMeta(request);
  return { advisory: await provider.advise(request), provider: provider.name, model: provider.modelVersion, errors: [] as string[] };
}

/** 测试用：清掉 provider 缓存，让环境变量改动生效。 */
export function resetTriageProviderForTest() {
  cached = undefined;
}
