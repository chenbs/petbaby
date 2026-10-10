import "server-only";

import { AppError } from "@/server/errors";
import { isStaging, isTestHarness } from "@/server/runtime-mode";
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
  "你是宠物健康助手，帮主人整理宠物的情况：判断紧急程度，并告诉主人现在可以做些什么。语气温和、简短，像一位懂宠物的朋友。",
  "严格禁止：给出疾病诊断结论；说出任何病名（例如胃炎、肠梗阻、猫瘟、感染、结石、过敏），也不要用「疑似」「可能是某某病」这类说法；提到任何药物名称、类别、剂量或用法；给出准确率数字；说「不用去医院」。只描述看到的表现和相关的身体部位。",
  "允许：说明症状可能与哪些身体部位相关；给出在家观察的要点；列出现在可以做的事（例如记录进食与排便、准备好疫苗驱虫记录）。",
  "紧急程度分四档，按下面的标准选，不要一律选 urgent_24h：",
  "- emergency（立即就医）：呼吸困难、抽搐、误食有毒物、无法排尿、大量出血、超过 24 小时完全不吃不喝且精神很差、腹部胀硬伴反复呕吐。",
  "- urgent_24h（今天去看）：反复呕吐或水样腹泻一天以上、明显疼痛或跛行、尿频尿少、持续不吃、老年宠物的饮水和体重明显变化、精神明显变差。",
  "- observe（先在家观察）：精神食欲正常的轻度表现，例如偶尔打喷嚏、少量眼屎、轻度挠痒、吐了一次毛球或软便一次。",
  "- routine（一般不用担心）：主人描述的是正常行为或非常轻微、已经好转的情况。",
  "每一档（包括 routine）都必须给出 watchFor（出现什么情况要及时带它去看看）和 visitPreparation（现在可以做的），不能留空。",
  "只复述主人说过的数字和细节，不要改写（主人说「一两个」就不要写成「两三个」）。",
  "如果提供了「近 7 天日常记录」，把它当作主人记下的事实背景：同类表现反复出现、持续多天或叠加食欲下降时，紧急程度应相应提高，并在 summary 里用一句话点出你注意到的记录（只复述事实，不推测病因）。",
  "没有提供「近 7 天日常记录」时，不要提及或编造过去几天的情况，也不要推测持续了多久，只依据主人这次的描述。",
  "summary 是一两句口语：先说你注意到的关键表现，再说为什么是这个紧急程度。页面上已经单独显示了档位，summary 不要只重复「建议今天带它去看看」。除 emergency 档外，summary 里不要出现「就医」「医院」「排查」这些词，用「带它去看看」「请医生看看」代替；emergency 档必须写明「请现在就联系医院」。",
  "relatedAreas 只写和这次描述直接相关的身体部位或系统（例如胃肠、泌尿、耳部、皮肤、关节），通常 1 到 2 个，不要为了凑数加上无关部位，也不要写症状或行为。",
  "visitPreparation 是「现在可以做的」，按这只宠物和这次的情况给 3 到 4 条最实用的：在家能做的观察和记录、需要保存的照片或样本、要避免的做法。不要写药物或处置方法，不要写和情况无关的物品。",
  "summary 不超过 60 字；relatedAreas 不超过 3 条，watchFor 不超过 4 条，visitPreparation 不超过 4 条，每条不超过 24 字。全部使用简体中文。",
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

    return sanitizeAdvisory({
      level,
      summary: level === "urgent_24h"
        ? bodilyDays >= 2 && !urgentNow
          ? `近 7 天有 ${bodilyDays} 天记了类似情况，建议今天带它去看看，请医生当面确认。`
          : "建议今天带它去看看，请医生当面确认。"
        : level === "observe"
          ? "可以先在家观察，出现下面这些情况要及时带它去看看。"
          : "这类表现一般不用太担心，留意变化，持续或加重时及时带它去看看。",
      relatedAreas: areas,
      watchFor: [
        "症状持续超过 24 小时或明显加重",
        "精神、食欲或饮水量下降",
        "出现呼吸急促、抽搐、无法排尿等情况",
      ],
      visitPreparation: [
        records.length ? "日常记录里的「整理近况」可以一键汇总最近的情况" : "记下症状开始的时间与变化过程",
        `留意${request.pet.name}的精神、食欲和排便有没有变化`,
        "整理好疫苗与驱虫记录",
      ],
      disclaimer: TRIAGE_DISCLAIMER,
    });
  }
}


interface HttpTriageOptions {
  endpoint: string;
  apiKey: string;
  model: string;
  /** 是否带 `response_format: json_object`。百炼、DeepSeek 等 OpenAI 兼容接口都支持；个别网关不认时可关 */
  jsonMode: boolean;
  /** 是否显式关闭思考模式（百炼 enable_thinking=false）。DeepSeek 等不认这个参数的网关填 false */
  disableThinking: boolean;
  timeoutMs: number;
}

/**
 * OpenAI Chat Completions 兼容的 HTTP 实现。
 *
 * 只发文字（2026-10-10 起健康分诊不接收图片）：`content` 走纯字符串，
 * 部分纯文本模型不接受数组形式的 content。
 */
class HttpTriageProvider {
  constructor(readonly name: string, private readonly options: HttpTriageOptions) {}

  get model() {
    return this.options.model;
  }

  async advise(request: TriageRequest): Promise<TriageAdvisory> {
    const content = buildTriageUserText(request);
    const response = await fetch(this.options.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${this.options.apiKey}` },
      body: JSON.stringify({
        model: this.options.model,
        messages: [{ role: "system", content: SYSTEM_PROMPT }, { role: "user", content }],
        // 分诊要稳定，不要创意：同样的描述两次给出不同档位是最糟的体验
        temperature: 0.2,
        // 百炼新版 Flash / Plus 默认开思考，开着会慢好几倍且 JSON 模式可能失效；分诊不需要推理链
        ...(this.options.disableThinking ? { enable_thinking: false } : {}),
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
    this.modelVersion = channels.map((channel) => channel.model).join("|");
  }

  async adviseWithMeta(request: TriageRequest) {
    const errors: string[] = [];
    for (const channel of this.channels) {
      try {
        return { advisory: await channel.advise(request), provider: channel.name, model: channel.model, errors };
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
    model: process.env[prefix] || "qwen-flash",
    jsonMode: process.env.HEALTH_MODEL_JSON_MODE !== "false",
    disableThinking: (process.env[`${prefix}_DISABLE_THINKING`] ?? (endpoint.includes("dashscope") || endpoint.includes("maas.aliyuncs") ? "true" : "false")) === "true",
    timeoutMs: Math.min(60_000, Math.max(5_000, Number(process.env.HEALTH_MODEL_TIMEOUT_MS) || 20_000)),
  });
}

let cached: TriageProvider | undefined;

/**
 * 环境变量：
 * - `HEALTH_MODEL_ENDPOINT` / `HEALTH_MODEL_API_KEY` / `HEALTH_MODEL`（缺省 qwen-flash）
 * - `HEALTH_MODEL_DISABLE_THINKING`：百炼地址默认 true（发 enable_thinking=false），其他地址默认 false
 * - 备用通道同名加 `_SECONDARY`：`HEALTH_MODEL_SECONDARY_ENDPOINT` / `..._API_KEY` / `HEALTH_MODEL_SECONDARY`
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
  // 本地开发与正式生产同口径（2026-10-09）：只有 staging 测试机与自动化测试夹具可用规则实现。
  if (!isStaging() && !isTestHarness()) {
    throw new AppError("HEALTH_PROVIDER_CONFIG_PENDING", "健康助手服务尚未配置", 503);
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
