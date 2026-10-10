/*
 * 交付物按「积累量」分档，而不是按玩法固定价。
 *
 * 这是 16 号文第六章的核心商业建议：攒得越多可做的越好，用户自己能算这笔账。
 * 2026-10 起计价单位从「元」改为站内货币「冻干」（颗），颗数表见 domain/dongan-pricing.ts；
 * 这里只保留与货币无关的分档判定。会员规格解锁随会员下线一并删除。
 *
 * 放 domain/ 而不是 server/：端上选择器要用同一套档位 —— 沿用 domain/video-duration.ts 的先例。
 */

export type PriceTier = "basic" | "advanced" | "annual";

/** 进阶档的照片数门槛（含）。20 张及以下是基础档。 */
export const ADVANCED_PHOTO_THRESHOLD = 21;
/** 年度档的跨度门槛（含），单位天。 */
export const ANNUAL_SPAN_DAYS = 365;

export interface AccumulationInput {
  /** 本次交付物使用的照片数。 */
  photoCount: number;
  /**
   * 照片的时间跨度（天）。取 `coalesce(shot_at, created_at)` 的 max−min，
   * 与 timeline-service.ts 的排序键同口径 —— 两处口径不一致会让
   * 「时间线显示跨了两年、定价却算作基础档」。
   */
  spanDays: number;
}

/**
 * 解析档位。**同时满足多档时取最高档** —— 高档必然内容更丰富，
 * 按低档收费等于让积累多的用户吃亏，与整个分档设计的目的相反。
 */
export function resolvePriceTier(input: AccumulationInput): PriceTier {
  if (input.spanDays >= ANNUAL_SPAN_DAYS) return "annual";
  if (input.photoCount >= ADVANCED_PHOTO_THRESHOLD) return "advanced";
  return "basic";
}

/**
 * 下一档还差什么。已在最高档时返回 undefined。
 *
 * 文案按「你可以做什么」而不是「你不足以做什么」：这里只给差值不给否定句，措辞由端上决定。
 * 同时给出照片与跨度两条路径 —— `resolvePriceTier` 是任一命中即升档。
 */
export function nextTierGap(input: AccumulationInput): { tier: PriceTier; photosNeeded?: number; daysNeeded?: number } | undefined {
  const current = resolvePriceTier(input);
  if (current === "annual") return undefined;
  const daysNeeded = Math.max(0, ANNUAL_SPAN_DAYS - input.spanDays);
  if (current === "advanced") return { tier: "annual", daysNeeded };
  const photosNeeded = Math.max(0, ADVANCED_PHOTO_THRESHOLD - input.photoCount);
  /*
   * basic 档同时能看到两条路。给「更近的一条」的判据不是数字大小
   * （20 张与 300 天不可比），而是**用户可控性**：照片数是他今天就能补的，
   * 跨度只能等。所以 basic 一律先报照片路径。
   */
  return { tier: "advanced", photosNeeded, daysNeeded };
}

/**
 * 跨度天数。两端都是「日历日」，同一天算 0 天跨度。
 *
 * 与 domain/companion.ts 的日期归一同口径：ISO 时间戳先转本地再取年月日，
 * 混用 UTC 与本地会差一天。
 */
export function spanDaysBetween(earliest: Date, latest: Date): number {
  const startDay = Date.UTC(earliest.getFullYear(), earliest.getMonth(), earliest.getDate());
  const endDay = Date.UTC(latest.getFullYear(), latest.getMonth(), latest.getDate());
  return Math.max(0, Math.round((endDay - startDay) / 86_400_000));
}
