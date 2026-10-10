import { describe, expect, it } from "vitest";

import { nextTierGap, resolvePriceTier, spanDaysBetween } from "@/domain/pricing";

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
