/*
 * 岛日记：**模板拼装，不用大模型**（22 号文 4.2）。
 *
 * 这不是成本考虑。日记是每天必现的内容，用模型的话每天都有一次说错话的机会 ——
 * 尤其踩 4.1 #9（宠物表现健康状态）与 #12（诊疗措辞），而那两条是法律要求不是
 * 产品偏好。模板可以被门禁 15 **全量穷举**：遍历全部模板 × 全部变量组合跑一遍词表，
 * 穷举得完。这是选模板而非模型的主要理由。
 *
 * 存的是 `template_id` + `payload`，**不是成品文案**（0024 的表注释已写明）：
 * 模板改了措辞（例如门禁扫出一个评价词）之后历史日记应当跟着修正，
 * 而存成品会把违规文案永久固化在库里。所以渲染在读取侧。
 *
 * 两套时间口径不混（CLAUDE.md）：日记引用照片日期用 `shot_at`，
 * 计数用 `created_at`。「去年今日」只认 `shot_at IS NOT NULL` ——
 * 上传时间的月日撞上今天纯属巧合，拿它说「去年今日」是假的。
 */

import { MILESTONE_DAYS, milestoneLabel } from "@/domain/companion";
import { findCopyViolations, type CopyViolation } from "@/domain/copy-guard";
import type { IslandDayPhase, IslandWeather } from "@/domain/island-weather";

/** 模板 id。**带版本号**：改措辞时新开一版而不是原地改，历史日记才能保持原样 */
export type IslandDiaryTemplateId = "photo-today-v1" | "on-this-day-v1" | "milestone-v1" | "ambient-v1";

/** 日记条目的类别。与 `island_events.kind` 一致，也是唯一约束的一部分 */
export type IslandEventKind = "diary" | "milestone" | "on_this_day" | "offline";

/**
 * 当日活动档。**不是数值而是分档** —— 日记要说「你翻出了几样东西」这个事实，
 * 但不该出现「今天完成度 60%」这类进度表达（4.1 #5 / #7 的同一类问题）。
 */
export type IslandActivityBucket = "fed" | "gathered" | "petted" | "idle";

/**
 * 模板变量。一个宽结构而不是每模板一个类型：它要序列化进 `payload` jsonb，
 * 而 jsonb 读回来是 `unknown` —— 分支类型在过一遍 JSON 之后并不能帮上忙，
 * 反而要写四个类型守卫。渲染函数自己按模板取需要的字段。
 */
export interface IslandDiaryPayload {
  petName?: string;
  /** 陪伴第 N 天。**按服务端时间算**，且已离开的宠物按 memorialSince 封口 */
  days?: number;
  phase?: IslandDayPhase;
  weather?: IslandWeather;
  activity?: IslandActivityBucket;
  /** 当日采集出的物品件数。`activity === "gathered"` 时才用得上 */
  gathered?: number;
  /** 今天新上传的照片数。**按 `created_at` 计数**（是用户的行为，不是照片里的那一天） */
  photoCount?: number;
  /** 「去年今日」那张照片的拍摄日期，YYYY-MM-DD。**按 `shot_at`** */
  onThisDayDate?: string;
  /** 距今几年。1 说「去年今日」，2 以上说「N 年前的今天」 */
  yearsAgo?: number;
  /** 那天是相处的第几天 */
  onThisDayDay?: number;
  /** 里程碑天数。取 100 / 365 / 1000，**不含第 1 天** */
  milestoneDay?: number;
}

export interface IslandDiaryEntry {
  kind: IslandEventKind;
  templateId: IslandDiaryTemplateId;
  payload: IslandDiaryPayload;
}

/**
 * 宠物名的占位。渲染时若没有名字就用它。
 *
 * 也是**门禁扫描时替换真名的占位**（见 `renderDiarySkeleton`）。
 */
const PET_PLACEHOLDER = "它";

/**
 * 昼夜片段。措辞只描述光线，不描述宠物的状态 ——
 * 「它精神不错」是健康判断（4.1 #9），「天刚亮」不是。
 */
const PHASE_FRAGMENT: Record<IslandDayPhase, string> = {
  dawn: "天刚亮",
  day: "白天",
  dusk: "太阳快落下去了",
  night: "夜里",
};

/**
 * 天气片段。
 *
 * 雨雪两档说的是**躲雨**而不是淋雨（2.5.2）：窗外下雨、屋内暖光是治愈感最强的
 * 画面之一，而「淋雨的宠物」正是那条设计判断要避开的。这也与端上的 `shelter`
 * 站位切换对齐 —— 文字和画面必须说同一件事。
 */
const WEATHER_FRAGMENT: Record<IslandWeather, string> = {
  clear: "小岛上没什么风",
  cloudy: "云压得低，光是软的",
  rain: "外面在下雨，它待在屋檐底下",
  snow: "落了雪，屋檐下还是干的",
};

/**
 * 活动片段。
 *
 * `idle` 那句尤其要克制：用户没来过的那天也会走到这一档（离线补齐），
 * 而**岛不制造负面情绪**（4.1 #6，「N 天不来它会难过」是明确的禁止项）。
 * 所以说的是「自己待了一会儿」，不是「没人陪它」。
 */
const ACTIVITY_FRAGMENT: Record<IslandActivityBucket, (payload: IslandDiaryPayload) => string> = {
  fed: () => "你喂了它一次，它吃完蹭了蹭手。",
  gathered: (payload) => {
    const count = Number(payload.gathered) || 1;
    return `你在草丛里翻出了 ${count} 样东西。`;
  },
  petted: () => "你摸了摸它的头。",
  idle: () => "它自己待了一会儿。",
};

/** 全部模板 id，供门禁遍历 */
export const ISLAND_DIARY_TEMPLATES: readonly IslandDiaryTemplateId[] = [
  "photo-today-v1",
  "on-this-day-v1",
  "milestone-v1",
  "ambient-v1",
];

/** 模板 id → 事件类别。类别进唯一约束，所以同一天同一类别只会有一条 */
const KIND_OF: Record<IslandDiaryTemplateId, IslandEventKind> = {
  "photo-today-v1": "diary",
  "on-this-day-v1": "on_this_day",
  "milestone-v1": "milestone",
  "ambient-v1": "diary",
};

export function kindOfTemplate(templateId: IslandDiaryTemplateId): IslandEventKind {
  return KIND_OF[templateId] || "diary";
}

function nameOf(payload: IslandDiaryPayload): string {
  const name = String(payload.petName || "").trim();
  return name || PET_PLACEHOLDER;
}

/**
 * 渲染一条日记。
 *
 * 未知模板 id 回落到环境句而不是抛错：库里可能存着某个已下线的模板 id
 * （模板带版本号，旧版本迟早会被移走），而那条历史日记仍该读得出来 ——
 * 与 `hydrateWork` 对历史作品的态度一致。
 */
export function renderDiary(entry: { templateId: string; payload?: IslandDiaryPayload }): string {
  const payload = entry.payload || {};
  const name = nameOf(payload);
  switch (entry.templateId) {
    case "photo-today-v1": {
      const count = Number(payload.photoCount) || 1;
      return `今天给${name}拍了 ${count} 张照片。它在院子里转了一圈，像是知道自己被看着。`;
    }
    case "on-this-day-v1": {
      const years = Number(payload.yearsAgo) || 1;
      const when = years === 1 ? "去年的今天" : `${years} 年前的今天`;
      const date = String(payload.onThisDayDate || "");
      const day = Number(payload.onThisDayDay) || 1;
      return `${when}（${date}），是你们相处的第 ${day} 天。${name}今天也在小岛上。`;
    }
    case "milestone-v1": {
      const day = Number(payload.milestoneDay) || 0;
      const label = milestoneLabel(day);
      // 里程碑只列已达成的，且措辞是过去完成式 —— 「还差 20 天」是催促（4.1 #7）
      return label === "一起过了一年"
        ? `和${name}一起过了一年。`
        : `和${name}一起走到了第 ${day} 天。`;
    }
    default: {
      const phase = PHASE_FRAGMENT[payload.phase as IslandDayPhase] || PHASE_FRAGMENT.day;
      const weather = WEATHER_FRAGMENT[payload.weather as IslandWeather] || WEATHER_FRAGMENT.clear;
      const activity = (ACTIVITY_FRAGMENT[payload.activity as IslandActivityBucket] || ACTIVITY_FRAGMENT.idle)(payload);
      return `${phase}，${weather}。${activity}`;
    }
  }
}

/**
 * 渲染成品，但把宠物名换成占位词。
 *
 * **门禁扫的是这个，不是 `renderDiary` 的输出。** 理由：宠物名是用户自己填的，
 * 一只叫「正常」或「体况」的猫会让每条日记都命中词表 —— 而词表管的是
 * **我们写的文案**，不是用户的数据。拿真名去扫，结果是给这些用户直接封掉日记功能，
 * 那既解决不了合规问题（名字是用户自己的），又损失了功能。
 *
 * 所以分工是：门禁 15 穷举模板 × 变量扫这个骨架；`island_events` 里存的
 * `payload.petName` 原样保留、渲染时原样显示。
 */
export function renderDiarySkeleton(entry: { templateId: string; payload?: IslandDiaryPayload }): string {
  return renderDiary({ templateId: entry.templateId, payload: { ...(entry.payload || {}), petName: PET_PLACEHOLDER } });
}

/** 选日记模板时用得到的当日事实 */
export interface IslandDiaryContext {
  petName?: string;
  /** 陪伴第 N 天 */
  days?: number;
  phase: IslandDayPhase;
  weather: IslandWeather;
  /** 当日已采集次数 */
  gathered?: number;
  fed?: number;
  petted?: number;
  /** 当日采集出的件数（不等于次数：一次采集掉一件，但历史数据里可能不一致） */
  gatheredItems?: number;
  /** 今天新上传的照片数，按 `created_at` */
  photoCount?: number;
  /** 命中「去年今日」时的那一条 */
  onThisDay?: { date: string; yearsAgo: number; day: number };
}

function activityOf(context: IslandDiaryContext): IslandActivityBucket {
  if (Number(context.fed) > 0) return "fed";
  if (Number(context.gathered) > 0) return "gathered";
  if (Number(context.petted) > 0) return "petted";
  return "idle";
}

/**
 * 选出今天该写哪一条。
 *
 * 优先级按 22 号文 4.2 逐字执行：
 * ① 今天有新上传照片 → 引用那张的场景；
 * ② 命中「去年今日」→ 引用去年；
 * ③ 里程碑日 → 引用天数；
 * ④ 兜底 → 按昼夜与采集行为拼一句。
 *
 * **每天只写一条**，所以这里返回单个条目而不是列表。选中的模板决定 `kind`，
 * 而 `kind` 进唯一约束 —— 于是同一天重复结算不会产生第二条（5.6 的幂等保障）。
 */
export function selectDiaryEntry(context: IslandDiaryContext): IslandDiaryEntry {
  const base: IslandDiaryPayload = { petName: context.petName, days: context.days };

  if (Number(context.photoCount) > 0) {
    return { kind: "diary", templateId: "photo-today-v1", payload: { ...base, photoCount: Number(context.photoCount) } };
  }
  if (context.onThisDay) {
    return {
      kind: "on_this_day",
      templateId: "on-this-day-v1",
      payload: { ...base, onThisDayDate: context.onThisDay.date, yearsAgo: context.onThisDay.yearsAgo, onThisDayDay: context.onThisDay.day },
    };
  }
  const days = Number(context.days) || 0;
  if (MILESTONE_DAYS.includes(days as (typeof MILESTONE_DAYS)[number])) {
    return { kind: "milestone", templateId: "milestone-v1", payload: { ...base, milestoneDay: days } };
  }
  const activity = activityOf(context);
  return {
    kind: "diary",
    templateId: "ambient-v1",
    payload: {
      ...base,
      phase: context.phase,
      weather: context.weather,
      activity,
      ...(activity === "gathered" ? { gathered: Number(context.gatheredItems) || Number(context.gathered) || 1 } : {}),
    },
  };
}

/**
 * 穷举全部模板 × 全部变量组合，供门禁 15 使用。
 *
 * **模板拼装的好处正在于可穷举**（4.2），所以这个函数是那条判据的兑现处：
 * 它必须真的覆盖每一个分支，否则门禁形同虚设。当前组合数 =
 * 环境句 4 昼夜 × 4 天气 × 4 活动档 = 64，加另外三个模板的取值。
 *
 * 宠物名一律用占位词：门禁扫的是我们写的文案（见 `renderDiarySkeleton`）。
 */
export function enumerateDiaryEntries(): IslandDiaryEntry[] {
  const phases: IslandDayPhase[] = ["dawn", "day", "dusk", "night"];
  const weathers: IslandWeather[] = ["clear", "cloudy", "rain", "snow"];
  const activities: IslandActivityBucket[] = ["fed", "gathered", "petted", "idle"];
  const entries: IslandDiaryEntry[] = [];

  for (const phase of phases) {
    for (const weather of weathers) {
      for (const activity of activities) {
        // 采集件数取 1 与 8（每日上限）两个端点：文案里那个数字是唯一的变量
        for (const gathered of activity === "gathered" ? [1, 8] : [0]) {
          entries.push({ kind: "diary", templateId: "ambient-v1", payload: { phase, weather, activity, gathered } });
        }
      }
    }
  }
  for (const photoCount of [1, 2, 9, 40]) {
    entries.push({ kind: "diary", templateId: "photo-today-v1", payload: { photoCount } });
  }
  for (const yearsAgo of [1, 2, 5]) {
    for (const onThisDayDay of [1, 100, 743]) {
      entries.push({ kind: "on_this_day", templateId: "on-this-day-v1", payload: { yearsAgo, onThisDayDate: "2024-08-05", onThisDayDay } });
    }
  }
  for (const milestoneDay of MILESTONE_DAYS) {
    entries.push({ kind: "milestone", templateId: "milestone-v1", payload: { milestoneDay } });
  }
  return entries;
}

/**
 * 扫一批日记条目的文案，返回全部违例。门禁 15 的实现入口。
 *
 * 扫的是**骨架**（宠物名换占位）—— 见 `renderDiarySkeleton` 的说明。
 */
export function findDiaryViolations(entries: IslandDiaryEntry[] = enumerateDiaryEntries()): Array<CopyViolation & { templateId: string; text: string }> {
  const found: Array<CopyViolation & { templateId: string; text: string }> = [];
  for (const entry of entries) {
    const text = renderDiarySkeleton(entry);
    for (const violation of findCopyViolations(text)) found.push({ ...violation, templateId: entry.templateId, text });
  }
  return found;
}
