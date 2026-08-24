/**
 * 陪伴天数与日期归一，服务端口径。
 *
 * 这是 `apps/miniprogram/services/companion.js` 的服务端对照实现 ——
 * 纪念册（`memorial-service.ts`）、成长时间线、叙事视频都要给出「第 N 天」，
 * 而端上已经有一份算法。两边必须给出同一个数字，否则用户在小程序看到
 * 「陪伴第 743 天」、在纪念册里看到 742，无法解释。
 *
 * 改这里必须同步改 `companion.js`（那边有 node --test 覆盖），反之亦然。
 */

/** 一天的毫秒数 */
const DAY_MS = 86_400_000;

/**
 * 把日期值归一到**本地零点**。两类输入要分开处理，否则天数会差一天：
 *
 * - 纯日期串（"2025-02-03"，用户在 picker 里填的生日）是一个日历日期，
 *   `new Date()` 会按 UTC 零点解析，在东八区变成本地 08:00。
 * - ISO 时间戳（"2026-07-21T22:00:00.000Z"，服务端的 created_at）是一个时刻，
 *   必须先转本地时区再取年月日 —— 上例在东八区已经是 7-22，
 *   照抄字符串里的 21 会把日期记早一天。
 */
export function startOfLocalDay(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : new Date(value.getFullYear(), value.getMonth(), value.getDate());
  }
  const text = String(value);
  if (text.indexOf("T") > 0) {
    const instant = new Date(text);
    if (Number.isNaN(instant.getTime())) return null;
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  }
  const parts = text.split(/[^0-9]/).filter(Boolean);
  if (parts.length < 3) return null;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return Number.isNaN(date.getTime()) ? null : date;
}

/** 今天的本地零点。测试可传 now 固定住 */
export function todayLocalStart(now?: Date) {
  const base = now || new Date();
  return new Date(base.getFullYear(), base.getMonth(), base.getDate());
}

/**
 * 起算日到截止日的天数，**含当天**（当天为第 1 天）。
 *
 * @param value 起算日
 * @param until 截止日，缺省为今天。已离开的宠物必须传离开日期 ——
 *        否则「陪伴了 N 天」会每天继续往上涨，而那件事已经结束了。
 *
 * 起算日晚于截止日（用户填错生日）时返回 0，让调用方据此隐藏，而不是显示负数。
 */
export function daysSince(value: unknown, until?: unknown): number {
  const start = startOfLocalDay(value);
  if (!start) return 0;
  const end = until ? startOfLocalDay(until) : todayLocalStart();
  if (!end) return 0;
  const diff = Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
  return diff > 0 ? diff : 0;
}

/** 档案的起算日：生日 / 到家日优先，否则用建档日。与 companion.js 的 anchorOf 一致 */
export function anchorOf(pet: { birthday?: string | null; createdAt?: string | Date | null }): string {
  if (!pet) return "";
  const anchor = pet.birthday || pet.createdAt || "";
  return anchor instanceof Date ? anchor.toISOString() : String(anchor);
}

/**
 * 纪念场景的陪伴天数文案。**过去式且不递增。**
 *
 * 截止日取最早的纪念空间创建时间（`memorialSince`）。没有截止日时不给数字：
 * 用户可以直接把生命阶段改成「已离开」而不建纪念空间，此时天数会一路算到今天，
 * 出现「陪伴了 4078 天」这种过去式配递增数字的组合 —— 正是拍板要避免的冒犯。
 * 宁可不给数，也不要给一个每天在涨的数。
 */
export function companionText(
  pet: { lifeStage?: string; memorialSince?: string | null },
  days: number,
): string {
  const memorial = pet && pet.lifeStage === "memorial";
  if (!memorial) return `陪伴第 ${days} 天`;
  if (!pet.memorialSince) return "曾一起走过一段";
  return `陪伴了 ${days} 天`;
}

/**
 * 某张照片是相处的第几天。
 *
 * @param anchor 起算日（`anchorOf` 的结果）
 * @param shotAt 照片的拍摄时间（`photos.shotAt`，无 EXIF 时已回落到上传时间）
 *
 * 照片早于起算日（先上传了旧照片、之后才把生日改晚）时返回 1 而不是 0 或负数：
 * 时间线上的第一格总该是「第 1 天」。
 */
export function dayIndexOf(anchor: unknown, shotAt: unknown): number {
  const days = daysSince(anchor, shotAt);
  return days > 0 ? days : 1;
}

/**
 * 自动里程碑的天数。方案定的是第 100 / 365 / 1000 天。
 *
 * 不含「第 1 天」：那是起点而不是成就，标出来反而稀释了另外三个。
 */
export const MILESTONE_DAYS = [100, 365, 1000] as const;

/** 这一天是否是里程碑，是则给出文案 */
export function milestoneLabel(day: number): string | undefined {
  if (!MILESTONE_DAYS.includes(day as (typeof MILESTONE_DAYS)[number])) return undefined;
  return day === 365 ? "一起过了一年" : `第 ${day} 天`;
}
