import { describe, expect, it } from "vitest";

import { MILESTONE_DAYS, anchorOf, companionText, dayIndexOf, daysSince, milestoneLabel, startOfLocalDay, todayLocalStart } from "@/domain/companion";

/**
 * 这些断言必须与 `apps/miniprogram/services/companion.js` 的 node --test 结果一致。
 * 两边给出不同数字时，用户在小程序看到「陪伴第 743 天」、在纪念册里看到 742，无法解释。
 */
describe("companion", () => {
  it("含当天：起算日当天为第 1 天", () => {
    expect(daysSince("2026-07-30", "2026-07-30")).toBe(1);
    expect(daysSince("2026-07-29", "2026-07-30")).toBe(2);
  });

  it("起算日晚于截止日时返回 0，不给负数", () => {
    expect(daysSince("2026-08-01", "2026-07-30")).toBe(0);
  });

  it("无法解析的日期返回 0", () => {
    expect(daysSince("", "2026-07-30")).toBe(0);
    expect(daysSince(undefined)).toBe(0);
    expect(daysSince("2026", "2026-07-30")).toBe(0);
  });

  /**
   * 两类日期值必须分开处理，混用会差一天。
   * ISO 时间戳先转本地再取年月日：东八区下 "2026-07-21T22:00:00Z" 已经是 7-22。
   */
  it("纯日期串按本地零点，ISO 时间戳先转本地时区", () => {
    const plain = startOfLocalDay("2025-02-03");
    expect(plain?.getFullYear()).toBe(2025);
    expect(plain?.getMonth()).toBe(1);
    expect(plain?.getDate()).toBe(3);
    expect(plain?.getHours()).toBe(0);

    const instant = startOfLocalDay("2026-07-21T22:00:00.000Z");
    const local = new Date("2026-07-21T22:00:00.000Z");
    expect(instant?.getDate()).toBe(local.getDate());
    expect(instant?.getHours()).toBe(0);
  });

  it("Date 实例也归一到本地零点", () => {
    const normalized = startOfLocalDay(new Date(2025, 4, 6, 23, 30));
    expect(normalized?.getDate()).toBe(6);
    expect(normalized?.getHours()).toBe(0);
    expect(startOfLocalDay(new Date("invalid"))).toBeNull();
  });

  it("todayLocalStart 可注入 now，便于固定测试", () => {
    const start = todayLocalStart(new Date(2026, 6, 30, 18, 0));
    expect(start.getDate()).toBe(30);
    expect(start.getHours()).toBe(0);
  });

  it("起算日优先生日/到家日，缺失退回建档日", () => {
    expect(anchorOf({ birthday: "2020-01-01", createdAt: "2026-01-01" })).toBe("2020-01-01");
    expect(anchorOf({ createdAt: "2026-01-01" })).toBe("2026-01-01");
    expect(anchorOf({})).toBe("");
  });

  /** 纪念场景的天数是过去式且不递增；没有截止日时不给数字 */
  it("companionText：纪念且有截止日才给天数", () => {
    expect(companionText({ lifeStage: "active" }, 743)).toBe("陪伴第 743 天");
    expect(companionText({ lifeStage: "memorial", memorialSince: "2026-07-01T00:00:00.000Z" }, 743)).toBe("陪伴了 743 天");
    // 用户直接把阶段改成「已离开」而不建纪念空间时 memorialSince 为空 ——
    // 给出的天数会一路涨到今天，「陪伴了 4078 天」配过去式正是要避免的冒犯。
    expect(companionText({ lifeStage: "memorial" }, 4078)).toBe("曾一起走过一段");
  });

  it("dayIndexOf：照片早于起算日时给第 1 天，不给 0 或负数", () => {
    expect(dayIndexOf("2026-01-01", "2026-01-01")).toBe(1);
    expect(dayIndexOf("2026-01-01", "2026-01-10")).toBe(10);
    expect(dayIndexOf("2026-01-10", "2026-01-01")).toBe(1);
  });

  it("里程碑只有 100 / 365 / 1000，不含第 1 天", () => {
    expect(MILESTONE_DAYS).toEqual([100, 365, 1000]);
    expect(milestoneLabel(1)).toBeUndefined();
    expect(milestoneLabel(100)).toBe("第 100 天");
    expect(milestoneLabel(365)).toBe("一起过了一年");
    expect(milestoneLabel(1000)).toBe("第 1000 天");
    expect(milestoneLabel(742)).toBeUndefined();
  });
});
