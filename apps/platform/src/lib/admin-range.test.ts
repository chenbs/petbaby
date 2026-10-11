import { describe, expect, it } from "vitest";

import { addDays, daysBetween, rangeInstants, rangeQuery, resolveAdminRange, shanghaiToday } from "./admin-range";

const NOW = new Date("2026-10-10T17:30:00Z"); // 北京时间 2026-10-11 01:30

describe("运营后台统计区间", () => {
  it("「今天」按北京时间切日，而不是 UTC", () => {
    expect(shanghaiToday(NOW)).toBe("2026-10-11");
    const range = resolveAdminRange({ range: "today" }, NOW);
    expect(range).toMatchObject({ from: "2026-10-11", to: "2026-10-11", days: 1, previousFrom: "2026-10-10", previousTo: "2026-10-10" });
  });

  it("预设区间含首尾，上一周期等长且紧邻", () => {
    const range = resolveAdminRange({ range: "7d" }, NOW);
    expect(range).toMatchObject({ from: "2026-10-05", to: "2026-10-11", days: 7, previousFrom: "2026-09-28", previousTo: "2026-10-04" });
    expect(daysBetween(range.previousFrom, range.previousTo)).toBe(7);
  });

  it("缺省与非法参数回落到近 30 天", () => {
    expect(resolveAdminRange({}, NOW)).toMatchObject({ preset: "30d", days: 30 });
    expect(resolveAdminRange({ range: "custom", from: "2026-13-01", to: "x" }, NOW)).toMatchObject({ preset: "30d" });
    expect(resolveAdminRange({ range: "custom", from: "2026-10-09", to: "2026-10-01" }, NOW)).toMatchObject({ preset: "30d" });
  });

  it("自定义区间不越过今天，最长 366 天", () => {
    expect(resolveAdminRange({ range: "custom", from: "2026-10-01", to: "2026-12-31" }, NOW)).toMatchObject({ from: "2026-10-01", to: "2026-10-11", days: 11 });
    const long = resolveAdminRange({ range: "custom", from: "2020-01-01", to: "2026-10-11" }, NOW);
    expect(long.days).toBe(366);
    expect(long.to).toBe("2026-10-11");
  });

  it("北京日期转成左闭右开的 UTC 时刻", () => {
    const { start, end } = rangeInstants("2026-10-11", "2026-10-11");
    expect(start.toISOString()).toBe("2026-10-10T16:00:00.000Z");
    expect(end.toISOString()).toBe("2026-10-11T16:00:00.000Z");
    expect(addDays("2026-10-31", 1)).toBe("2026-11-01");
  });

  it("查询串只在自定义区间带日期", () => {
    expect(rangeQuery({ preset: "7d", from: "a", to: "b" })).toBe("range=7d");
    expect(rangeQuery({ preset: "custom", from: "2026-10-01", to: "2026-10-02" })).toBe("range=custom&from=2026-10-01&to=2026-10-02");
  });
});
