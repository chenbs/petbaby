/*
 * 站内货币「冻干」的颗数表（2026-10-08，docs/product/36-冻干钱包与会员下线实施方案.md 第 2 章）。
 *
 * **颗数只在这里定义**，服务端扣费、端上展示都读这一份；端上不写死颗数。
 * 规则是「先扣冻干，再执行任务」：没有预览、没有免费重拍，扣一次生成一次。
 *
 * 放 domain/ 而不是 server/：端上选择器与服务端扣费必须是同一个数字。
 */

import { resolvePriceTier, type AccumulationInput, type PriceTier } from "@/domain/pricing";

/** 货币名与量词。端上统一读这里下发的文案，不各写一份。 */
export const DONGAN_NAME = "冻干";
export const DONGAN_UNIT = "颗";

export type ImageSubjectMode = "pet" | "owner-pet" | "pet-human";

/** AI 单张：按主体模式计价。人宠要三张参考图，单价最高。 */
export const AI_RUN_COST: Record<ImageSubjectMode, number> = {
  pet: 2,
  "pet-human": 4,
  "owner-pet": 6,
};

/** 写真套餐：单张 2 颗另走 AI_RUN_COST.pet；套餐每张约 1 颗。 */
export const ART_PHOTO_BUNDLE_COST = { ten: 12, twenty: 20 } as const;
export type ArtPhotoBundlePackage = keyof typeof ART_PHOTO_BUNDLE_COST;
/** 套餐中单张最终失败时按张退还的颗数（12 颗里多出的 2 颗视为套餐折扣，不按比例分摊）。 */
export const ART_PHOTO_BUNDLE_ITEM_REFUND = 1;

/** 按积累量分档的交付物。纪念形态不分档，见 MEMORIAL_FILM_COST。 */
const TIER_COSTS: Record<string, Record<PriceTier, number>> = {
  "pet-time-album": { basic: 18, advanced: 28, annual: 38 },
  "pl-19": { basic: 15, advanced: 22, annual: 30 },
};

/** 不分档的付费排版玩法。 */
const FLAT_COSTS: Record<string, number> = {
  "pet-movie-poster": 5,
};

/** 纪念短片：不分档、不比价。纪念空间的纪念册与星尘页维持免费。 */
export const MEMORIAL_FILM_COST = 26;
/** 年度报告（产物直接是高清版）。 */
export const ANNUAL_REPORT_COST = 18;
/** 健康档案 PDF 与年度健康记录各一份。 */
export const HEALTH_DOCUMENT_COST = 6;

/** 免费玩法每天可生成的次数（付费玩法由冻干约束，不占这个次数）。 */
export const FREE_DAILY_GENERATIONS = 10;

/** 任务失败后系统自动重试的次数；仍失败则全额退还冻干。 */
export const AUTO_RETRY_LIMIT = 2;
/** 总尝试次数 = 首次 + 自动重试。 */
export const MAX_TASK_ATTEMPTS = 1 + AUTO_RETRY_LIMIT;

export function isTieredPlugin(pluginId: string): boolean {
  return pluginId in TIER_COSTS;
}

export function tierCost(pluginId: string, tier: PriceTier): number | undefined {
  return TIER_COSTS[pluginId]?.[tier];
}

/** 排版 / 视频玩法是否收冻干。不在两张表里的玩法免费。 */
export function isPaidLayoutPlugin(pluginId: string): boolean {
  return pluginId in TIER_COSTS || pluginId in FLAT_COSTS;
}

/**
 * 一次排版 / 视频交付要扣多少颗。
 *
 * @param memorial 宠物处于纪念阶段时，画册与短片走纪念形态：画册免费、短片固定价
 * @returns `cost` 为 0 表示免费；`tier` 只对分档玩法有值
 */
export function resolveDeliverableCost(input: { pluginId: string; accumulation?: AccumulationInput; memorial?: boolean }): { cost: number; tier?: PriceTier } {
  const { pluginId, accumulation, memorial } = input;
  if (memorial && pluginId === "pl-19") return { cost: MEMORIAL_FILM_COST };
  if (memorial && pluginId === "pet-time-album") return { cost: 0 };
  if (pluginId in FLAT_COSTS) return { cost: FLAT_COSTS[pluginId] };
  const table = TIER_COSTS[pluginId];
  if (!table) return { cost: 0 };
  const tier = resolvePriceTier(accumulation || { photoCount: 0, spanDays: 0 });
  return { cost: table[tier], tier };
}

/** 各档颗数，供端上展示价格跨度。 */
export function tierCosts(pluginId: string): Record<PriceTier, number> | undefined {
  return TIER_COSTS[pluginId] ? { ...TIER_COSTS[pluginId] } : undefined;
}

/** 收支明细与按钮上的颗数文案，例如「2 颗」。 */
export function describeCost(units: number): string {
  return `${units} ${DONGAN_UNIT}`;
}
