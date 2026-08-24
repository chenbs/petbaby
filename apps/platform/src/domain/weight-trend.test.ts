import { describe, expect, it } from "vitest";

import { JUDGEMENT_WORDS } from "@/domain/copy-guard";
import { computeWeightTrend, formatWeight, notableWeightNote } from "@/domain/weight-trend";

/*
 * 体重趋势（改造项 L6）。
 *
 * 这一组里最重要的不是算得对，而是**说得对**：只陈述事实，不做评价。
 * BMI 与肥胖评级是评价性结论、接近诊断（16 号文红线），而体况评分本身
 * 是执业兽医的触诊项目 —— 靠体重数字算不出来。
 *
 * 所以有一条用例专门扫全部输出文本里的评价词。它是这个模块的红线守卫：
 * 将来有人想加一句「体重偏高」，那条用例会先失败。
 */

/*
 * 评价性词汇。出现任何一个都说明越过了「事实陈述」的边界。
 *
 * **清单已提到 `domain/copy-guard.json` 共用**（2026-08-05，宠物小岛门禁 11）：
 * 岛的文案门禁要扫同一份词表，而 22 号文 9.2 明确要求「复用已有的评价词清单，
 * 不新造一份（两份必然漂移）」。搬家时逐字保留，这条守卫的行为没有变化。
 */

describe("体重趋势：只陈述事实", () => {
  it("没有记录时返回 undefined，由调用方隐藏整块", () => {
    expect(computeWeightTrend([])).toBeUndefined();
    expect(computeWeightTrend(undefined as never)).toBeUndefined();
  });

  /** 只有一条记录时不谈趋势 —— 一个点画不出线 */
  it("单条记录只报事实并邀请再称一次", () => {
    const trend = computeWeightTrend([{ weightGrams: 4200, measuredOn: "2026-08-01" }])!;
    expect(trend.previous).toBeUndefined();
    expect(trend.deltaPercent).toBeUndefined();
    expect(trend.notable).toBe(false);
    expect(trend.statement).toContain("4.2 公斤");
    expect(trend.statement).toContain("再称一次");
  });

  it("上升给出克数、百分比与间隔天数", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4400, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ])!;
    expect(trend.direction).toBe("up");
    expect(trend.deltaGrams).toBe(400);
    expect(trend.deltaPercent).toBe(10);
    expect(trend.spanDays).toBe(31);
    expect(trend.statement).toContain("增加");
    expect(trend.statement).toContain("相隔 31 天");
  });

  it("下降给出负值但文案说「减少」", () => {
    const trend = computeWeightTrend([
      { weightGrams: 3600, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-20" },
    ])!;
    expect(trend.direction).toBe("down");
    expect(trend.deltaGrams).toBe(-400);
    expect(trend.deltaPercent).toBe(-10);
    expect(trend.statement).toContain("减少");
    /*
     * 差值取绝对值：方向已经由「减少」这个词表达，再写「减少 -400 克」是双重否定。
     * 不能整句扫 "-" —— 日期本身就带连字符。
     */
    expect(trend.statement).toContain("减少 400 克（10%）");
  });

  /*
   * ±1% 内算持平。4kg 猫的 1% 是 40g，家用宠物秤的重复性就在这个量级 ——
   * 把噪声说成「上升」会让用户以为发生了什么。
   */
  it("1% 以内算持平，不把秤的噪声说成变化", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4020, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-25" },
    ])!;
    expect(trend.direction).toBe("flat");
    expect(trend.statement).toContain("基本持平");
    expect(trend.notable).toBe(false);
  });

  /** 阈值边界：正好 5% 就算值得留意（含） */
  it("5% 是值得留意的边界，含", () => {
    const below = computeWeightTrend([
      { weightGrams: 4196, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ])!;
    expect(below.deltaPercent).toBe(4.9);
    expect(below.notable).toBe(false);
    const at = computeWeightTrend([
      { weightGrams: 4200, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ])!;
    expect(at.deltaPercent).toBe(5);
    expect(at.notable).toBe(true);
  });

  /** 减重同样触发提示 —— 掉秤往往比增重更值得说 */
  it("下降达到阈值同样值得留意", () => {
    const trend = computeWeightTrend([
      { weightGrams: 3800, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ])!;
    expect(trend.notable).toBe(true);
  });

  it("非法记录被过滤，不产生 NaN", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4000, measuredOn: "2026-08-01" },
      { weightGrams: 0, measuredOn: "2026-07-01" },
      { weightGrams: Number.NaN, measuredOn: "2026-06-01" },
    ])!;
    expect(trend.previous).toBeUndefined();
    expect(trend.statement).not.toContain("NaN");
  });

  /** 日期缺失或格式不对时不该炸，间隔按 0 处理 */
  it("日期不可解析时间隔为 0，文案不出现「相隔」", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4400, measuredOn: "" },
      { weightGrams: 4000, measuredOn: "" },
    ])!;
    expect(trend.spanDays).toBe(0);
    expect(trend.statement).not.toContain("相隔");
  });
});

describe("提示语不做评价（红线）", () => {
  it("变化不大时没有提示语", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4020, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-25" },
    ]);
    expect(notableWeightNote(trend)).toBeUndefined();
    expect(notableWeightNote(undefined)).toBeUndefined();
  });

  /*
   * **不说「异常」，只说变化幅度并把判断权交回兽医。**
   * 「异常」是评价（异常于什么？谁定的正常范围？），而我们没有资格给正常范围。
   */
  it("提示语只给幅度并建议就医时提一下", () => {
    const trend = computeWeightTrend([
      { weightGrams: 4400, measuredOn: "2026-08-01" },
      { weightGrams: 4000, measuredOn: "2026-07-01" },
    ]);
    const note = notableWeightNote(trend)!;
    expect(note).toContain("10%");
    expect(note).toContain("和兽医提一下");
    expect(note).not.toContain("异常");
  });

  /*
   * 红线守卫：扫全部输出文本，一个评价词都不能有。
   * 将来有人想加「体重偏高」这类判断，这条会先失败。
   */
  it("全部输出文本不含任何评价性词汇", () => {
    const samples = [
      [{ weightGrams: 4200, measuredOn: "2026-08-01" }],
      [{ weightGrams: 4400, measuredOn: "2026-08-01" }, { weightGrams: 4000, measuredOn: "2026-07-01" }],
      [{ weightGrams: 3600, measuredOn: "2026-08-01" }, { weightGrams: 4000, measuredOn: "2026-07-01" }],
      [{ weightGrams: 4020, measuredOn: "2026-08-01" }, { weightGrams: 4000, measuredOn: "2026-07-25" }],
      [{ weightGrams: 300, measuredOn: "2026-08-01" }, { weightGrams: 280, measuredOn: "2026-07-01" }],
    ];
    for (const records of samples) {
      const trend = computeWeightTrend(records)!;
      const text = `${trend.statement} ${notableWeightNote(trend) || ""}`;
      for (const word of JUDGEMENT_WORDS) {
        expect(text, `「${word}」是评价性词汇，不该出现在：${text}`).not.toContain(word);
      }
    }
  });
});

describe("重量展示", () => {
  it("1000 克以上给公斤并去掉尾零", () => {
    expect(formatWeight(4000)).toBe("4 公斤");
    expect(formatWeight(4200)).toBe("4.2 公斤");
    expect(formatWeight(1000)).toBe("1 公斤");
  });

  /** 幼猫增重以十克计，小于 1 公斤时给克才有意义 */
  it("1000 克以下给克", () => {
    expect(formatWeight(320)).toBe("320 克");
    expect(formatWeight(999)).toBe("999 克");
  });
});
