/*
 * 会员权益的**唯一文案来源**（改造项 M3）。
 *
 * 改造前权益文案有三份各自独立的副本：迁移 SQL 的权益 JSON、
 * `components/commerce-client.tsx` 的按钮文字、小程序 `pages/commerce/commerce.js`
 * 的 PLANS 数组。三份必然走散，而它们已经走散了：迁移把年费改成 ¥128 并删掉
 * 「每月生成额度」后，两端仍在卖「月会员 ¥25 / 年会员 ¥199」并写着
 * 「每月生成额度加量」「额度按月自动重置」—— 标价与实收不一致是价格欺诈风险，
 * 而「额度加量」在新权益下根本不存在。
 *
 * 现在的口径是：**权益 JSON 是事实，文案由它派生，两端都从接口读。**
 * 端上不得再出现任何写死的套餐名、价格或权益条目。
 *
 * 放 domain/ 而不是 server/：小程序拿不到这个文件，但 Web 端的客户端组件
 * 要用同一套类型，从 server/ 导入会让 RSC 边界看起来是错的 ——
 * 沿用 domain/pricing.ts 与 domain/video-duration.ts 的先例。
 */

export type MembershipEntitlementMap = {
  tierUnlock?: boolean;
  healthExportUnlimited?: boolean;
  annualHealthReport?: number;
  annualReport?: number;
  physicalDiscount?: number;
  /** 旧结构（迁移 0013 的 v1）残留字段，只用于识别历史会员，不生成卖点文案 */
  monthlyQuota?: number;
  hdReports?: boolean;
  hdVideo?: number;
};

export type MembershipBenefit = {
  /** 权益键，端上做 wx:key 与埋点用 */
  key: string;
  /** 一行卖点，直接展示 */
  text: string;
  /** 按次权益的周期总量；布尔或折扣类权益没有 */
  units?: number;
};

/**
 * 把权益 JSON 翻成用户看得懂的一行行卖点。
 *
 * 只输出**已实现兑付**的权益。A5/A6 未实施期间，即使某个历史套餐的 JSON 里
 * 还留着 `healthExportUnlimited` / `annualHealthReport`，也不会被描述出来 ——
 * 描述一项拿不到的东西就是承诺一项拿不到的东西。
 *
 * **不描述 `monthlyQuota`**：那是 D6 判定的负向卖点（每月 10 次比免费用户
 * 每天 1 次还少）。已购月会员按 JSON 履约，但不再作为卖点展示。
 */
export function describeEntitlements(entitlements: MembershipEntitlementMap | undefined): MembershipBenefit[] {
  const value = entitlements || {};
  const benefits: MembershipBenefit[] = [];
  if (value.tierUnlock) {
    /*
     * 措辞必须同时说清「规格」与「价格」两件事。只说「规格上限解锁」
     * 会被读成一句空话（用户不知道规格是什么），只说「最低价」会漏掉
     * 会员真正拿到的内容量。这两个词也正是 M1 缺陷的分界线。
     */
    benefits.push({ key: "tierUnlock", text: "画册与短片按最高规格制作，价格按最低档收" });
  }
  /*
   * 健康档案与年度健康记录（L1/L2 实施后由 P5 加回，迁移 0023）。
   *
   * **措辞不能出现「体检报告」「诊断」** —— 这份文件是就医准备材料，
   * 内容全部来自用户自己录入的记录（红线 1，且卖点文案同样受约束）。
   */
  if (value.healthExportUnlimited) {
    benefits.push({ key: "healthExportUnlimited", text: "健康档案 PDF 无限导出，就医时给兽医看" });
  }
  if (typeof value.annualHealthReport === "number" && value.annualHealthReport > 0) {
    benefits.push({ key: "annualHealthReport", text: `年度健康记录 ${value.annualHealthReport} 次`, units: value.annualHealthReport });
  }
  if (typeof value.annualReport === "number" && value.annualReport > 0) {
    benefits.push({ key: "annualReport", text: `年度报告高清版 ${value.annualReport} 次免费解锁`, units: value.annualReport });
  }
  if (typeof value.physicalDiscount === "number" && value.physicalDiscount > 0 && value.physicalDiscount < 1) {
    // 0.9 →「9 折」，0.85 →「8.5 折」。中文习惯用折数而不是百分比。
    const tenths = Math.round(value.physicalDiscount * 100) / 10;
    benefits.push({ key: "physicalDiscount", text: `实体纪念品 ${tenths} 折` });
  }
  return benefits;
}

/**
 * 单买这些权益要花多少。用于「会员比单买省多少」这句话。
 *
 * 单价与各处的实收价必须对得上：年报 19.9 来自 growth-service 的
 * `ANNUAL_REPORT_UNLOCK_PRICE`，tierUnlock 的 29.1 是画册 annual(49) 与
 * basic(19.9) 的差额（domain/pricing.ts 的 TIER_PRICES）。
 * 这两处任一改价，这里要跟着改 —— 所以宁可写少不写多：
 * tierUnlock 只按「一件交付物」算，实际会员做几件就省几倍。
 */
const SINGLE_BUY_VALUE: Record<string, number> = {
  tierUnlock: 29.1,
  annualReport: 19.9,
  /*
   * 健康档案单买 ¥29.9/次（`HEALTH_ARCHIVE_PRICE`）。「无限导出」按**一次**计价 ——
   * 保守口径：真实导出次数只有用户知道，按多次算就是替他假设消费量。
   */
  healthExportUnlimited: 29.9,
  annualHealthReport: 39.9,
};

/**
 * 权益的单买合计值，**按「只做一件交付物」的保守口径**。
 *
 * 折扣类权益（physicalDiscount）不计入 —— 它的价值取决于买多少实体，
 * 折算成一个数字就是在替用户假设消费额。
 *
 * 这个值可能**低于会员定价**：tierUnlock 的价值随做的件数线性增长，
 * 只做一件时它只值一次档差。这种情况下不能宣称「省了多少」（见 `saving`），
 * 而应该给出回本件数（`breakEvenDeliverables`）—— 那是用户能自己验证的事实，
 * 而「省 ¥N」在他只做一件时是假的。
 */
export function singleBuyValue(entitlements: MembershipEntitlementMap | undefined): number {
  const value = entitlements || {};
  let total = 0;
  if (value.tierUnlock) total += SINGLE_BUY_VALUE.tierUnlock;
  if (value.healthExportUnlimited) total += SINGLE_BUY_VALUE.healthExportUnlimited;
  if (typeof value.annualHealthReport === "number" && value.annualHealthReport > 0) total += SINGLE_BUY_VALUE.annualHealthReport * value.annualHealthReport;
  if (typeof value.annualReport === "number" && value.annualReport > 0) total += SINGLE_BUY_VALUE.annualReport * value.annualReport;
  return Math.round(total * 100) / 100;
}

/**
 * 会员费要做几件分档交付物才回本。tierUnlock 缺失或已回本时返回 undefined。
 *
 * 这是「省 ¥N」的诚实替代品：¥69 的会员含年报 ¥19.9，剩下 ¥49.1 靠每件
 * 省 ¥29.1 的档差摊平，所以两件回本。用户能自己算这道题，也就能自己判断
 * 值不值 —— 而这正是分档定价想达到的效果（16 号文 P2-3 的「价格锚」）。
 */
export function breakEvenDeliverables(entitlements: MembershipEntitlementMap | undefined, amount: number): number | undefined {
  const value = entitlements || {};
  if (!value.tierUnlock) return undefined;
  /*
   * 一次性权益先抵扣，剩下的靠每件交付物的档差摊。
   *
   * 「一次性部分」由 `singleBuyValue` 减去 tierUnlock 的单件值导出，
   * **不逐项列举** —— 逐项列举会在加新权益时漏掉一项（P5 加回两项健康权益时
   * 就漏过一次：回本件数从 2 变成 4，因为健康权益没被算进抵扣）。
   */
  const fixed = singleBuyValue(value) - SINGLE_BUY_VALUE.tierUnlock;
  const remaining = amount - fixed;
  if (remaining <= 0) return undefined;
  return Math.ceil(remaining / SINGLE_BUY_VALUE.tierUnlock);
}
