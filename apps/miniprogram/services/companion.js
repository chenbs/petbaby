/**
 * 陪伴天数。UI 重构方案 E 把它称作「成本最低的留存钩子」：
 * 它每天都在变，且只属于这个用户。
 *
 * 起算日优先用生日 / 到家日，缺失时退回档案创建日 —— 宁可少算，
 * 也不要因为没填生日就不显示，那会让新用户看到一个空槽。
 */

/** 一天的毫秒数 */
const DAY = 86400000;

/**
 * 把日期值归一到**本地零点**。两类输入要分开处理，否则天数会差一天：
 *
 * - 纯日期串（"2025-02-03"，用户在 picker 里填的生日）是一个日历日期，
 *   直接 new Date() 会按 UTC 零点解析，在东八区变成本地 08:00。
 * - ISO 时间戳（"2026-07-21T22:00:00.000Z"，服务端的 memorialSince）是一个时刻，
 *   必须先转成本地时区再取年月日 —— 上面这个例子在东八区已经是 7-22 了，
 *   照抄字符串里的 21 会把离开日期记早一天。
 */
function startOfLocalDay(value) {
  if (!value) return null;
  const text = String(value);
  if (text.indexOf("T") > 0) {
    const instant = new Date(text);
    if (isNaN(instant.getTime())) return null;
    return new Date(instant.getFullYear(), instant.getMonth(), instant.getDate());
  }
  const parts = text.split(/[^0-9]/).filter(Boolean);
  if (parts.length < 3) return null;
  const date = new Date(Number(parts[0]), Number(parts[1]) - 1, Number(parts[2]));
  return isNaN(date.getTime()) ? null : date;
}

function todayLocalStart() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

/**
 * 起算日到截止日的天数，含当天（当天为第 1 天）。
 *
 * @param {string} value 起算日
 * @param {string} [until] 截止日，缺省为今天。已离开的宠物必须传离开日期 ——
 *        否则「陪伴了 N 天」会每天继续往上涨，而那件事已经结束了。
 *
 * 起算日晚于截止日（用户填错生日）时返回 0，让调用方据此隐藏，而不是显示负数。
 */
function daysSince(value, until) {
  const start = startOfLocalDay(value);
  if (!start) return 0;
  const end = until ? startOfLocalDay(until) : todayLocalStart();
  if (!end) return 0;
  const diff = Math.floor((end.getTime() - start.getTime()) / DAY) + 1;
  return diff > 0 ? diff : 0;
}

/** 档案的起算日：生日 / 到家日优先，否则用建档日 */
function anchorOf(pet) {
  if (!pet) return "";
  return pet.birthday || pet.createdAt || "";
}

/**
 * 陪伴天数的展示文案。三页（pets / me / memorials）共用，避免各写一份走散。
 *
 * 已离开但**没有固定截止日**时不给数字，只说「曾一起走过一段」：
 * 这种档案是存在的 —— 用户可以在编辑抽屉里直接把阶段改成「已离开」而不建纪念空间，
 * 此时 memorialSince 为空，daysSince 会一路算到今天。
 * 那样就会出现「陪伴了 4078 天」这种过去式配递增数字的组合，
 * 正是拍板要避免的冒犯。宁可不给数，也不要给一个每天在涨的数。
 */
function companionText(pet, days) {
  const memorial = pet && pet.lifeStage === "memorial";
  if (!memorial) return `陪伴第 ${days} 天`;
  if (!pet.memorialSince) return "曾一起走过一段";
  return `陪伴了 ${days} 天`;
}

/**
 * 自动里程碑的天数。与服务端 `domain/companion.ts` 的 `MILESTONE_DAYS` 必须一致。
 *
 * **不含「第 1 天」**：那是起点而不是成就，标出来反而稀释了另外三个。
 */
const MILESTONE_DAYS = [100, 365, 1000];

/**
 * 这一天是否是里程碑，是则给出文案。
 *
 * 是 `domain/companion.ts` 的 `milestoneLabel` 的端上对照实现 ——
 * 时间线里的里程碑标签由服务端下发，而首页的「今天刚达成」只有端上算得出
 * （服务端不知道用户什么时候打开小程序）。两处文案必须逐字一致，
 * 否则同一个第 365 天在时间线里叫「一起过了一年」、在首页叫「第 365 天」。
 */
function milestoneLabel(day) {
  if (MILESTONE_DAYS.indexOf(day) < 0) return "";
  return day === 365 ? "一起过了一年" : `第 ${day} 天`;
}

/**
 * 今天是否**刚好**达成某个里程碑（E3：达成当天在首页出现一次）。
 *
 * 「当天」是硬要求：里程碑是一个瞬间而不是一种状态，常驻展示会让它变成
 * 又一个货架标签。已达成的历史里程碑在时间线页列出，那里才是回看的地方。
 *
 * **纪念阶段一律返回空**：天数已封口不再增长，不可能「今天刚达成」；
 * 且给已离开的宠物弹一句庆祝是冒犯。
 */
function milestoneToday(pet, days) {
  if (!pet || pet.lifeStage === "memorial") return "";
  return milestoneLabel(days);
}

module.exports = { daysSince, anchorOf, startOfLocalDay, companionText, MILESTONE_DAYS, milestoneLabel, milestoneToday };
