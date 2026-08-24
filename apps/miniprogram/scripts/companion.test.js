const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");

const companion = require("../services/companion");

/** 构造本地日期串，避免用字面量把跑测机器的时区写死进断言 */
function localDateString(offsetDays) {
  const now = new Date();
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + offsetDays);
  const pad = (number) => String(number).padStart(2, "0");
  return `${target.getFullYear()}-${pad(target.getMonth() + 1)}-${pad(target.getDate())}`;
}

/*
 * ------------------------------------------------------------------ *
 * 与服务端 `domain/companion.ts` 的一致性
 *
 * `services/companion.js` 是那份 TS 的端上对照实现（小程序 require 不了 TS），
 * 关系与 `island/scene/ambient.js` 对 `domain/island-weather.ts` 完全一样。
 * 那一对靠 `island-ambient.test.js` 读 TS 源文件比对来防漂移，**这一对原先只有
 * 一句「必须逐字一致」的注释** —— 而注释拦不住任何人。
 *
 * 漂移的表现是同一个第 365 天在小程序里叫「第 365 天」、在时间线/日记里叫
 * 「一起过了一年」，或者纪念册显示 742 天而小程序显示 743：**两个数字都说得通，
 * 用户无法判断哪个是对的，我们也无法解释。** 22 号文第 8 步的完成判据正是
 * 「与 companion.ts 天数逐日一致」，所以这件事该由门禁证明而不是靠自觉。
 * ------------------------------------------------------------------ *
 */

const TS_PATH = path.resolve(__dirname, "../../platform/src/domain/companion.ts");
const tsSource = fs.existsSync(TS_PATH) ? fs.readFileSync(TS_PATH, "utf8") : "";

test("TS 真源可读 —— 找不到就说明路径变了，下面的比对会全部空过", () => {
  assert.ok(tsSource.length > 0, `读不到 ${TS_PATH}`);
});

test("MILESTONE_DAYS 与 TS 逐个一致", () => {
  const match = tsSource.match(/MILESTONE_DAYS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "TS 里没抽到 MILESTONE_DAYS");
  const expected = match[1].split(",").map((part) => Number(part.trim())).filter((value) => isFinite(value));
  assert.deepEqual(companion.MILESTONE_DAYS, expected);
  // 顺带钉住「不含第 1 天」：那是起点不是成就（22 号文 4.2）
  assert.ok(expected.indexOf(1) < 0, "第 1 天不该进里程碑清单");
});

test("里程碑文案与 TS 逐字一致 —— 含 365 天的专属措辞", () => {
  /*
   * TS 的实现是 `day === 365 ? "一起过了一年" : \`第 ${day} 天\``。
   * 抽这两个模板而不是抽整个函数体：函数体的写法两边本就不同（TS 返回
   * undefined、JS 返回空串），能比的只有**用户看到的那串字**。
   */
  const special = tsSource.match(/day === (\d+) \? "([^"]+)"/);
  assert.ok(special, "TS 里没抽到 365 天的专属文案");
  const specialDay = Number(special[1]);
  assert.equal(companion.milestoneLabel(specialDay), special[2], `第 ${specialDay} 天的文案与 TS 不一致`);

  const generic = tsSource.match(/:\s*`([^`]*\$\{day\}[^`]*)`/);
  assert.ok(generic, "TS 里没抽到通用里程碑文案模板");
  for (const day of companion.MILESTONE_DAYS) {
    if (day === specialDay) continue;
    const expected = generic[1].replace("${day}", String(day));
    assert.equal(companion.milestoneLabel(day), expected, `第 ${day} 天的文案与 TS 不一致`);
  }
});

test("陪伴天数文案三个分支与 TS 逐字一致", () => {
  /*
   * 三句都要比：进行式、过去式、无截止日。**「曾一起走过一段」那句最容易漏** ——
   * 它只在「已离开但没建纪念空间」时出现，是个少见分支，而说错话的代价最高
   * （给已离开的宠物显示一个每天在涨的数字，正是拍板要避免的冒犯）。
   */
  const active = tsSource.match(/return `(陪伴第 \$\{days\} 天)`/);
  const past = tsSource.match(/return `(陪伴了 \$\{days\} 天)`/);
  const noAnchor = tsSource.match(/if \(!pet\.memorialSince\) return "([^"]+)"/);
  assert.ok(active && past && noAnchor, "TS 里没抽全三句陪伴天数文案");

  assert.equal(companion.companionText({ lifeStage: "active" }, 743), active[1].replace("${days}", "743"));
  assert.equal(
    companion.companionText({ lifeStage: "memorial", memorialSince: "2026-01-01" }, 742),
    past[1].replace("${days}", "742"),
  );
  assert.equal(companion.companionText({ lifeStage: "memorial" }, 742), noAnchor[1]);
});

test("起算日优先级与 TS 一致：生日 / 到家日优先于建档日", () => {
  // TS: `pet.birthday || pet.createdAt || ""`
  assert.ok(/pet\.birthday \|\| pet\.createdAt \|\| ""/.test(tsSource), "TS 的 anchorOf 优先级变了，端上要跟着改");
  assert.equal(companion.anchorOf({ birthday: "2020-01-01", createdAt: "2024-05-05" }), "2020-01-01");
  assert.equal(companion.anchorOf({ createdAt: "2024-05-05" }), "2024-05-05");
  assert.equal(companion.anchorOf({}), "");
});

test("含当天（当天为第 1 天）的算法与 TS 同式", () => {
  // TS: `Math.floor((end - start) / DAY_MS) + 1`，且 `diff > 0 ? diff : 0`
  assert.ok(/Math\.floor\(\(end\.getTime\(\) - start\.getTime\(\)\) \/ DAY_MS\) \+ 1/.test(tsSource), "TS 的天数公式变了");
  assert.ok(/diff > 0 \? diff : 0/.test(tsSource), "TS 的负数保护变了");
  // 端上同式：起算当天 = 1，次日 = 2，未来 = 0
  assert.equal(companion.daysSince(localDateString(0)), 1);
  assert.equal(companion.daysSince(localDateString(-1)), 2);
  assert.equal(companion.daysSince(localDateString(1)), 0);
});

test("起算当天算第 1 天", () => {
  assert.equal(companion.daysSince(localDateString(0)), 1);
});

test("按本地零点计数，不受 UTC 偏移影响", () => {
  // 直接 new Date("YYYY-MM-DD") 会按 UTC 零点解析，在东八区偏成本地 08:00，
  // 与今天零点相减后被 floor 抹掉，跨月末会整整差一天。
  assert.equal(companion.daysSince(localDateString(-9)), 10);
  assert.equal(companion.daysSince(localDateString(-177)), 178);
});

test("起算日在未来返回 0，不显示负数", () => {
  assert.equal(companion.daysSince(localDateString(3)), 0);
});

test("缺起算日返回 0", () => {
  assert.equal(companion.daysSince(""), 0);
  assert.equal(companion.daysSince(undefined), 0);
  assert.equal(companion.daysSince("不是日期"), 0);
});

test("传截止日后天数固定，不随今天递增", () => {
  // 已离开的宠物必须走这条路径：「陪伴了 N 天」不能每天继续往上涨
  const start = "2025-02-03";
  const until = "2025-07-31";
  const first = companion.daysSince(start, until);
  assert.equal(first, 179);
  // 同样的入参再算一次仍是同一个数（与「今天」无关）
  assert.equal(companion.daysSince(start, until), first);
});

test("ISO 时间戳按本地时区归日，不照抄字符串里的 UTC 日期", () => {
  const start = "2025-01-01";
  const instant = new Date(2025, 0, 10, 6, 0, 0); // 本地 1-10 06:00
  const days = companion.daysSince(start, instant.toISOString());
  assert.equal(days, 10);
});

test("陪伴中用进行式，带当前天数", () => {
  assert.equal(companion.companionText({ lifeStage: "active" }, 12), "陪伴第 12 天");
});

test("已离开且有截止日用过去式", () => {
  assert.equal(companion.companionText({ lifeStage: "memorial", memorialSince: "2025-07-31" }, 179), "陪伴了 179 天");
});

test("已离开但没有截止日时不给数字", () => {
  // 用户可以在编辑抽屉里直接把阶段改成「已离开」而不建纪念空间，此时 memorialSince 为空。
  // 若照常拼数字，daysSince 会一路算到今天 ——「陪伴了 N 天」每天继续涨，正是拍板要避免的。
  const text = companion.companionText({ lifeStage: "memorial" }, 4078);
  assert.equal(text, "曾一起走过一段");
  assert.ok(!/\d/.test(text), "不该出现任何数字");
});

test("anchorOf 优先生日，缺失退回建档日", () => {
  assert.equal(companion.anchorOf({ birthday: "2025-02-03", createdAt: "2025-06-01T00:00:00.000Z" }), "2025-02-03");
  assert.equal(companion.anchorOf({ createdAt: "2025-06-01T00:00:00.000Z" }), "2025-06-01T00:00:00.000Z");
  assert.equal(companion.anchorOf(null), "");
});

/*
 * 里程碑（E3）。文案必须与服务端 `domain/companion.ts` 的 milestoneLabel 逐字一致 ——
 * 时间线的标签由服务端下发，首页的「今天刚达成」只有端上算得出（服务端不知道
 * 用户什么时候打开小程序），两处不一致会让同一个第 365 天有两种叫法。
 */
test("里程碑只认 100 / 365 / 1000，不含第 1 天", () => {
  assert.deepEqual(companion.MILESTONE_DAYS, [100, 365, 1000]);
  // 第 1 天是起点而不是成就，标出来会稀释另外三个。
  assert.equal(companion.milestoneLabel(1), "");
  assert.equal(companion.milestoneLabel(99), "");
  assert.equal(companion.milestoneLabel(100), "第 100 天");
  assert.equal(companion.milestoneLabel(1000), "第 1000 天");
});

test("第 365 天有专属文案", () => {
  assert.equal(companion.milestoneLabel(365), "一起过了一年");
});

test("milestoneToday 只在当天命中", () => {
  assert.equal(companion.milestoneToday({ lifeStage: "active" }, 100), "第 100 天");
  assert.equal(companion.milestoneToday({ lifeStage: "active" }, 101), "");
});

test("纪念阶段不出现里程碑", () => {
  // 天数已封口不会增长，不可能「今天刚达成」；给已离开的宠物弹庆祝是冒犯。
  assert.equal(companion.milestoneToday({ lifeStage: "memorial", memorialSince: "2025-07-31" }, 365), "");
});
