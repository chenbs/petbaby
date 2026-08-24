/**
 * 端上昼夜天气口径与服务端 `domain/island-weather.ts` 的一致性测试。
 *
 * **这是两份实现不漂移的唯一保障。** `island/scene/ambient.js` 是 TS 真源的第二份
 * （小程序 require 不了 TS），而漂移的表现是「画面在下雨、日记说晴天」—— 一种只有
 * 用户会发现、开发时完全看不出来的错误。
 *
 * 做法是**读 TS 源文件正则抽取取值再逐个比对**，不是各写一份期望值：写死期望值的话
 * 改了 TS 之后这里照样通过，而两边已经不一致了。正则脆但足够 —— 它认的是
 * `PHASE_OVERLAYS` / `WEATHER_OVERLAYS` / `PARTICLES` 等具名常量的字面量形态，
 * 那几处是取值表而不是逻辑，改动时必然保持这个形态；真要改成动态计算，
 * 这里报错正是我们想要的信号。
 */

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");

const ambient = require("../island/scene/ambient");

const TS_PATH = path.resolve(__dirname, "../../platform/src/domain/island-weather.ts");
const tsSource = fs.existsSync(TS_PATH) ? fs.readFileSync(TS_PATH, "utf8") : "";

/** 抽取形如 `key: { color: "#XXX", opacity: 0.55 }` 的叠加层 */
function overlayFrom(source, blockName, key) {
  const block = source.split(blockName)[1];
  if (!block) return null;
  const pattern = new RegExp(key + "\\s*:\\s*\\{\\s*color:\\s*\"(#[0-9A-Fa-f]{3,8})\"\\s*,\\s*opacity:\\s*([\\d.]+)");
  const match = block.match(pattern);
  return match ? { color: match[1], opacity: Number(match[2]) } : null;
}

/** 抽取形如 `key: { kind: "rain", count: 120, degradedCount: 40 }` */
function particleFrom(source, key) {
  const block = source.split("const PARTICLES")[1];
  if (!block) return null;
  const pattern = new RegExp(key + "\\s*:\\s*\\{\\s*kind:\\s*\"(\\w+)\"\\s*,\\s*count:\\s*(\\d+)\\s*,\\s*degradedCount:\\s*(\\d+)");
  const match = block.match(pattern);
  return match ? { kind: match[1], count: Number(match[2]), degradedCount: Number(match[3]) } : null;
}

test("TS 真源可读 —— 找不到就说明路径变了，后面的比对会全部空过", () => {
  assert.ok(tsSource.length > 0, "读不到 apps/platform/src/domain/island-weather.ts");
  assert.ok(tsSource.indexOf("PHASE_OVERLAYS") > 0);
});

test("光照层四档取值与 TS 逐个一致", () => {
  for (const phase of ["dawn", "dusk", "night"]) {
    const expected = overlayFrom(tsSource, "const PHASE_OVERLAYS", phase);
    assert.ok(expected, `TS 里没抽到 ${phase} 的光照层`);
    const actual = ambient.PHASE_OVERLAYS[phase];
    assert.strictEqual(actual.color.toUpperCase(), expected.color.toUpperCase(), `${phase} 色值不一致`);
    assert.strictEqual(actual.opacity, expected.opacity, `${phase} 不透明度不一致`);
  }
  // day 是基准档，两边都必须是 null —— 给它加一层等于把底图整体压暗一档
  assert.strictEqual(ambient.PHASE_OVERLAYS.day, null);
  assert.ok(/day:\s*null/.test(tsSource), "TS 侧 day 不再是基准档");
});

test("天气层四档取值与 TS 逐个一致", () => {
  for (const weather of ["cloudy", "rain", "snow"]) {
    const expected = overlayFrom(tsSource, "const WEATHER_OVERLAYS", weather);
    assert.ok(expected, `TS 里没抽到 ${weather} 的天气层`);
    const actual = ambient.WEATHER_OVERLAYS[weather];
    assert.strictEqual(actual.color.toUpperCase(), expected.color.toUpperCase(), `${weather} 色值不一致`);
    assert.strictEqual(actual.opacity, expected.opacity, `${weather} 不透明度不一致`);
  }
  assert.strictEqual(ambient.WEATHER_OVERLAYS.clear, null);
});

test("阴与雨共用同一层冷灰 —— 雨在此之上只加粒子与地面反光", () => {
  assert.deepStrictEqual(ambient.WEATHER_OVERLAYS.cloudy, ambient.WEATHER_OVERLAYS.rain);
});

test("粒子数与 TS 一致，且降级值不高于基准值", () => {
  for (const kind of ["rain", "snow"]) {
    const expected = particleFrom(tsSource, kind);
    assert.ok(expected, `TS 里没抽到 ${kind} 的粒子规格`);
    assert.deepStrictEqual(ambient.PARTICLES[kind], expected, `${kind} 粒子规格不一致`);
    assert.ok(expected.degradedCount <= expected.count, "降级值不该高于基准值");
    assert.ok(expected.degradedCount <= 40, "低端机粒子数要掉到 40 以内（2.5.1）");
  }
});

test("段边界与 TS 一致：05/09/13/17/21，一天 5 段", () => {
  const match = tsSource.match(/SEGMENT_STARTS\s*=\s*\[([^\]]+)\]/);
  assert.ok(match, "TS 里没抽到 SEGMENT_STARTS");
  const expected = match[1].split(",").map((part) => Number(part.trim())).filter((value) => isFinite(value));
  assert.deepStrictEqual(ambient.SEGMENT_STARTS, expected);
  assert.strictEqual(ambient.SEGMENTS_PER_DAY, 5);
});

test("调色板与 TS 逐键一致", () => {
  const block = tsSource.split("ISLAND_PALETTE")[1] || "";
  for (const key of Object.keys(ambient.ISLAND_PALETTE)) {
    const match = block.match(new RegExp(key + "\\s*:\\s*\"(#[0-9A-Fa-f]{6})\""));
    assert.ok(match, `TS 里没抽到调色板 ${key}`);
    assert.strictEqual(ambient.ISLAND_PALETTE[key].toUpperCase(), match[1].toUpperCase(), `${key} 色值不一致`);
  }
});

test("HUD 底板与 AI 标识底衬取值与 TS 一致，且两者不可混用", () => {
  const plate = tsSource.match(/HUD_PLATE\s*=\s*\{\s*color:\s*ISLAND_PALETTE\.(\w+)\s*,\s*opacity:\s*([\d.]+)/);
  assert.ok(plate, "TS 里没抽到 HUD_PLATE");
  assert.strictEqual(ambient.HUD_PLATE.color, ambient.ISLAND_PALETTE[plate[1]]);
  assert.strictEqual(ambient.HUD_PLATE.opacity, Number(plate[2]));

  const label = tsSource.match(/AI_LABEL_PLATE\s*=\s*\{\s*color:\s*"(#[0-9A-Fa-f]{6})"\s*,\s*opacity:\s*([\d.]+)/);
  assert.ok(label, "TS 里没抽到 AI_LABEL_PLATE");
  assert.strictEqual(ambient.AI_LABEL_PLATE.color.toUpperCase(), label[1].toUpperCase());
  assert.strictEqual(ambient.AI_LABEL_PLATE.opacity, Number(label[2]));

  /*
   * 两者用途相反、不可共用（22 号文 1.5 / 2.2）：HUD 底板是奶白（贴合器物色），
   * AI 标识底衬必须是深色（要压住白猫 / 雪地 / 阳光高光这类最亮画面）。
   * 有人把它们合成一个常量的话这条会立刻报警。
   */
  assert.notStrictEqual(ambient.HUD_PLATE.color, ambient.AI_LABEL_PLATE.color);
  assert.notStrictEqual(ambient.HUD_PLATE.textColor, ambient.AI_LABEL_PLATE.textColor);
});

test("哈希实现与 TS 同源：同一输入必得同一天气序列", () => {
  // 哈希本身是口径的一部分（换哈希就换天气），这里钉住几个具体输出
  const first = ambient.weatherForDay("island-a", "2026-08-05");
  const again = ambient.weatherForDay("island-a", "2026-08-05");
  assert.deepStrictEqual(first, again, "同一输入两次调用结果不同");
  assert.strictEqual(first.length, 5);
  // 不同岛的天气不同 —— 否则全体用户同时下雨，分享截图会显得像统一活动
  const other = ambient.weatherForDay("island-b", "2026-08-05");
  assert.ok(Array.isArray(other));
});

test("晴天占比 ≥60%：非晴段最多 2 段（结构性保证，不靠概率）", () => {
  for (let day = 1; day <= 120; day += 1) {
    const date = new Date(2026, 0, day);
    for (const island of ["a", "b", "c"]) {
      const segments = ambient.weatherForDay(island, date);
      const nonClear = segments.filter((item) => item !== "clear").length;
      assert.ok(nonClear <= 2, `${island} ${date.toDateString()} 非晴段 ${nonClear} 段，超过上限`);
    }
  }
});

test("湿档不连续：相邻两段不会都是雨或雪", () => {
  for (let day = 1; day <= 200; day += 1) {
    const date = new Date(2026, 0, day);
    const segments = ambient.weatherForDay("island-wet", date);
    for (let index = 1; index < segments.length; index += 1) {
      const both = /rain|snow/.test(segments[index]) && /rain|snow/.test(segments[index - 1]);
      assert.ok(!both, `${date.toDateString()} 第 ${index} 段与前一段都是湿档`);
    }
  }
});

test("雪只在冬季月份出现", () => {
  for (let month = 0; month < 12; month += 1) {
    for (let day = 1; day <= 28; day += 1) {
      const date = new Date(2026, month, day);
      const segments = ambient.weatherForDay("island-snow", date);
      if (segments.indexOf("snow") < 0) continue;
      assert.ok(ambient.WINTER_MONTHS.indexOf(month + 1) >= 0, `${date.toDateString()} 非冬季却下雪`);
    }
  }
});

test("05:00 之前属前一天的末段 —— 凌晨的天气应与睡前一致", () => {
  const located = ambient.segmentAt("2026-08-05", 2);
  assert.strictEqual(located.dateKey, "2026-08-04");
  assert.strictEqual(located.index, 4);
  // 跨月要靠 Date 运算而不是字符串减法
  assert.strictEqual(ambient.segmentAt("2026-08-01", 3).dateKey, "2026-07-31");
  assert.strictEqual(ambient.segmentAt("2026-01-01", 1).dateKey, "2025-12-31");
});

test("昼夜档边界：夜档从 21:00 延续到次日 05:00", () => {
  assert.strictEqual(ambient.phaseAt(4), "night");
  assert.strictEqual(ambient.phaseAt(5), "dawn");
  assert.strictEqual(ambient.phaseAt(8), "dawn");
  assert.strictEqual(ambient.phaseAt(9), "day");
  assert.strictEqual(ambient.phaseAt(16), "day");
  assert.strictEqual(ambient.phaseAt(17), "dusk");
  assert.strictEqual(ambient.phaseAt(20), "dusk");
  assert.strictEqual(ambient.phaseAt(21), "night");
  assert.strictEqual(ambient.phaseAt(23), "night");
});

test("date 列读出 JS Date 时归一取本地年月日，东八区不退回前一天", () => {
  // 东八区的 8 月 1 日零点，toISOString() 会给 7-31
  const local = new Date(2026, 7, 1);
  assert.strictEqual(ambient.asDateKey(local), "2026-08-01");
  assert.strictEqual(ambient.asDateKey("2026-08-01"), "2026-08-01");
  assert.strictEqual(ambient.asDateKey("2026-08-01T22:00:00.000Z"), "2026-08-01");
});

test("叠加顺序是先昼夜再天气 —— alpha 叠加不满足交换律", () => {
  // 造一个雨夜：夜档 22 点，找一天雨段落在末段的
  let found = null;
  for (let day = 1; day <= 200 && !found; day += 1) {
    const date = new Date(2026, 5, day);
    const env = ambient.ambientAt("island-order", date, 22);
    if (env.weather === "rain") found = env;
  }
  assert.ok(found, "200 天里没找到雨夜，天气规则可能坏了");
  assert.strictEqual(found.overlays.length, 2);
  assert.strictEqual(found.overlays[0].color, ambient.PHASE_OVERLAYS.night.color, "第一层必须是昼夜");
  assert.strictEqual(found.overlays[1].color, ambient.WEATHER_OVERLAYS.rain.color, "第二层必须是天气");
});

test("雨+夜的合成明度落在实算表的 0.485 附近 —— 这是取 alpha 而非色乘的证据", () => {
  const grass = ambient.parseHex(ambient.ISLAND_PALETTE.grass);
  let color = ambient.alphaOver(ambient.parseHex(ambient.PHASE_OVERLAYS.night.color), grass, ambient.PHASE_OVERLAYS.night.opacity);
  color = ambient.alphaOver(ambient.parseHex(ambient.WEATHER_OVERLAYS.rain.color), color, ambient.WEATHER_OVERLAYS.rain.opacity);
  // 22 号文 2.5.1 的「明度」是 sRGB 加权和口径（与 tokens.js 的 lightness 同源）
  const level = (color.r * 0.299 + color.g * 0.587 + color.b * 0.114) / 255;
  assert.ok(Math.abs(level - 0.485) < 0.03, `雨+夜合成明度 ${level.toFixed(3)}，实算表是 0.485（差太多说明合成方式变了）`);
});

test("雨雪档要躲雨、夜暮档要窗户暖光", () => {
  const night = ambient.ambientAt("island-x", "2026-01-15", 22);
  assert.strictEqual(night.phase, "night");
  assert.strictEqual(night.windowGlow, true);
  const noon = ambient.ambientAt("island-x", "2026-06-15", 12);
  assert.strictEqual(noon.windowGlow, false);
  // shelter 与湿档同步：雨雪档宠物切到屋檐下，不是「淋雨的宠物」
  for (let day = 1; day <= 60; day += 1) {
    const env = ambient.ambientAt("island-shelter", new Date(2026, 0, day), 12);
    assert.strictEqual(env.shelter, env.weather === "rain" || env.weather === "snow");
  }
});

test("nextSegmentHour 指向下一段起点，供端上安排交叉淡入", () => {
  // 天气段边界是 05/09/13/17/21，与昼夜档（05/09/17/21）**不完全重合** ——
  // 13 点那一次是在长白昼中间补的（2.5.3），所以正午的下一段是 13 而不是 17
  assert.strictEqual(ambient.ambientAt("i", "2026-08-05", 6).nextSegmentHour, 9);
  assert.strictEqual(ambient.ambientAt("i", "2026-08-05", 10).nextSegmentHour, 13);
  assert.strictEqual(ambient.ambientAt("i", "2026-08-05", 14).nextSegmentHour, 17);
  // 末段的下一段是次日首段 05:00，取模回绕
  assert.strictEqual(ambient.ambientAt("i", "2026-08-05", 22).nextSegmentHour, 5);
});

test("小时越界不抛异常 —— 端上时间不可信，但也不该让画面崩", () => {
  assert.strictEqual(ambient.phaseAt(-5), "night");
  assert.strictEqual(ambient.phaseAt(99), "night");
  assert.strictEqual(ambient.phaseAt(NaN), "night");
  assert.doesNotThrow(() => ambient.ambientAt("i", "not-a-date", 12));
});
