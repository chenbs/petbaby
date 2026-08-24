/*
 * 交付物定价按「积累量」分档，而不是按玩法固定价。
 *
 * 这是 16 号文第六章的核心商业建议。原先 PL-03 画册 12.9，不管用户有 6 张
 * 照片还是 200 张；PL-19 短片 19.9，不管跨度是一周还是三年。
 *
 * 改成按积累量分档有三个作用：
 * 1. 让积累直接换算成钱，且是用户自己能算的账 —— 攒得越多可买的越好；
 * 2. 让定价与竞品脱钩 —— 哎呦宠物年费 29.9 做单次生图，没有积累维度，
 *    它做不出「一年跨度画册」因为它不存照片；
 * 3. 让会员价值可算 —— 会员卖的就是「规格上限解锁」。
 *
 * 放 domain/ 而不是 server/：Web 端选择器要用同一套档位，从 server/ 导入
 * 会让 RSC 边界看起来是错的 —— 沿用 domain/video-duration.ts 的先例。
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

/*
 * 分档价目表。只有「交付物层」的玩法进这张表；
 * 钩子层（免费）与纪念形态（统一定价）都不分档。
 *
 * 纪念形态不分档的理由：纪念场景比价是冒犯，且「照片少所以便宜」
 * 这个逻辑在纪念语境下不成立 —— 照片少往往是因为陪伴时间短。
 */
const TIER_PRICES: Record<string, Record<PriceTier, number>> = {
  "pet-time-album": { basic: 19.9, advanced: 39.9, annual: 49 },
  "pl-19": { basic: 19.9, advanced: 29.9, annual: 39.9 },
};

/** 该玩法是否走积累量分档。不在表里的玩法用 manifest 的 unlockPrice。 */
export function isTieredPlugin(pluginId: string): boolean {
  return pluginId in TIER_PRICES;
}

/**
 * 取分档价。不在分档表里时返回 undefined，调用方回落到 manifest 的 unlockPrice。
 */
export function tierPrice(pluginId: string, tier: PriceTier): number | undefined {
  return TIER_PRICES[pluginId]?.[tier];
}

/**
 * 会员「规格上限解锁」的**规格**档：不看照片数，直接给最高规格。
 *
 * 这是权益的字面承诺 —— 会员做出来的画册就是年度档的内容量，
 * 不受「只有 10 张照片」的限制。
 */
export const MEMBER_SPEC_TIER: PriceTier = "annual";

/**
 * 会员「规格上限解锁」的**计价**档：一律按最低档收费。
 *
 * **规格档与计价档必须分开。** 原实现只有一个 `MEMBER_TIER = "annual"`
 * 同时喂给规格与计价，而「给最高档」在计价函数里的唯一含义是「取最高档的价」——
 * 结果是一个只有 10 张照片的会员买画册付 ¥49，同样照片数的免费用户付 ¥19.9，
 * 会员反而多付 ¥29.1。权益名叫「解锁」，落地成了「涨价」。
 *
 * 修正后的语义是「用最高规格、付最低价」：与承诺一致，且用户能一眼算清省了多少。
 */
export const MEMBER_PRICE_TIER: PriceTier = "basic";

/**
 * 一次交付物解锁的最终计价。
 *
 * 放在 domain/ 而不是散在 platform-service 的一行三元表达式里：
 * 「会员该收多少」是产品规则而不是取数逻辑，且端上要在**下单前**展示同一个
 * 结果（L3 档位可见），两处各算一遍必然走散。
 *
 * @param basePrice manifest 的 `pricing.unlockPrice`，不分档玩法的回落值
 */
export function resolveOrderPricing(input: {
  pluginId: string;
  /** 不分档时（纪念形态、非分档玩法）传 undefined */
  accumulation?: AccumulationInput;
  isMember: boolean;
  basePrice: number;
}): {
  /** 交付物实际给到的内容规格档。会员恒为最高档 */
  specTier?: PriceTier;
  /** 计价所用的档位。会员恒为最低档 */
  priceTier?: PriceTier;
  /** 应收金额 */
  amount: number;
  /** 同规格下非会员要付的钱。等于 amount 时说明这次没省 */
  listPrice: number;
  /** 会员省下的金额，非会员为 0 */
  memberSaving: number;
} {
  const { pluginId, accumulation, isMember, basePrice } = input;
  if (!accumulation) return { amount: basePrice, listPrice: basePrice, memberSaving: 0 };
  const earnedTier = resolvePriceTier(accumulation);
  const specTier = isMember ? MEMBER_SPEC_TIER : earnedTier;
  const priceTier = isMember ? MEMBER_PRICE_TIER : earnedTier;
  const amount = tierPrice(pluginId, priceTier) ?? basePrice;
  /*
   * 参照价取「同规格的非会员价」而不是「同积累量的非会员价」：
   * 会员拿到的是 annual 档的内容，省下的就是 annual 与 basic 的差额。
   * 拿 earnedTier 当参照会把一个 10 张照片的会员算成「省了 0 元」，
   * 而他实际拿到的是 ¥49 档的产物。
   */
  const listPrice = tierPrice(pluginId, specTier) ?? basePrice;
  return { specTier, priceTier, amount, listPrice, memberSaving: Math.round(Math.max(0, listPrice - amount) * 100) / 100 };
}

/**
 * 下一档还差什么。已在最高档时返回 undefined。
 *
 * 供 L3「档位下单前可见」用。文案按「你可以做什么」而不是「你不足以做什么」：
 * 返回的是**还差多少**这个事实，措辞由端上决定，但这里只给差值不给否定句。
 *
 * 同时给出照片与跨度两条路径中「更近的一条」—— 两条都列会让用户以为
 * 必须同时满足，而 `resolvePriceTier` 是任一命中即升档。
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
