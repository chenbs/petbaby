/**
 * HUD 底板对比度与里程碑筛选的测试（22 号文第 7 / 8 步）。
 *
 * 两件事只有测试能守住：
 *
 * - **底板上每一种字色都要达标，不只主文字色。** `validate.js` 的门禁 16 早先只算
 *   「主文字 @1.0 压在 0.82 底板」一种组合，而 `.wxss` 里实际用着四种 ——
 *   `--island-ink-soft`（@0.7）在夜+晴的树丛色上只有 4.23:1，带着不达标混过了门禁。
 *   这里独立复算一遍，且**故意不复用 validate.js 的实现**：两份算法互为对照，
 *   门禁自己算错时这边会不一致。
 *
 * - **里程碑只列已达成的**（4.2）。未达成的读作「还差 20 天」，是 4.1 #7 禁掉的催促，
 *   而那种回归在界面上只是多出两个灰色石碑，没人会当成 bug。
 */

const test = require("node:test");
const assert = require("node:assert");

const ambient = require("../island/scene/ambient");
const hudVars = require("../island/hud-vars");
const service = require("../island/service");

const PHASES = ["dawn", "day", "dusk", "night"];
const WEATHERS = ["clear", "cloudy", "rain", "snow"];

/** WCAG 相对亮度。与 TS 侧 `relativeLuminance` 同式 */
function luminance(color) {
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(first, second) {
  const bright = Math.max(luminance(first), luminance(second));
  const dark = Math.min(luminance(first), luminance(second));
  return (bright + 0.05) / (dark + 0.05);
}

/** `rgba(r,g,b,a)` 或 `#RRGGBB` → { r, g, b, a } */
function readColor(value) {
  const rgba = String(value).match(/^rgba?\(([^)]+)\)$/);
  if (rgba) {
    const parts = rgba[1].split(",").map((part) => parseFloat(part.trim()));
    return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 ? parts[3] : 1 };
  }
  const rgb = ambient.parseHex(value);
  return { r: rgb.r, g: rgb.g, b: rgb.b, a: 1 };
}

/** 某个昼夜×天气组合的叠加层，顺序**先昼夜再天气**（alpha 不满足交换律，见 11.2） */
function overlaysOf(phase, weather) {
  const overlays = [];
  const phaseLayer = ambient.PHASE_OVERLAYS[phase];
  if (phaseLayer) overlays.push(phaseLayer);
  const weatherLayer = ambient.WEATHER_OVERLAYS[weather];
  if (weatherLayer) overlays.push(weatherLayer);
  return overlays;
}

/**
 * 遍历「全部字色×底板 × 16 组合 × 全部地表」，返回最差的一项。
 *
 * `plateAlpha` / `textAlpha` 取自 `ISLAND_TEXT_ON_PLATE` —— 门禁与实现读同一张表，
 * 所以这里也读它，不另抄一份组合清单。
 */
function worstHudContrast() {
  let worst = { ratio: Infinity, where: "" };
  for (const pair of hudVars.ISLAND_TEXT_ON_PLATE) {
    const plateColor = readColor(hudVars.ISLAND_VARS[pair.plate]);
    const inkColor = readColor(hudVars.ISLAND_VARS[pair.text]);
    for (const phase of PHASES) {
      for (const weather of WEATHERS) {
        const overlays = overlaysOf(phase, weather);
        for (const key of Object.keys(ambient.ISLAND_PALETTE)) {
          let scene = ambient.parseHex(ambient.ISLAND_PALETTE[key]);
          for (const layer of overlays) scene = ambient.alphaOver(ambient.parseHex(layer.color), scene, layer.opacity);
          // 底板压场景，再把（可能半透明的）文字压在底板上
          const plate = ambient.alphaOver(plateColor, scene, pair.plateAlpha);
          const ink = ambient.alphaOver(inkColor, plate, pair.textAlpha);
          const ratio = contrast(ink, plate);
          if (ratio < worst.ratio) {
            worst = { ratio: ratio, where: `${pair.text} on ${pair.plate} / ${phase}+${weather} / ${key}` };
          }
        }
      }
    }
  }
  return worst;
}

/* ------------------------------------------------------------------ *
 * 门禁 16：底板合成后的对比度
 * ------------------------------------------------------------------ */

test("16 种昼夜×天气下，每一种字色×底板组合都达 4.5:1", () => {
  const worst = worstHudContrast();
  assert.ok(worst.ratio >= 4.5, `最差组合 ${worst.where} = ${worst.ratio.toFixed(2)}:1，要求 ≥ 4.5:1`);
});

test("次级文字的不透明度是可读性下限决定的，不能随手往下调", () => {
  /*
   * 0.7 曾是实际取值且不达标（夜+晴 / 树丛色 4.23:1）。这条用例钉住「再调回去会失败」——
   * 不是钉住 0.75 这个数字本身：更高的值随时可以，低到不达标不行。
   */
  assert.ok(hudVars.INK_SOFT_ALPHA >= 0.75, `INK_SOFT_ALPHA = ${hudVars.INK_SOFT_ALPHA}，低于 0.75 会让夜档的次级文字掉到 4.5:1 以下`);
});

test("底板存在且真的是半透明的 —— 不透明底板会把场景切成两半", () => {
  for (const key of Object.keys(hudVars.PLATE_ALPHA)) {
    const alpha = hudVars.PLATE_ALPHA[key];
    assert.ok(alpha > 0 && alpha < 1, `${key} 档底板不透明度 ${alpha} 不在 (0,1) 内，那就不再是「底板压场景」`);
  }
});

test("组合表覆盖全部注入变量 —— 新增字色不能绕过门禁 16", () => {
  assert.deepStrictEqual(hudVars.uncoveredVars(), [], "有注入变量没登记进 ISLAND_TEXT_ON_PLATE，它的对比度从来没被算过");
});

test("组合表引用的变量都真的存在 —— 写错名字会让那一项静默跳过", () => {
  for (const pair of hudVars.ISLAND_TEXT_ON_PLATE) {
    assert.ok(hudVars.ISLAND_VARS[pair.text], `组合表引用了不存在的字色 ${pair.text}`);
    assert.ok(hudVars.ISLAND_VARS[pair.plate], `组合表引用了不存在的底板 ${pair.plate}`);
  }
});

test("注入串含底板与文字色，且以分号收尾（拼进 style 属性时不粘住下一条）", () => {
  const style = hudVars.getIslandStyle();
  assert.ok(style.indexOf("--island-plate:") >= 0, "注入串里没有底板");
  assert.ok(style.indexOf("--island-ink:") >= 0, "注入串里没有文字色");
  assert.ok(/;$/.test(style), "注入串没有以分号收尾");
});

/* ------------------------------------------------------------------ *
 * 里程碑（第 8 步）
 * ------------------------------------------------------------------ */

/** `services/companion.js` 的 milestoneLabel 替身，避免为一个纯函数拉进整个模块 */
function label(day) {
  if ([100, 365, 1000].indexOf(day) < 0) return "";
  return day === 365 ? "一起过了一年" : `第 ${day} 天`;
}

test("只列已达成的里程碑 —— 未达成的是「还差 20 天」，属 4.1 #7 的催促", () => {
  const snapshot = { milestones: [{ day: 100, reached: true }, { day: 365, reached: false }, { day: 1000, reached: false }] };
  const entries = service.reachedMilestones(snapshot, label);
  assert.deepStrictEqual(entries, [{ day: 100, label: "第 100 天" }]);
});

test("一周年的措辞是「一起过了一年」而不是「第 365 天」—— 与服务端逐字一致", () => {
  const snapshot = { milestones: [{ day: 365, reached: true }] };
  assert.strictEqual(service.reachedMilestones(snapshot, label)[0].label, "一起过了一年");
});

test("不含第 1 天 —— 那是起点而不是成就（4.2）", () => {
  const snapshot = { milestones: [{ day: 1, reached: true }, { day: 100, reached: true }] };
  const days = service.reachedMilestones(snapshot, label).map((entry) => entry.day);
  assert.deepStrictEqual(days, [100], "第 1 天不该出现在里程碑里");
});

test("清单缺失或为空时给空数组，不抛异常 —— 老岛没有这个字段", () => {
  assert.deepStrictEqual(service.reachedMilestones(null, label), []);
  assert.deepStrictEqual(service.reachedMilestones({}, label), []);
  assert.deepStrictEqual(service.reachedMilestones({ milestones: [] }, label), []);
  // 数组里混进 null 也不能崩（服务端字段形状变化时的兜底）
  assert.deepStrictEqual(service.reachedMilestones({ milestones: [null, { day: 100, reached: true }] }, label), [{ day: 100, label: "第 100 天" }]);
});

test("天数不在清单里时不显示 —— 两端 MILESTONE_DAYS 漂移了，宁可不给也不猜文案", () => {
  const snapshot = { milestones: [{ day: 742, reached: true }] };
  assert.deepStrictEqual(service.reachedMilestones(snapshot, label), []);
});

test("三档全达成时按服务端顺序给出，不重排", () => {
  const snapshot = { milestones: [{ day: 100, reached: true }, { day: 365, reached: true }, { day: 1000, reached: true }] };
  const days = service.reachedMilestones(snapshot, label).map((entry) => entry.day);
  assert.deepStrictEqual(days, [100, 365, 1000]);
});
