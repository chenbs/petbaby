/*
 * 体重趋势的**事实陈述**（改造项 L6）。
 *
 * A4 只存不看等于相册 —— 体重的价值全在趋势里。但这里有一条硬边界：
 *
 * **只陈述事实，不做评价。** 给「较上次 +6.2%」，不给「偏胖」「超重」「营养不良」。
 * BMI 与肥胖评级是**评价性结论，接近诊断**（16 号文红线 1 与 3.4 的边界），
 * 而体况评分（BCS）本身是执业兽医的触诊项目，靠体重数字算不出来。
 *
 * 「变化了多少」是用户自己称出来的两个数之差，我们只是替他算了减法；
 * 「这个体重是否健康」需要品种、年龄、体型、肌肉量与触诊，不是我们能回答的。
 * 这条界线决定了本模块只做前者。
 *
 * 放 domain/ 而不是 server/：小程序的健康页与服务端的健康档案 PDF 都要用
 * 同一套口径，且不涉及任何数据库或药物词典 —— 沿用 domain/pricing.ts 的先例。
 */

export interface WeightPoint {
  /** 体重，克。整数存储：浮点公斤会出现 4.1+0.2 != 4.3 的显示问题 */
  weightGrams: number;
  /** 称重日期，YYYY-MM-DD。是「哪一天称的」而不是「哪一刻」 */
  measuredOn: string;
}

/**
 * 变化方向。`flat` 是「基本没变」——
 * 把 ±0.5% 的波动说成「上升」会让用户以为发生了什么，
 * 而那个幅度在家用秤上就是噪声（4kg 猫的 0.5% 是 20g）。
 */
export type WeightDirection = "up" | "down" | "flat";

/** 视作「基本没变」的百分比阈值。家用宠物秤的重复性大约在这个量级 */
const FLAT_THRESHOLD_PERCENT = 1;

export interface WeightTrend {
  /** 最近一次称重 */
  latest: WeightPoint;
  /** 上一次称重。只有一条记录时没有 —— 此时不谈趋势 */
  previous?: WeightPoint;
  /** 相对上一次的变化，克。可为负 */
  deltaGrams?: number;
  /** 相对上一次的变化百分比，一位小数。可为负 */
  deltaPercent?: number;
  direction?: WeightDirection;
  /** 两次称重相隔天数 */
  spanDays?: number;
  /**
   * 一句事实陈述。**不含任何评价词**（胖/瘦/超重/偏轻/正常/健康）。
   * 只有一条记录时说明「再称一次就能看到变化」。
   */
  statement: string;
  /**
   * 是否值得提示用户留意。**这不是「异常」判定，是「变化幅度较大」的事实。**
   * 用它触发的文案也只能说「变化了 X%，可以和兽医提一下」，
   * 不能说「体重异常」——「异常」是评价。
   */
  notable: boolean;
}

/**
 * 值得留意的变化幅度阈值（百分比）。
 *
 * 取 5%：犬猫体重短期变化 5% 以上通常有原因（饮食变化、体液、疾病），
 * 值得在就医时提一句。这个数字是**提示阈值不是诊断阈值** ——
 * 它决定「要不要告诉用户这件事」，不决定「这件事意味着什么」。
 */
const NOTABLE_PERCENT = 5;

/** 克 → 展示用文本。1000g 以上给公斤，避免「4200 克」这种读起来费劲的写法 */
export function formatWeight(grams: number): string {
  if (grams >= 1000) {
    const kilograms = grams / 1000;
    // 保留一位小数，且去掉「4.0」这种尾零
    return `${Number(kilograms.toFixed(1))} 公斤`;
  }
  return `${Math.round(grams)} 克`;
}

/** 两个纯日期串相差多少天。与 domain/companion.ts 的「纯日期按本地零点」同口径 */
function daysBetween(earlier: string, later: string): number {
  const parse = (text: string) => {
    const parts = String(text).split(/[^0-9]/).filter(Boolean);
    if (parts.length < 3) return null;
    return Date.UTC(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  };
  const from = parse(earlier);
  const to = parse(later);
  if (from === null || to === null) return 0;
  return Math.max(0, Math.round((to - from) / 86_400_000));
}

/**
 * 算出体重趋势。
 *
 * @param records 体重记录，**按日期倒序**（最近的在前）—— 与
 *        `health-service.listWeights` 的返回顺序一致，调用方不必再排。
 *
 * 空数组返回 undefined，由调用方决定隐藏整块而不是显示一个空壳。
 */
export function computeWeightTrend(records: WeightPoint[]): WeightTrend | undefined {
  const points = (records || []).filter((item) => item && Number.isFinite(item.weightGrams) && item.weightGrams > 0);
  if (!points.length) return undefined;
  const latest = points[0];
  const previous = points[1];

  if (!previous) {
    return {
      latest,
      statement: `${latest.measuredOn} 称重 ${formatWeight(latest.weightGrams)}。再称一次就能看到变化。`,
      notable: false,
    };
  }

  const deltaGrams = latest.weightGrams - previous.weightGrams;
  const deltaPercent = Number(((deltaGrams / previous.weightGrams) * 100).toFixed(1));
  const magnitude = Math.abs(deltaPercent);
  const direction: WeightDirection = magnitude < FLAT_THRESHOLD_PERCENT ? "flat" : deltaGrams > 0 ? "up" : "down";
  const spanDays = daysBetween(previous.measuredOn, latest.measuredOn);

  /*
   * 措辞全部是可核对的事实：日期、重量、差值、间隔天数。
   * 没有一个词在评价这个体重好不好 —— 那是兽医面诊的事。
   */
  const spanText = spanDays > 0 ? `相隔 ${spanDays} 天，` : "";
  const statement = direction === "flat"
    ? `${latest.measuredOn} 称重 ${formatWeight(latest.weightGrams)}，${spanText}与上次基本持平。`
    : `${latest.measuredOn} 称重 ${formatWeight(latest.weightGrams)}，${spanText}较上次${direction === "up" ? "增加" : "减少"} ${formatWeight(Math.abs(deltaGrams))}（${magnitude}%）。`;

  return {
    latest,
    previous,
    deltaGrams,
    deltaPercent,
    direction,
    spanDays,
    statement,
    notable: magnitude >= NOTABLE_PERCENT,
  };
}

/**
 * 值得留意时的提示语。**不说「异常」，只说变化幅度并建议就医时提一下。**
 *
 * 「异常」是评价性判断（异常于什么？谁定的正常范围？），而我们没有资格给出
 * 正常范围。能说的只是「变了这么多」这个事实，以及「和兽医提一下」这个动作 ——
 * 后者把判断权交回给有资格的人，这正是分诊而非诊断的含义。
 */
export function notableWeightNote(trend: WeightTrend | undefined): string | undefined {
  if (!trend || !trend.notable || trend.deltaPercent === undefined) return undefined;
  const magnitude = Math.abs(trend.deltaPercent);
  const spanText = trend.spanDays ? `${trend.spanDays} 天内` : "两次称重之间";
  return `${spanText}体重变化了 ${magnitude}%，下次就医时可以和兽医提一下。`;
}
