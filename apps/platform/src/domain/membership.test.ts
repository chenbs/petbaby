import { describe, expect, it } from "vitest";

import { breakEvenDeliverables, describeEntitlements, singleBuyValue } from "@/domain/membership";

/*
 * 权益文案的派生规则。
 *
 * 这里测的核心是**「不描述拿不到的东西」**：`describeEntitlements` 同时充当
 * 「已实现兑付的权益白名单」（entitlement-redemption.test.ts 的清单式守卫依赖
 * 这个性质）。哪一项该被描述、哪一项不该，是这个函数唯一的职责。
 */
describe("权益文案派生", () => {
  it("tierUnlock 的措辞同时说清规格与价格", () => {
    const [benefit] = describeEntitlements({ tierUnlock: true });
    expect(benefit.key).toBe("tierUnlock");
    /*
     * 只说「规格上限解锁」会被读成空话（用户不知道规格是什么），
     * 只说「最低价」会漏掉会员真正拿到的内容量 —— 而这两个词
     * 正是 M1 缺陷的分界线，缺一个就可能被重新实现错。
     */
    expect(benefit.text).toContain("最高规格");
    expect(benefit.text).toContain("最低档");
  });

  it("按次权益带上总量", () => {
    const [benefit] = describeEntitlements({ annualReport: 2 });
    expect(benefit).toEqual({ key: "annualReport", text: "年度报告高清版 2 次免费解锁", units: 2 });
  });

  it("折扣按中文折数而不是百分比", () => {
    expect(describeEntitlements({ physicalDiscount: 0.9 })[0].text).toBe("实体纪念品 9 折");
    expect(describeEntitlements({ physicalDiscount: 0.85 })[0].text).toBe("实体纪念品 8.5 折");
  });

  /*
   * 健康两项在第三批（L1/L2）实施后由 P5 加回，此时才可被描述。
   *
   * **规则没变**：`describeEntitlements` 只描述已实现兑付的权益 ——
   * 描述一项拿不到的东西就是承诺一项拿不到的东西。变的只是哪些算已实现。
   */
  it("已实施的健康权益出现在文案里", () => {
    const benefits = describeEntitlements({ tierUnlock: true, healthExportUnlimited: true, annualHealthReport: 1 });
    expect(benefits.map((benefit) => benefit.key)).toEqual(["tierUnlock", "healthExportUnlimited", "annualHealthReport"]);
  });

  /*
   * 健康权益的卖点文案同样受红线约束：**不得出现「体检报告」「诊断」** ——
   * 这份文件是就医准备材料，内容全部来自用户自己录入的记录。
   */
  it("健康权益文案不含诊断类措辞", () => {
    const text = describeEntitlements({ healthExportUnlimited: true, annualHealthReport: 1 }).map((benefit) => benefit.text).join(" ");
    for (const word of ["诊断", "确诊", "问诊", "治愈", "体检报告"]) {
      expect(text, `「${word}」不该出现在权益文案里`).not.toContain(word);
    }
  });

  /** monthlyQuota 是 D6 判定的负向卖点（每月 10 次比免费用户每天 1 次还少）。 */
  it("旧结构的额度权益不作卖点", () => {
    expect(describeEntitlements({ monthlyQuota: 10, hdReports: true, hdVideo: 12 })).toEqual([]);
  });

  it("空权益与 undefined 都返回空列表，不报错", () => {
    expect(describeEntitlements(undefined)).toEqual([]);
    expect(describeEntitlements({})).toEqual([]);
  });

  /** 关闭态的权益（false / 0）不该被描述成拥有。 */
  it("关闭态权益不描述", () => {
    expect(describeEntitlements({ tierUnlock: false, annualReport: 0, physicalDiscount: 0 })).toEqual([]);
  });

  /** 折扣率为 1 等于不打折，说「10 折」是句废话。 */
  it("不打折时不生成折扣文案", () => {
    expect(describeEntitlements({ physicalDiscount: 1 })).toEqual([]);
  });
});

describe("权益估值", () => {
  /** 折扣类不计入 —— 它的价值取决于买多少实体，折算成数字是替用户假设消费额。 */
  it("按只做一件交付物的保守口径估值，折扣不计入", () => {
    expect(singleBuyValue({ tierUnlock: true, annualReport: 1, physicalDiscount: 0.9 })).toBe(49);
    expect(singleBuyValue({ physicalDiscount: 0.9 })).toBe(0);
  });

  it("按次权益按份数累加", () => {
    expect(singleBuyValue({ annualReport: 2 })).toBe(39.8);
  });

  it("无权益时为 0", () => {
    expect(singleBuyValue(undefined)).toBe(0);
  });

  /*
   * ¥69 会员：年报 19.9 先抵扣，剩 49.1 靠每件 29.1 的档差摊 ⇒ 两件回本。
   * 这是「省 ¥N」的诚实替代 —— 用户能自己算这道题。
   */
  it("回本件数扣掉一次性权益后按档差摊", () => {
    expect(breakEvenDeliverables({ tierUnlock: true, annualReport: 1, physicalDiscount: 0.9 }, 69)).toBe(2);
  });

  it("没有 tierUnlock 就没有回本件数可言", () => {
    expect(breakEvenDeliverables({ annualReport: 1 }, 69)).toBeUndefined();
  });

  /** 一次性权益已经盖过定价时不必谈回本 —— 买了就已经值了。 */
  it("一次性权益已覆盖定价时无需回本", () => {
    expect(breakEvenDeliverables({ tierUnlock: true, annualReport: 2 }, 19.9)).toBeUndefined();
  });
});
