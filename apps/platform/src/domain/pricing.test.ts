import { describe, expect, it } from "vitest";

import { MEMBER_PRICE_TIER, MEMBER_SPEC_TIER, isTieredPlugin, nextTierGap, resolveOrderPricing, resolvePriceTier, spanDaysBetween, tierPrice } from "@/domain/pricing";

describe("按积累量分档", () => {
  /** 边界值：20 张是基础档，21 张进阶。差一个数字就是差一个价位。 */
  it("照片数边界 20/21", () => {
    expect(resolvePriceTier({ photoCount: 20, spanDays: 30 })).toBe("basic");
    expect(resolvePriceTier({ photoCount: 21, spanDays: 30 })).toBe("advanced");
  });

  /** 跨度边界：364 天不算年度，365 天算。 */
  it("跨度边界 364/365", () => {
    expect(resolvePriceTier({ photoCount: 5, spanDays: 364 })).toBe("basic");
    expect(resolvePriceTier({ photoCount: 5, spanDays: 365 })).toBe("annual");
  });

  /*
   * **同时满足多档取最高档**：高档必然内容更丰富，按低档收费
   * 等于让积累多的用户吃亏，与整个分档设计的目的相反。
   */
  it("同时满足时取最高档", () => {
    expect(resolvePriceTier({ photoCount: 50, spanDays: 400 })).toBe("annual");
  });

  it("跨度单独可以成档，不需要照片多", () => {
    // 10 张照片但跨了一年，仍是年度档 —— 卖的是时间跨度不是照片数量。
    expect(resolvePriceTier({ photoCount: 10, spanDays: 400 })).toBe("annual");
  });

  it("空档案回落基础档，不报错", () => {
    expect(resolvePriceTier({ photoCount: 0, spanDays: 0 })).toBe("basic");
  });
});

describe("分档价目", () => {
  it("画册三档递增", () => {
    expect(tierPrice("pet-time-album", "basic")).toBe(19.9);
    expect(tierPrice("pet-time-album", "advanced")).toBe(39.9);
    expect(tierPrice("pet-time-album", "annual")).toBe(49);
  });

  it("短片三档递增", () => {
    expect(tierPrice("pl-19", "basic")).toBe(19.9);
    expect(tierPrice("pl-19", "advanced")).toBe(29.9);
    expect(tierPrice("pl-19", "annual")).toBe(39.9);
  });

  /** 不在分档表里的玩法返回 undefined，调用方回落 manifest 的 unlockPrice。 */
  it("非分档玩法返回 undefined", () => {
    expect(isTieredPlugin("pet-id-card")).toBe(false);
    expect(tierPrice("pet-id-card", "basic")).toBeUndefined();
  });

  it("分档玩法可识别", () => {
    expect(isTieredPlugin("pet-time-album")).toBe(true);
    expect(isTieredPlugin("pl-19")).toBe(true);
  });

  /*
   * 会员的**规格**档是最高档（权益的字面承诺），**计价**档是最低档。
   * 两者是同一个权益的两面，混成一个常量正是原实现让会员倒亏的原因。
   */
  it("会员规格取最高档、计价取最低档", () => {
    expect(MEMBER_SPEC_TIER).toBe("annual");
    expect(MEMBER_PRICE_TIER).toBe("basic");
    expect(tierPrice("pet-time-album", MEMBER_SPEC_TIER)).toBe(49);
    expect(tierPrice("pet-time-album", MEMBER_PRICE_TIER)).toBe(19.9);
  });
});

/*
 * 这一组是 M1 的回归防线。原缺陷不在任何单个函数里，而在**组合语义**：
 * 档位解析对、价目表对、权益读取对，把三者接起来的那行三元表达式错了。
 * 所以这里测的必须是组合结果（应收金额），不是中间档位。
 */
describe("会员计价（M1）", () => {
  const album = "pet-time-album";

  /** 缺陷复现用例：10 张照片的会员，原实现收 49，非会员收 19.9。 */
  it("会员不得比同等积累的非会员贵", () => {
    const accumulation = { photoCount: 10, spanDays: 30 };
    const free = resolveOrderPricing({ pluginId: album, accumulation, isMember: false, basePrice: 19.9 });
    const member = resolveOrderPricing({ pluginId: album, accumulation, isMember: true, basePrice: 19.9 });
    expect(free.amount).toBe(19.9);
    expect(member.amount).toBe(19.9);
    expect(member.amount).toBeLessThanOrEqual(free.amount);
  });

  /** 「用最高规格、付最低价」：规格是 annual，钱是 basic 档的。 */
  it("会员拿最高规格但付最低价", () => {
    const member = resolveOrderPricing({ pluginId: album, accumulation: { photoCount: 10, spanDays: 30 }, isMember: true, basePrice: 19.9 });
    expect(member.specTier).toBe("annual");
    expect(member.priceTier).toBe("basic");
    expect(member.amount).toBe(19.9);
    // 省下的是 annual 与 basic 的差额 —— 他确实拿到了 49 档的产物。
    expect(member.listPrice).toBe(49);
    expect(member.memberSaving).toBeCloseTo(29.1, 2);
  });

  /** 积累已满年的会员：规格与非会员同为 annual，但只付 basic 价。 */
  it("高积累会员同样只付最低价", () => {
    const accumulation = { photoCount: 80, spanDays: 400 };
    const free = resolveOrderPricing({ pluginId: album, accumulation, isMember: false, basePrice: 19.9 });
    const member = resolveOrderPricing({ pluginId: album, accumulation, isMember: true, basePrice: 19.9 });
    expect(free.amount).toBe(49);
    expect(member.amount).toBe(19.9);
    expect(member.memberSaving).toBeCloseTo(29.1, 2);
  });

  it("非会员省额为 0，参照价等于应收价", () => {
    const free = resolveOrderPricing({ pluginId: album, accumulation: { photoCount: 30, spanDays: 30 }, isMember: false, basePrice: 19.9 });
    expect(free.amount).toBe(39.9);
    expect(free.listPrice).toBe(39.9);
    expect(free.memberSaving).toBe(0);
  });

  /*
   * 不分档的路径（纪念形态、非分档玩法）不受会员影响：
   * 纪念场景比价是冒犯，且这些玩法本来就是统一价。
   */
  it("不分档时按基础价，会员也不改", () => {
    const memorial = resolveOrderPricing({ pluginId: album, accumulation: undefined, isMember: true, basePrice: 49 });
    expect(memorial.amount).toBe(49);
    expect(memorial.priceTier).toBeUndefined();
    expect(memorial.memberSaving).toBe(0);
  });

  it("短片同样不反涨", () => {
    const accumulation = { photoCount: 5, spanDays: 10 };
    expect(resolveOrderPricing({ pluginId: "pl-19", accumulation, isMember: true, basePrice: 19.9 }).amount).toBe(19.9);
    expect(resolveOrderPricing({ pluginId: "pl-19", accumulation, isMember: false, basePrice: 19.9 }).amount).toBe(19.9);
  });
});

describe("下一档差距（L3）", () => {
  /** basic 先报照片路径：照片是用户今天就能补的，跨度只能等。 */
  it("基础档给出照片与天数两条路", () => {
    const gap = nextTierGap({ photoCount: 10, spanDays: 30 });
    expect(gap).toEqual({ tier: "advanced", photosNeeded: 11, daysNeeded: 335 });
  });

  it("进阶档只剩跨度一条路", () => {
    expect(nextTierGap({ photoCount: 30, spanDays: 100 })).toEqual({ tier: "annual", daysNeeded: 265 });
  });

  it("已是最高档时没有下一档", () => {
    expect(nextTierGap({ photoCount: 80, spanDays: 400 })).toBeUndefined();
  });

  it("刚好卡在门槛上时差值为 0 而不是负数", () => {
    expect(nextTierGap({ photoCount: 20, spanDays: 365 })).toBeUndefined();
    expect(nextTierGap({ photoCount: 20, spanDays: 364 })?.photosNeeded).toBe(1);
  });
});

describe("跨度计算", () => {
  it("同一天是 0 天", () => {
    expect(spanDaysBetween(new Date("2026-03-01T08:00:00"), new Date("2026-03-01T23:00:00"))).toBe(0);
  });

  it("按日历日计算，不受时刻影响", () => {
    // 23:00 到次日 01:00 只隔两小时，但跨了一个日历日 —— 算 1 天。
    expect(spanDaysBetween(new Date("2026-03-01T23:00:00"), new Date("2026-03-02T01:00:00"))).toBe(1);
  });

  it("整年跨度", () => {
    expect(spanDaysBetween(new Date("2025-03-01T12:00:00"), new Date("2026-03-01T12:00:00"))).toBe(365);
  });

  it("顺序颠倒时不给负数", () => {
    expect(spanDaysBetween(new Date("2026-03-05T12:00:00"), new Date("2026-03-01T12:00:00"))).toBe(0);
  });
});
