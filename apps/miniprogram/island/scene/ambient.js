/**
 * 昼夜与天气口径的**端上对照实现**。
 *
 * 真源是 `apps/platform/src/domain/island-weather.ts`（22 号文 5.4 把它放进 `domain/`
 * 正是因为「端上也要用同一口径算光照」）。但那是 TypeScript，小程序侧 require 不了，
 * 所以这里是同一算法的第二份 —— 与 `services/companion.js` 对 `domain/companion.ts`
 * 的关系完全一样，也与 `island-weather.ts` 自己没复用 `asDateString` 的理由同源
 * （11.4：从 domain 反向 import server 会把整条服务端依赖链拖进来）。
 *
 * **两份漂移的表现是「画面在下雨、日记说晴天」**，所以取值一致性不靠自觉：
 * `scripts/island-ambient.test.js` 会读 TS 源文件把每一个色值、不透明度、粒子数、
 * 段边界逐个比对回来，改了一边不改另一边 `pnpm validate` 直接失败。
 *
 * **叠加方式是普通 alpha（Canvas 默认 `source-over`），不是色乘。** 22 号文 2.5 与
 * 24 号文第 4 章的措辞是「色乘」，但 2.5.1 的实算表只在 alpha 下成立（见 11.2），
 * 实现取表。端上照本文件取值直接 `fillRect` 即可，不要自己再按色乘实现一遍。
 */

/** 一天 5 段的起始小时。与昼夜边界对齐，见 TS 侧注释 */
const SEGMENT_STARTS = [5, 9, 13, 17, 21];

const SEGMENTS_PER_DAY = SEGMENT_STARTS.length;

/** 昼夜档起始小时。前四个与 SEGMENT_STARTS 重合 */
const PHASE_STARTS = [
  { hour: 5, phase: "dawn" },
  { hour: 9, phase: "day" },
  { hour: 17, phase: "dusk" },
  { hour: 21, phase: "night" }
];

/** 光照层。`day` 是基准档，不叠任何东西 —— 底图本身就是晴天白昼 */
const PHASE_OVERLAYS = {
  dawn: { color: "#F2D9A8", opacity: 0.22 },
  day: null,
  dusk: { color: "#E8905A", opacity: 0.32 },
  night: { color: "#3D4470", opacity: 0.55 }
};

/** 天气层。阴与雨共用同一层冷灰，雨在此之上再加粒子与地面反光 */
const WEATHER_OVERLAYS = {
  clear: null,
  cloudy: { color: "#8C93A0", opacity: 0.3 },
  rain: { color: "#8C93A0", opacity: 0.3 },
  snow: { color: "#E8EAF2", opacity: 0.35 }
};

/**
 * 粒子规格。`count` 是基准机型（骁龙 6xx 级）目标值，`degradedCount` 是降级值。
 * **天气是唯一持续跑帧的图层**，「静止即停帧」在天气档下不成立。
 */
const PARTICLES = {
  rain: { kind: "rain", count: 120, degradedCount: 40 },
  snow: { kind: "snow", count: 80, degradedCount: 40 }
};

/**
 * 32 位整数哈希（FNV-1a 变体）。
 *
 * **这个实现本身是口径的一部分**，不能换成别的哈希：端上与服务端必须算出同一个天气。
 * TS 侧的注释写明了同一件事（那边不用 node crypto 也是为了能在小程序跑）。
 */
function hash32(text) {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    value = (value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
  }
  return value >>> 0;
}

function unitAt(seed, index) {
  return hash32(seed + ":" + index) / 0x100000000;
}

/**
 * 日期归一到 `YYYY-MM-DD`。
 *
 * Date 分支取**本地**年月日而不是 `toISOString()` —— 日历日无时区，
 * 转 UTC 会在东八区退回前一天。健康线已经踩过一次（CLAUDE.md）。
 */
function asDateKey(value) {
  if (value instanceof Date) {
    return value.getFullYear() + "-" + String(value.getMonth() + 1).padStart(2, "0") + "-" + String(value.getDate()).padStart(2, "0");
  }
  const text = String(value === null || value === undefined ? "" : value);
  if (text.indexOf("T") > 0) return text.slice(0, 10);
  const parts = text.split(/[^0-9]/).filter(Boolean);
  if (parts.length >= 3) {
    return parts[0].padStart(4, "0") + "-" + parts[1].padStart(2, "0") + "-" + parts[2].padStart(2, "0");
  }
  return text.slice(0, 10);
}

/** 冬季月份。北半球口径，与用户所在地无关 —— 天气本就不取真实位置 */
const WINTER_MONTHS = [12, 1, 2];

/** 一天里雨 + 雪合计的段数上限。连续两段雨读作「今天一直在下雨」，正是要避免的 */
const MAX_WET_SEGMENTS = 2;

/** 晴天占比下限，按段计不按天计 */
const MIN_CLEAR_RATIO = 0.6;

const MIN_CLEAR_SEGMENTS = Math.ceil(SEGMENTS_PER_DAY * MIN_CLEAR_RATIO);
const MAX_NON_CLEAR_SEGMENTS = SEGMENTS_PER_DAY - MIN_CLEAR_SEGMENTS;

function isWet(weather) {
  return weather === "rain" || weather === "snow";
}

/**
 * 一整天 5 段的天气序列。
 *
 * **按天返回 5 段而不是按时刻返回一档**：「晴天占比 ≥60%」与「雨雪 ≤2 段且不连续」
 * 都是跨段性质，逐段独立随机时无从施加。
 */
function weatherForDay(islandId, date) {
  const dateKey = asDateKey(date);
  const seed = hash32(islandId + "|" + dateKey);
  const month = Number(dateKey.slice(5, 7));
  const snowAllowed = WINTER_MONTHS.indexOf(month) >= 0;

  const segments = new Array(SEGMENTS_PER_DAY).fill("clear");

  const draw = unitAt(seed, 0);
  const nonClearCount = draw < 0.45 ? 0 : draw < 0.8 ? 1 : MAX_NON_CLEAR_SEGMENTS;
  if (!nonClearCount) return segments;
  let wetBudget = MAX_WET_SEGMENTS;

  const picked = segments
    .map((_, index) => ({ index: index, score: unitAt(seed, 10 + index) }))
    .sort((left, right) => left.score - right.score)
    .slice(0, nonClearCount)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);

  for (const index of picked) {
    const roll = unitAt(seed, 30 + index);
    if (roll < 0.5 || wetBudget <= 0) segments[index] = "cloudy";
    else if (roll < 0.85 || !snowAllowed) { segments[index] = "rain"; wetBudget -= 1; }
    else { segments[index] = "snow"; wetBudget -= 1; }
  }

  // 湿档不连续：降级为阴而不是改晴 —— 「雨转阴」自然，「雨转大晴」在同一天里突兀
  for (let index = 1; index < segments.length; index += 1) {
    if (isWet(segments[index]) && isWet(segments[index - 1])) segments[index] = "cloudy";
  }
  return segments;
}

/**
 * 某小时落在当天第几段，以及归属哪一天。
 * **05:00 之前属前一天的末段** —— 凌晨两点的天气应与睡前一致，不能零点换日凭空变一次。
 */
function segmentAt(date, hour) {
  const safeHour = isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 0;
  const dateKey = asDateKey(date);
  if (safeHour < SEGMENT_STARTS[0]) {
    // 经 Date 运算退到前一天，跨月跨年才不会算错
    const parts = dateKey.split("-").map(Number);
    const previous = new Date(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) - 1);
    return { dateKey: asDateKey(previous), index: SEGMENTS_PER_DAY - 1 };
  }
  let index = 0;
  for (let position = 0; position < SEGMENT_STARTS.length; position += 1) {
    if (safeHour >= SEGMENT_STARTS[position]) index = position;
  }
  return { dateKey: dateKey, index: index };
}

function weatherAt(islandId, date, hour) {
  const located = segmentAt(date, hour);
  return weatherForDay(islandId, located.dateKey)[located.index];
}

/**
 * 某小时属于哪一档昼夜。
 *
 * 昼夜**可以用端上时间**（纯表现，用户改系统时间只是看到不同光照，无收益），
 * 而额度与亲密度必须用服务端时间（22 号文 5.6）—— 这条边界不能混。
 */
function phaseAt(hour) {
  const safeHour = isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 0;
  if (safeHour < PHASE_STARTS[0].hour) return "night";
  let phase = "dawn";
  for (const entry of PHASE_STARTS) {
    if (safeHour >= entry.hour) phase = entry.phase;
  }
  return phase;
}

/**
 * 岛屿调色板（22 号文 2.2 实算值，对标《猫咪和汤》）。
 *
 * 这套色是**内容属性不是 UI 主题**：换 UI 主题不改变岛的外观，与 `theme/scene-presets.js`
 * 同一处理。Canvas 内像素不受 token 约束（22 号文 5.1），所以这里直接给 hex；
 * 只有 HUD 那几个要进 `.wxss` 的才经 `palette.js` 转成 CSS 变量。
 */
const ISLAND_PALETTE = {
  grass: "#9DB37A",
  grassShadow: "#8AA268",
  /** 树丛深色。与深色文字只有 2.78:1 —— 这正是 HUD 必须有底板的直接原因 */
  canopy: "#5F7A4E",
  cream: "#F7F0DE",
  path: "#C9B893",
  sky: "#CFE0E8",
  water: "#A8C4C9"
};

/** 岛内文字色。与小程序的 cocoa900 同值，不新开一套 */
const ISLAND_TEXT_COLOR = "#3A2C2C";

/**
 * HUD 顶部一行的底板。
 *
 * **底板不是可选项**：16 种昼夜×天气组合下没有任何单一字色能全域达标 ——
 * 最暗的「雨+夜」把画面推到中间明度 0.485，深色字 3.23:1、白字 4.13:1 双双不达标。
 * 底板把文字与场景明度解耦，对比度因此恒定。`scripts/validate.js` 的门禁 16 钉住它的存在。
 */
const HUD_PLATE = { color: ISLAND_PALETTE.cream, opacity: 0.82, textColor: ISLAND_TEXT_COLOR };

/**
 * AI 标识的深色底衬。最坏画面是**纯白**（阳光高光 / 白猫 / 雪地），不是任一地表色。
 * 与 HUD 底板用途不同、不可共用 —— 后者是奶白，压不住高亮画面。
 */
const AI_LABEL_PLATE = { color: "#2A1F1F", opacity: 0.65, textColor: "#FFFFFF" };

/**
 * 夜档与暮档的窗户暖光。**「家」的核心意象**（22 号文 2.5），径向渐变代码绘制 ——
 * 画成图会与底图窗户位置强耦合，改底图就得重画（24 号文第 4 章）。
 */
const WINDOW_GLOW = { color: "#FFD9A0", opacity: 0.55 };

function parseHex(value) {
  let digits = String(value).replace("#", "");
  if (digits.length === 3) digits = digits.split("").map((char) => char + char).join("");
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16)
  };
}

/** 普通 alpha 叠加。与 TS 侧 `alphaOver` 及 validate.js 的 composite 同一套口径 */
function alphaOver(foreground, background, opacity) {
  return {
    r: foreground.r * opacity + background.r * (1 - opacity),
    g: foreground.g * opacity + background.g * (1 - opacity),
    b: foreground.b * opacity + background.b * (1 - opacity)
  };
}

function toRgba(color, alpha) {
  const rgb = parseHex(color);
  return "rgba(" + Math.round(rgb.r) + "," + Math.round(rgb.g) + "," + Math.round(rgb.b) + "," + alpha + ")";
}

/**
 * 某时刻的完整环境。**这是端上唯一需要调的入口** —— 档位判断不外泄给调用方，
 * 免得渲染层自己再判一次「现在是不是夜里」而与这里走散。
 */
function ambientAt(islandId, date, hour) {
  const phase = phaseAt(hour);
  const weather = weatherAt(islandId, date, hour);
  const overlays = [];
  /*
   * 顺序固定：**先昼夜、再天气**。alpha 叠加不满足交换律，而 2.5.1 的实算表
   * 是按这个顺序算的（雨+夜 = 0.485；反过来叠得 0.435，与表不符）。
   * 观感上也对：雨是当下的天气，落在已经暗下来的世界之上。
   */
  const phaseLayer = PHASE_OVERLAYS[phase];
  if (phaseLayer) overlays.push(phaseLayer);
  const weatherLayer = WEATHER_OVERLAYS[weather];
  if (weatherLayer) overlays.push(weatherLayer);

  const located = segmentAt(date, hour);
  return {
    phase: phase,
    weather: weather,
    overlays: overlays,
    particles: PARTICLES[weather] || null,
    windowGlow: phase === "night" || phase === "dusk",
    /*
     * 雨档的正确实现不是「淋雨的宠物」而是「一起躲雨」（2.5.2）：
     * 窗外下雨、屋内暖光是治愈感最强的画面之一。纯坐标切换，不需要额外素材，
     * 但底图必须画出那片屋檐（24 号文 7.2 已把这句加进底图提示词）。
     */
    shelter: weather === "rain" || weather === "snow",
    nextSegmentHour: SEGMENT_STARTS[(located.index + 1) % SEGMENTS_PER_DAY]
  };
}

/** 当前时刻的环境。端上取本机时间 —— 昼夜是纯表现，改系统时间没有收益 */
function ambientNow(islandId) {
  const now = new Date();
  return ambientAt(islandId, now, now.getHours());
}

/** 天气档的中文说明，给 HUD 与无障碍朗读用。不含任何评价（不说「天气不好」） */
const WEATHER_LABEL = { clear: "晴", cloudy: "阴", rain: "雨", snow: "雪" };
const PHASE_LABEL = { dawn: "清晨", day: "白天", dusk: "傍晚", night: "夜里" };

module.exports = {
  SEGMENT_STARTS: SEGMENT_STARTS,
  SEGMENTS_PER_DAY: SEGMENTS_PER_DAY,
  PHASE_STARTS: PHASE_STARTS,
  PHASE_OVERLAYS: PHASE_OVERLAYS,
  WEATHER_OVERLAYS: WEATHER_OVERLAYS,
  PARTICLES: PARTICLES,
  MIN_CLEAR_RATIO: MIN_CLEAR_RATIO,
  MAX_WET_SEGMENTS: MAX_WET_SEGMENTS,
  WINTER_MONTHS: WINTER_MONTHS,
  ISLAND_PALETTE: ISLAND_PALETTE,
  ISLAND_TEXT_COLOR: ISLAND_TEXT_COLOR,
  HUD_PLATE: HUD_PLATE,
  AI_LABEL_PLATE: AI_LABEL_PLATE,
  WINDOW_GLOW: WINDOW_GLOW,
  WEATHER_LABEL: WEATHER_LABEL,
  PHASE_LABEL: PHASE_LABEL,
  hash32: hash32,
  unitAt: unitAt,
  asDateKey: asDateKey,
  weatherForDay: weatherForDay,
  segmentAt: segmentAt,
  weatherAt: weatherAt,
  phaseAt: phaseAt,
  ambientAt: ambientAt,
  ambientNow: ambientNow,
  parseHex: parseHex,
  alphaOver: alphaOver,
  toRgba: toRgba
};
