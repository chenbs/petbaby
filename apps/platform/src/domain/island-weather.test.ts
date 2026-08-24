import { describe, expect, it } from "vitest";

import {
  AI_LABEL_PLATE,
  HUD_PLATE,
  ISLAND_PALETTE,
  ISLAND_TEXT_COLOR,
  MIN_CLEAR_RATIO,
  SEGMENTS_PER_DAY,
  SEGMENT_STARTS,
  aiLabelContrastOnWhite,
  ambientAt,
  asDateKey,
  hudContrast,
  phaseAt,
  sceneTextContrast,
  segmentAt,
  weatherAt,
  weatherForDay,
  type IslandWeather,
} from "@/domain/island-weather";

/** 覆盖一整年的采样日期，用于统计类断言。取每月 1/8/15/22 日，跨闰年 */
const SAMPLE_DAYS: string[] = [];
for (let month = 1; month <= 12; month += 1) {
  for (const day of [1, 8, 15, 22]) {
    SAMPLE_DAYS.push(`2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`);
  }
}
const SAMPLE_ISLANDS = ["11111111-1111-1111-1111-111111111111", "22222222-2222-2222-2222-222222222222", "island-c", "island-d"];

describe("岛屿天气：确定性", () => {
  /**
   * 天气不建表、不存储，全靠这条性质成立（22 号文 5.4）。
   * 一旦同一输入给出不同结果，用户刷新页面天气就会变，且服务端日记与端上画面会打架。
   */
  it("同一 (岛, 日期) 必得同一序列", () => {
    for (const islandId of SAMPLE_ISLANDS) {
      for (const date of SAMPLE_DAYS) {
        const first = weatherForDay(islandId, date);
        expect(weatherForDay(islandId, date)).toEqual(first);
        expect(first).toHaveLength(SEGMENTS_PER_DAY);
      }
    }
  });

  it("Date、YYYY-MM-DD、ISO 时间戳三种输入等价（date 列读出来可能是 JS Date）", () => {
    const islandId = SAMPLE_ISLANDS[0];
    const expected = weatherForDay(islandId, "2026-03-14");
    expect(weatherForDay(islandId, new Date(2026, 2, 14))).toEqual(expected);
    expect(weatherForDay(islandId, new Date(2026, 2, 14, 23, 30))).toEqual(expected);
    expect(weatherForDay(islandId, "2026-03-14T09:00:00.000Z")).toEqual(expected);
  });

  /** 全体用户同时下雨会显得像统一活动，分享截图时尤其明显 */
  it("不同岛在同一天不都相同", () => {
    const date = "2026-06-10";
    const sequences = new Set(SAMPLE_ISLANDS.map((islandId) => weatherForDay(islandId, date).join(",")));
    expect(sequences.size).toBeGreaterThan(1);
  });

  it("同一岛在不同日期不都相同", () => {
    const islandId = SAMPLE_ISLANDS[0];
    const sequences = new Set(SAMPLE_DAYS.map((date) => weatherForDay(islandId, date).join(",")));
    expect(sequences.size).toBeGreaterThan(1);
  });
});

describe("岛屿天气：全天约束（2.5.3）", () => {
  /**
   * 「晴天占比 ≥60%」按段计不按天计。这条与下一条一起解释了为什么接口是
   * `weatherForDay(岛, 日) → [5 段]` 而不是单点函数 —— 跨段约束无法逐段独立随机施加。
   */
  it("每一天晴天段数都 ≥60%", () => {
    const minClear = Math.ceil(SEGMENTS_PER_DAY * MIN_CLEAR_RATIO);
    for (const islandId of SAMPLE_ISLANDS) {
      for (const date of SAMPLE_DAYS) {
        const segments = weatherForDay(islandId, date);
        const clear = segments.filter((weather) => weather === "clear").length;
        expect(clear, `${islandId} ${date} → ${segments.join(",")}`).toBeGreaterThanOrEqual(minClear);
      }
    }
  });

  /** 连续两段雨在体验上就是「今天一直在下雨」，正是 2.5.2 要避免的 */
  it("雨+雪合计 ≤2 段，且不连续", () => {
    for (const islandId of SAMPLE_ISLANDS) {
      for (const date of SAMPLE_DAYS) {
        const segments = weatherForDay(islandId, date);
        const wet = segments.filter((weather) => weather === "rain" || weather === "snow");
        expect(wet.length, `${islandId} ${date} → ${segments.join(",")}`).toBeLessThanOrEqual(2);
        for (let index = 1; index < segments.length; index += 1) {
          const both = ["rain", "snow"].includes(segments[index]) && ["rain", "snow"].includes(segments[index - 1]);
          expect(both, `${islandId} ${date} 第 ${index - 1}/${index} 段连续湿档`).toBe(false);
        }
      }
    }
  });

  /** 雪只在冬季月份出现（12/1/2）。六月飘雪不是治愈，是 bug */
  it("雪只在冬季月份出现", () => {
    for (const islandId of SAMPLE_ISLANDS) {
      for (const date of SAMPLE_DAYS) {
        if (!weatherForDay(islandId, date).includes("snow")) continue;
        expect([12, 1, 2], `${islandId} ${date} 出现了雪`).toContain(Number(date.slice(5, 7)));
      }
    }
  });

  /** 反面：冬季确实下得到雪，否则「雪档」是死代码 */
  it("冬季能出现雪，四档都出现得到", () => {
    const seen = new Set<IslandWeather>();
    for (const islandId of SAMPLE_ISLANDS) {
      for (let day = 1; day <= 28; day += 1) {
        for (const month of ["01", "02", "12"]) {
          for (const weather of weatherForDay(islandId, `2026-${month}-${String(day).padStart(2, "0")}`)) seen.add(weather);
        }
      }
    }
    expect([...seen].sort()).toEqual(["clear", "cloudy", "rain", "snow"]);
  });

  /** 晴天不能是唯一结果：全年只有晴等于没做天气 */
  it("非冬季也出得到阴与雨", () => {
    const seen = new Set<IslandWeather>();
    for (const islandId of SAMPLE_ISLANDS) {
      for (let day = 1; day <= 28; day += 1) {
        for (const weather of weatherForDay(islandId, `2026-07-${String(day).padStart(2, "0")}`)) seen.add(weather);
      }
    }
    expect(seen.has("cloudy")).toBe(true);
    expect(seen.has("rain")).toBe(true);
    expect(seen.has("snow")).toBe(false);
  });
});

describe("分段与昼夜边界（2.5.3）", () => {
  it("切换点是 05/09/13/17/21，一天 5 段", () => {
    expect([...SEGMENT_STARTS]).toEqual([5, 9, 13, 17, 21]);
    const mapping = [5, 8, 9, 12, 13, 16, 17, 20, 21, 23].map((hour) => segmentAt("2026-08-05", hour).index);
    expect(mapping).toEqual([0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
  });

  /**
   * 05:00 之前属**前一天**的末段。21:00 起的那段延续到次日清晨，
   * 凌晨两点看到的天气应与睡前一致，而不是零点换日时凭空变一次。
   */
  it("05:00 之前归前一天的末段", () => {
    for (const hour of [0, 1, 4]) {
      expect(segmentAt("2026-08-05", hour)).toEqual({ dateKey: "2026-08-04", index: SEGMENTS_PER_DAY - 1 });
    }
    // 跨月与跨年：字符串减法会算错，所以内部走 Date 运算
    expect(segmentAt("2026-08-01", 2).dateKey).toBe("2026-07-31");
    expect(segmentAt("2026-01-01", 2).dateKey).toBe("2025-12-31");
    expect(segmentAt("2028-03-01", 2).dateKey).toBe("2028-02-29");
  });

  it("weatherAt 与 weatherForDay 逐段一致，且跨零点取到前一天的天气", () => {
    const islandId = SAMPLE_ISLANDS[0];
    for (const date of SAMPLE_DAYS) {
      const segments = weatherForDay(islandId, date);
      for (const hour of [5, 9, 13, 17, 21, 23]) {
        expect(weatherAt(islandId, date, hour)).toBe(segments[segmentAt(date, hour).index]);
      }
      // 凌晨取到前一天末段，而不是当天首段
      expect(weatherAt(islandId, date, 2)).toBe(weatherForDay(islandId, segmentAt(date, 2).dateKey)[SEGMENTS_PER_DAY - 1]);
    }
  });

  /** 夜档起点 21:00（不是 20:00）正是为了并入天气段边界 */
  it("昼夜四档的边界：夜档跨零点，21:00 起", () => {
    expect([0, 3, 4].map(phaseAt)).toEqual(["night", "night", "night"]);
    expect([5, 8].map(phaseAt)).toEqual(["dawn", "dawn"]);
    expect([9, 12, 16].map(phaseAt)).toEqual(["day", "day", "day"]);
    expect([17, 20].map(phaseAt)).toEqual(["dusk", "dusk"]);
    expect([21, 23].map(phaseAt)).toEqual(["night", "night"]);
  });

  it("每个昼夜边界都与某个天气切换点重合（不制造碎片区间）", () => {
    // 昼夜边界取自 phaseAt 的跳变点；13:00 是长白昼中间补的一次，不是昼夜边界
    const phaseBoundaries: number[] = [];
    for (let hour = 1; hour < 24; hour += 1) {
      if (phaseAt(hour) !== phaseAt(hour - 1)) phaseBoundaries.push(hour);
    }
    expect(phaseBoundaries).toEqual([5, 9, 17, 21]);
    for (const hour of phaseBoundaries) expect(SEGMENT_STARTS).toContain(hour);
  });

  it("异常 hour 不抛错也不越界（端上时间可为任意值）", () => {
    for (const hour of [-3, 24, 99, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = segmentAt("2026-08-05", hour as number);
      expect(result.index).toBeGreaterThanOrEqual(0);
      expect(result.index).toBeLessThan(SEGMENTS_PER_DAY);
      expect(["dawn", "day", "dusk", "night"]).toContain(phaseAt(hour as number));
    }
  });

  it("asDateKey 不把 Date 转成 'Sat Aug 01'，也不因 UTC 退回前一天", () => {
    // 健康线已经踩过一次：String(value).slice(0,10) 对 Date 得到 "Sat Aug 01"
    expect(asDateKey(new Date(2026, 7, 1))).toBe("2026-08-01");
    // 东八区的 00:30 转 UTC 会退回 7-31，所以 Date 分支必须取本地年月日
    expect(asDateKey(new Date(2026, 7, 1, 0, 30))).toBe("2026-08-01");
    expect(asDateKey("2026-08-01")).toBe("2026-08-01");
    expect(asDateKey("2026-8-1")).toBe("2026-08-01");
    // 脏值不抛错：天气是纯表现层，宁可给一个稳定的错日期也不要让岛打不开
    expect(asDateKey("")).toBe("");
    expect(asDateKey(null)).toBe("");
    expect(asDateKey("garbage")).toBe("garbage");
    expect(() => weatherForDay("island-x", "garbage")).not.toThrow();
    // 无效日期串仍然确定：同一脏值必得同一序列
    expect(weatherForDay("island-x", "garbage")).toEqual(weatherForDay("island-x", "garbage"));
  });
});

describe("环境合成与 HUD 可读性（2.5.1 / 门禁 16）", () => {
  /** 四档昼夜各取一个代表小时 */
  const PHASE_HOURS = [6, 12, 18, 22];

  /**
   * 穷举 16 种昼夜 × 天气组合。
   *
   * 扫全年逐日而非 `SAMPLE_DAYS` 的稀疏采样：雪只在冬季出现，而「暮+雪」要求
   * 某个冬日的第 3 段（17:00 起）恰好是雪 —— 每月取 4 天时这个组合会漏掉，
   * 而漏掉一种组合正是门禁 16 最不能接受的事（那一种就是没被校验的那一种）。
   */
  function ambients() {
    const found: { label: string; ambient: ReturnType<typeof ambientAt> }[] = [];
    for (const hour of PHASE_HOURS) {
      for (const islandId of SAMPLE_ISLANDS) {
        for (let month = 1; month <= 12; month += 1) {
          for (let day = 1; day <= 28; day += 1) {
            const date = `2026-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
            const ambient = ambientAt(islandId, date, hour);
            const label = `${ambient.phase}+${ambient.weather}`;
            if (!found.some((entry) => entry.label === label)) found.push({ label, ambient });
          }
        }
      }
    }
    return found;
  }

  it("采样能覆盖到全部 16 种组合", () => {
    expect(ambients()).toHaveLength(16);
  });

  it("基准档（晴昼）不叠任何图层", () => {
    const clearDay = ambients().find((entry) => entry.label === "day+clear");
    expect(clearDay?.ambient.overlays).toEqual([]);
    expect(clearDay?.ambient.particles).toBeUndefined();
  });

  it("叠加顺序是先昼夜再天气，且复现 2.5.1 的实算明度", () => {
    const rainyNight = ambients().find((entry) => entry.label === "night+rain");
    expect(rainyNight?.ambient.overlays.map((layer) => layer.color)).toEqual(["#3D4470", "#8C93A0"]);
    // 表中「雨+夜」草地合成后明度 0.485。这里按 0–1 的 sRGB 均值口径复算
    const scene = sceneTextContrast(ISLAND_TEXT_COLOR, ISLAND_PALETTE.grass, rainyNight!.ambient);
    // 表中给的是 3.23:1（深色字直接压场景），允许 ±0.1 的口径误差
    expect(scene).toBeGreaterThan(3.1);
    expect(scene).toBeLessThan(3.35);
  });

  /**
   * **这是底板存在的唯一理由，也是本轮对标修订带出的最重要一处结构改动。**
   * 若沿用「无底板」方案，雨夜档的 HUD 会实际不可读，而这种问题在白昼开发时完全看不出来。
   */
  it("没有任何单一字色能覆盖 16 种组合（深色字与白字各有失手的一端）", () => {
    const surfaces = [ISLAND_PALETTE.grass, ISLAND_PALETTE.canopy, ISLAND_PALETTE.cream, ISLAND_PALETTE.sky];
    const darkFailures: string[] = [];
    const whiteFailures: string[] = [];
    for (const { label, ambient } of ambients()) {
      for (const surface of surfaces) {
        if (sceneTextContrast(ISLAND_TEXT_COLOR, surface, ambient) < 4.5) darkFailures.push(`${label}/${surface}`);
        if (sceneTextContrast("#FFFFFF", surface, ambient) < 4.5) whiteFailures.push(`${label}/${surface}`);
      }
    }
    expect(darkFailures.length).toBeGreaterThan(0);
    expect(whiteFailures.length).toBeGreaterThan(0);
  });

  /** 门禁 16：校验**底板合成后**的对比度，而非文字与地表的直接对比度 */
  it("加了底板后，16 种组合 × 全部地表色一律 ≥4.5:1", () => {
    for (const { label, ambient } of ambients()) {
      for (const [name, surface] of Object.entries(ISLAND_PALETTE)) {
        const ratio = hudContrast(surface, ambient);
        expect(ratio, `${label} / ${name}(${surface}) = ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  it("底板与 AI 标识底衬不可共用：一浅一深，用途相反", () => {
    // 底板压住的是「文字要读得清」，底衬压住的是「白字要在最亮画面上显著」
    expect(HUD_PLATE.color).toBe(ISLAND_PALETTE.cream);
    expect(AI_LABEL_PLATE.color).not.toBe(HUD_PLATE.color);
    // 1.5：最坏帧是纯白（阳光高光/白猫/雪地），不是任一地表色
    expect(aiLabelContrastOnWhite()).toBeGreaterThanOrEqual(4.5);
    expect(AI_LABEL_PLATE.opacity).toBeGreaterThanOrEqual(0.62);
  });

  it("雨雪档给粒子且切屋檐站位，晴/阴档不给", () => {
    for (const { label, ambient } of ambients()) {
      const wet = ambient.weather === "rain" || ambient.weather === "snow";
      expect(Boolean(ambient.particles), label).toBe(wet);
      // 2.5.2：雨档的正确实现不是「淋雨的宠物」而是「一起躲雨」
      expect(ambient.shelter, label).toBe(wet);
      if (ambient.particles) {
        expect(ambient.particles.kind).toBe(ambient.weather === "rain" ? "rain" : "snow");
        // 低端安卓（骁龙 6xx 级）降到 40 以内
        expect(ambient.particles.degradedCount).toBeLessThanOrEqual(40);
        expect(ambient.particles.degradedCount).toBeLessThan(ambient.particles.count);
      }
    }
  });

  it("nextSegmentHour 指向下一个切换点，末段回卷到 05:00", () => {
    const islandId = SAMPLE_ISLANDS[0];
    expect(ambientAt(islandId, "2026-08-05", 6).nextSegmentHour).toBe(9);
    expect(ambientAt(islandId, "2026-08-05", 20).nextSegmentHour).toBe(21);
    expect(ambientAt(islandId, "2026-08-05", 22).nextSegmentHour).toBe(5);
    expect(ambientAt(islandId, "2026-08-05", 2).nextSegmentHour).toBe(5);
  });

  it("夜与暮才画窗户暖光（「家」的意象）", () => {
    for (const { ambient } of ambients()) {
      expect(ambient.windowGlow).toBe(ambient.phase === "night" || ambient.phase === "dusk");
    }
  });
});

