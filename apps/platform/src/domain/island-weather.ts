/*
 * 宠物小岛的昼夜与天气口径（22 号文 2.5 / 2.5.1 / 2.5.2 / 2.5.3）。
 *
 * **天气不建表、不存储**：它是 `hash(islandId + 日期)` 的纯函数，同一天必得同一结果。
 * 存起来反而带来「已存的天气与规则改动后不一致」的问题 —— 而这是纯表现层的东西，
 * 不一致没有任何补救价值。
 *
 * 放 `domain/` 而不是 `server/`：端上也要用同一口径算光照与天气（Canvas 场景层自己叠），
 * 服务端则要用它拼日记文案。两边各写一份必然漂移，而漂移的表现是「小程序在下雨、
 * 日记里说今天天气好」。沿用 `domain/companion.ts` 与 `domain/weight-trend.ts` 的先例。
 *
 * **不接真实天气接口**（2.5.2）。这是设计判断不是技术限制：用户所在地连下一周雨，
 * 岛上就连下一周雨 —— 而岛的全部价值是「打开就感到舒缓」。治愈产品不把现实的坏天气
 * 搬进来，与「不做 N 天不来宠物会难过」是同一条判据：**岛不制造负面情绪**。
 * 顺带省掉 `wx.getLocation` 敏感权限与一个第三方域名白名单。
 */

/** 昼夜四档。夜档起点是 21:00 而非 20:00，为的是与天气段边界对齐（见 SEGMENT_STARTS） */
export type IslandDayPhase = "dawn" | "day" | "dusk" | "night";

/** 天气四档。与昼夜**正交**叠加：雨夜 = 夜光照层 + 雨天气层，仍共用同一张底图 */
export type IslandWeather = "clear" | "cloudy" | "rain" | "snow";

/**
 * 一天 5 段的起始小时：05 / 09 / 13 / 17 / 21。
 *
 * **不用固定 4 小时（00/04/08/12/16/20）**：昼夜边界是不等长的（要贴合真实感受），
 * 两套边界错开会切出很多碎片区间 —— 用户 08:50 看到「晨+雨」，09:10 变「昼+雨」，
 * 09:50 又变「昼+雪」，十分钟内两次变脸。对齐后每次变化都是一个完整的时段感。
 *
 * 05 之前属前一天的最后一段（夜里 21:00 开始的那段一直延续到 05:00），
 * 见 `segmentAt` 的 wrap 处理。
 */
export const SEGMENT_STARTS = [5, 9, 13, 17, 21] as const;

/** 一天的天气段数 */
export const SEGMENTS_PER_DAY = SEGMENT_STARTS.length;

/** 昼夜档的起始小时。与 SEGMENT_STARTS 的前四个重合 */
const PHASE_STARTS: { hour: number; phase: IslandDayPhase }[] = [
  { hour: 5, phase: "dawn" },
  { hour: 9, phase: "day" },
  { hour: 17, phase: "dusk" },
  { hour: 21, phase: "night" },
];

/**
 * 光照 / 天气叠加层。**四档共用一张底图**，成本是一层叠加而不是四倍素材（2.5 / 24 号文第 4 章）。
 * `day` 与 `clear` 是基准档，不叠任何东西 —— 底图本身就是晴天白昼。
 *
 * **叠加方式是普通 alpha（Canvas 的默认 `source-over`），不是乘法混合。**
 * 22 号文把它写成「全屏色乘」，但该文 2.5.1 的实算表**只在普通 alpha 下成立**：
 * 按 alpha 复算，草地在夜档得明度 0.446、雨档 0.627、雪档 0.744、雨+夜 0.485，
 * 与表中数字逐个吻合（对比度亦然：雨+夜深色字 3.22、白字 4.14，表里是 3.23 / 4.13）；
 * 而按乘法复算，夜档会掉到 0.34，整张表都对不上。取值既然是照表来的，
 * 合成方式就必须与表同源，否则门禁 16 校验的是另一套画面。
 */
export interface OverlayLayer {
  color: string;
  opacity: number;
}

const PHASE_OVERLAYS: Record<IslandDayPhase, OverlayLayer | null> = {
  // 淡金偏冷、长影。压得很轻 —— 晨光不该把画面压暗
  dawn: { color: "#F2D9A8", opacity: 0.22 },
  day: null,
  dusk: { color: "#E8905A", opacity: 0.32 },
  // 蓝紫 @0.55，2.5.1 实算：草地合成后明度 0.446
  night: { color: "#3D4470", opacity: 0.55 },
};

const WEATHER_OVERLAYS: Record<IslandWeather, OverlayLayer | null> = {
  clear: null,
  // 阴与雨共用同一层冷灰 @0.3（2.5.1）：阴是「压高光、降饱和」，雨在此之上加粒子与地面反光
  cloudy: { color: "#8C93A0", opacity: 0.3 },
  rain: { color: "#8C93A0", opacity: 0.3 },
  // 雪档提亮：淡紫白 @0.35，实算合成后明度 0.744
  snow: { color: "#E8EAF2", opacity: 0.35 },
};

/**
 * 粒子层规格。**粒子在 Canvas 里画，不用图片序列帧**（2.5.1）：
 * 雨丝是带速度的线段，雪花是带正弦横移的圆点，零素材成本。
 *
 * `count` 是基准机型（骁龙 6xx 级）的目标值，`degradedCount` 是低端机降级值 ——
 * **天气是唯一持续跑帧的图层**，「静止即停帧」在天气档下不成立，帧预算要重算。
 */
export interface ParticleSpec {
  kind: "rain" | "snow";
  count: number;
  degradedCount: number;
}

const PARTICLES: Partial<Record<IslandWeather, ParticleSpec>> = {
  rain: { kind: "rain", count: 120, degradedCount: 40 },
  snow: { kind: "snow", count: 80, degradedCount: 40 },
};

/**
 * 32 位整数哈希（FNV-1a 变体）。
 *
 * 自己写而不用 `crypto`：这个模块要在小程序端跑，那里没有 node 的 crypto，
 * 而端上与服务端必须算出**同一个**天气 —— 换哈希就换天气，两边不一致时用户会看到
 * 「画面在下雨、日记说晴天」。所以哈希实现本身也是口径的一部分，不能各用一套。
 *
 * 返回无符号 32 位值，避免右移带来的符号位问题。
 */
function hash32(text: string): number {
  let value = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    value ^= text.charCodeAt(index);
    // 等价于 value *= 16777619，用移位避免超出 32 位精度
    value = (value + ((value << 1) + (value << 4) + (value << 7) + (value << 8) + (value << 24))) >>> 0;
  }
  return value >>> 0;
}

/** 由种子派生第 index 个 [0,1) 随机数。同一 (seed, index) 必得同一值 */
function unitAt(seed: number, index: number): number {
  return hash32(`${seed}:${index}`) / 0x100000000;
}

/**
 * 日期归一到 `YYYY-MM-DD`。
 *
 * **`date` 列读出来可能是 JS `Date`**，`String(value).slice(0,10)` 会得到
 * `"Sat Aug 01"`（健康线已经踩过一次，见 CLAUDE.md）。Date 分支取**本地**年月日
 * 而不是 `toISOString()`：`date` 无时区，转 UTC 会在东八区退回前一天。
 */
export function asDateKey(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  const text = String(value ?? "");
  if (text.indexOf("T") > 0) return text.slice(0, 10);
  const parts = text.split(/[^0-9]/).filter(Boolean);
  if (parts.length >= 3) {
    return `${parts[0].padStart(4, "0")}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`;
  }
  return text.slice(0, 10);
}

/** 冬季月份（雪只在这几个月出现）。北半球口径，与用户所在地无关 —— 天气本就不取真实位置 */
const WINTER_MONTHS = [12, 1, 2];

/**
 * 一天里雨 + 雪合计的段数上限（2.5.3）。连续两段雨读作「今天一直在下雨」，正是要避免的。
 *
 * 与 `MIN_CLEAR_RATIO` 是**两条独立约束**，只是当前取值下前者更松（晴 ≥60% 已把
 * 非晴段压到 2）。仍显式参与计算而不是「反正算出来也不会超」—— 后者一旦有人调高
 * 非晴比例，湿档上限就静默失效了，而那是体验判断不是数值巧合。
 */
const MAX_WET_SEGMENTS = 2;

/** 晴天占比下限，按段计不按天计（2.5.3） */
export const MIN_CLEAR_RATIO = 0.6;

/** 单日 5 段里晴天至少几段（由 MIN_CLEAR_RATIO 推出，取上取整） */
const MIN_CLEAR_SEGMENTS = Math.ceil(SEGMENTS_PER_DAY * MIN_CLEAR_RATIO);

/** 单日非晴段数的上限。由晴天占比下限直接推出，两条约束不各存一份 */
const MAX_NON_CLEAR_SEGMENTS = SEGMENTS_PER_DAY - MIN_CLEAR_SEGMENTS;

/** 雨与雪算「湿档」：受「最多 2 段且不连续」约束（阴不算，阴天连着两段没什么不适） */
function isWet(weather: IslandWeather): boolean {
  return weather === "rain" || weather === "snow";
}

/**
 * 生成一整天 5 段的天气序列。
 *
 * **接口是「按天返回 5 段」而不是「按时刻返回一档」**（2.5.3）：单点函数无法保证
 * 全天约束 —— 「晴天占比 ≥60%」与「雨雪合计 ≤2 段且不连续」都是跨段的性质，
 * 逐段独立随机时无从施加。所以必须先生成一整天再按时刻取。
 *
 * @param islandId 岛 id。同一天不同岛的天气不同 —— 否则全体用户同时下雨，
 *        分享截图时会显得像统一活动
 * @param date 日期。接受 `Date`、`YYYY-MM-DD` 或 pg 的 `date` 列原值
 */
export function weatherForDay(islandId: string, date: unknown): IslandWeather[] {
  const dateKey = asDateKey(date);
  const seed = hash32(`${islandId}|${dateKey}`);
  const month = Number(dateKey.slice(5, 7));
  const snowAllowed = WINTER_MONTHS.indexOf(month) >= 0;

  const segments: IslandWeather[] = new Array(SEGMENTS_PER_DAY).fill("clear");

  // 非晴段数：0 / 1 / 2 三档。上界由 MAX_NON_CLEAR_SEGMENTS 兜住，
  // 所以「晴天占比 ≥60%」是结构性保证，而不是靠概率碰运气达标。
  const draw = unitAt(seed, 0);
  const nonClearCount = draw < 0.45 ? 0 : draw < 0.8 ? 1 : MAX_NON_CLEAR_SEGMENTS;
  if (!nonClearCount) return segments;
  // 湿档上限单独兜一次：非晴段里最多这么多段可以是雨/雪，其余强制为阴
  let wetBudget = MAX_WET_SEGMENTS;

  // 选中哪几段：按种子给每段打分后取分最低的若干段。
  // 用排序而不是「随机取一个再重试」，避免同段被选两次时的循环。
  const picked = segments
    .map((_, index) => ({ index, score: unitAt(seed, 10 + index) }))
    .sort((left, right) => left.score - right.score)
    .slice(0, nonClearCount)
    .map((entry) => entry.index)
    .sort((left, right) => left - right);

  for (const index of picked) {
    const roll = unitAt(seed, 30 + index);
    // 雪只在冬季月份出现；非冬季时它那份概率归给雨（而不是归给阴 ——
    // 否则夏天的非晴档会几乎全是阴，少了雨天躲雨那个画面）
    if (roll < 0.5 || wetBudget <= 0) segments[index] = "cloudy";
    else if (roll < 0.85 || !snowAllowed) { segments[index] = "rain"; wetBudget -= 1; }
    else { segments[index] = "snow"; wetBudget -= 1; }
  }

  /*
   * 湿档不连续：相邻两段都湿时把后一段降级为阴。
   * 降级而不是改晴 —— 「雨转阴」是自然的天气过程，「雨转大晴」在同一天里显得突兀。
   *
   * 约束**只在日内**成立：末段（21:00 起）跨夜延续到次日 05:00，若次日首段也是雨，
   * 读作「下了一夜雨、早上还在下」而不是「今天一直在下雨」，这正是想要的雨天诗意。
   * 所以不做跨日约束，也不必为此让 weatherForDay 依赖前一天。
   */
  for (let index = 1; index < segments.length; index += 1) {
    if (isWet(segments[index]) && isWet(segments[index - 1])) segments[index] = "cloudy";
  }
  return segments;
}

/**
 * 某个小时落在当天的第几段，以及它归属哪一天。
 *
 * **05:00 之前属前一天的末段**：21:00 起的那段一直延续到次日清晨，
 * 凌晨两点看到的天气应当与睡前一致，而不是零点换日时凭空变一次。
 * 所以取天气必须先解析归属日，不能直接用「今天」。
 */
export function segmentAt(date: unknown, hour: number): { dateKey: string; index: number } {
  const safeHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 0;
  const dateKey = asDateKey(date);
  if (safeHour < SEGMENT_STARTS[0]) {
    // 退到前一天。经 Date 运算而不是字符串减法，跨月跨年才不会算错
    const parts = dateKey.split("-").map(Number);
    const previous = new Date(parts[0], (parts[1] || 1) - 1, (parts[2] || 1) - 1);
    return { dateKey: asDateKey(previous), index: SEGMENTS_PER_DAY - 1 };
  }
  let index = 0;
  for (let position = 0; position < SEGMENT_STARTS.length; position += 1) {
    if (safeHour >= SEGMENT_STARTS[position]) index = position;
  }
  return { dateKey, index };
}

/** 某个时刻的天气。内部先算全天 5 段再取，保证与 `weatherForDay` 逐段一致 */
export function weatherAt(islandId: string, date: unknown, hour: number): IslandWeather {
  const { dateKey, index } = segmentAt(date, hour);
  return weatherForDay(islandId, dateKey)[index];
}

/**
 * 某个小时属于哪一档昼夜。
 *
 * 昼夜**可以用端上时间**（纯表现，用户改系统时间只是看到不同光照，无收益），
 * 而额度与亲密度必须用服务端时间（22 号文 5.6）—— 这条边界不能混。
 */
export function phaseAt(hour: number): IslandDayPhase {
  const safeHour = Number.isFinite(hour) ? Math.min(23, Math.max(0, Math.floor(hour))) : 0;
  // 05:00 之前仍是夜档：夜档从 21:00 延续到次日 05:00，跨了零点
  if (safeHour < PHASE_STARTS[0].hour) return "night";
  let phase: IslandDayPhase = "dawn";
  for (const entry of PHASE_STARTS) {
    if (safeHour >= entry.hour) phase = entry.phase;
  }
  return phase;
}

/** 场景合成所需的全部图层信息。端上按这个结果叠加，不自己判断档位 */
export interface IslandAmbient {
  phase: IslandDayPhase;
  weather: IslandWeather;
  /** 光照层与天气层，按数组顺序叠加。`day` + `clear` 时为空数组（基准档不叠任何东西） */
  overlays: OverlayLayer[];
  /** 粒子层，无粒子时为空 */
  particles?: ParticleSpec;
  /** 夜档才画窗户暖光。这是「家」的核心意象（2.5），径向渐变由端上代码绘制 */
  windowGlow: boolean;
  /**
   * 宠物站位是否切到屋檐下。
   *
   * 雨档的正确实现不是「淋雨的宠物」而是「一起躲雨」（2.5.2）—— 窗外下雨、
   * 屋内暖光是治愈感最强的画面之一。这是纯坐标切换，不需要额外素材，
   * 但底图必须画出那片屋檐（24 号文 7.2 已把这句加进底图提示词）。
   */
  shelter: boolean;
  /** 本段结束的小时（下一段起点），端上据此安排 2–3 秒交叉淡入而不是瞬间跳变 */
  nextSegmentHour: number;
}

/**
 * 岛屿调色板（22 号文 2.2 的实算值，对标《猫咪和汤》）。
 *
 * 这套色是**内容属性不是 UI 主题**：换 UI 主题不改变岛的外观，与
 * `theme/scene-presets.js` 的既有先例同一处理（内联注入、与 token 体系隔离）。
 * 放在这里是因为「合成后的明度」要参与对比度计算，而那个计算两端都要跑。
 */
export const ISLAND_PALETTE = {
  /** 草地主色。明度 0.651、饱和度 27% */
  grass: "#9DB37A",
  grassShadow: "#8AA268",
  /** 树丛深色。与深色文字只有 2.78:1 —— 这正是 HUD 必须有底板的直接原因 */
  canopy: "#5F7A4E",
  cream: "#F7F0DE",
  path: "#C9B893",
  sky: "#CFE0E8",
  water: "#A8C4C9",
} as const;

/** 岛内文字色。与小程序的 cocoa900 同值，不新开一套 */
export const ISLAND_TEXT_COLOR = "#3A2C2C";

/**
 * HUD 顶部一行的底板。
 *
 * **底板不是可选项**（22 号文 2.3 / 2.5.1）：16 种昼夜×天气组合下**没有任何单一字色
 * 能全域达标** —— 最暗的「雨+夜」把画面推到中间明度 0.485，深色字只有 3.23:1、
 * 白字 4.13:1，两个方向双双不达标。底板把文字与场景明度解耦，对比度因此恒定。
 *
 * 取奶白而非深色：奶白贴合这套画风的器物色，深色底板会显得突兀。
 * **与 AI 标识的深色底衬用途不同、不可共用** —— 后者要压住高亮画面（白猫、雪地、
 * 阳光高光），必须是深色。
 */
export const HUD_PLATE = { color: ISLAND_PALETTE.cream, opacity: 0.82, textColor: ISLAND_TEXT_COLOR } as const;

/**
 * AI 标识的深色底衬（22 号文 1.5 / 2.2 实算）。
 *
 * 最坏情况不是任一地表色，而是**阳光高光或白猫身上的纯白像素**：
 * 底衬 `#2A1F1F` 在纯白上需 ≥0.62 不透明度才能让白字达到 4.57:1，取 0.65（5.04:1）留余量。
 * 与官网踩过的坑同一类 —— 半透明层叠在图片上必须按最坏帧算，不能按平均色算。
 */
export const AI_LABEL_PLATE = { color: "#2A1F1F", opacity: 0.65, textColor: "#FFFFFF" } as const;

export interface Rgb { r: number; g: number; b: number }

function parseHex(value: string): Rgb {
  let digits = value.replace("#", "");
  if (digits.length === 3) digits = digits.split("").map((char) => char + char).join("");
  return {
    r: parseInt(digits.slice(0, 2), 16),
    g: parseInt(digits.slice(2, 4), 16),
    b: parseInt(digits.slice(4, 6), 16),
  };
}

/**
 * 普通 alpha 叠加（半透明色压在背景上）。与 `scripts/validate.js` 的 composite 同一套口径。
 * 光照层、天气层、HUD 底板、AI 标识底衬全走这一条 —— 只有一种合成方式，不会算错档。
 */
function alphaOver(foreground: Rgb, background: Rgb, opacity: number): Rgb {
  return {
    r: foreground.r * opacity + background.r * (1 - opacity),
    g: foreground.g * opacity + background.g * (1 - opacity),
    b: foreground.b * opacity + background.b * (1 - opacity),
  };
}

function relativeLuminance(color: Rgb): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrastOf(first: Rgb, second: Rgb): number {
  const bright = Math.max(relativeLuminance(first), relativeLuminance(second));
  const dark = Math.min(relativeLuminance(first), relativeLuminance(second));
  return (bright + 0.05) / (dark + 0.05);
}

/**
 * 某个底色在给定环境下叠完全部图层后的最终色。
 * 端上不需要这个（Canvas 自己合成），它存在的意义是让门禁能算出对比度。
 */
export function compositeSceneColor(baseColor: string, ambient: IslandAmbient): Rgb {
  let color = parseHex(baseColor);
  for (const layer of ambient.overlays) color = alphaOver(parseHex(layer.color), color, layer.opacity);
  return color;
}

/**
 * 文字**直接压在场景上**（无底板）的对比度。
 *
 * 存在的意义只有一个：让测试能证明「底板不是可选项」—— 它跑遍 16 种组合后会发现
 * 深色字与白字各有失手的一端。若哪天有人想把底板优化掉，这个函数会立刻给出反证。
 */
export function sceneTextContrast(textColor: string, baseColor: string, ambient: IslandAmbient): number {
  return contrastOf(parseHex(textColor), compositeSceneColor(baseColor, ambient));
}

/**
 * HUD 文字在给定环境下的实际对比度。
 *
 * **算的是「底板合成后」的对比度，不是文字与地表的直接对比度**（门禁 9.2 #16）：
 * 底板半透明，所以它自身的呈现色取决于身后的场景，必须逐组合算。
 */
export function hudContrast(baseColor: string, ambient: IslandAmbient): number {
  const scene = compositeSceneColor(baseColor, ambient);
  return contrastOf(parseHex(HUD_PLATE.textColor), alphaOver(parseHex(HUD_PLATE.color), scene, HUD_PLATE.opacity));
}

/**
 * AI 标识白字在最坏画面上的对比度。
 * 最坏画面是**纯白**（阳光高光 / 白猫 / 雪地），不是任一地表色 —— 按平均色算会得出安全的假结论。
 */
export function aiLabelContrastOnWhite(): number {
  const shown = alphaOver(parseHex(AI_LABEL_PLATE.color), { r: 255, g: 255, b: 255 }, AI_LABEL_PLATE.opacity);
  return contrastOf(parseHex(AI_LABEL_PLATE.textColor), shown);
}

/** 某时刻的完整环境。这是端上唯一需要调的入口 —— 档位判断不外泄给调用方 */
export function ambientAt(islandId: string, date: unknown, hour: number): IslandAmbient {
  const phase = phaseAt(hour);
  const weather = weatherAt(islandId, date, hour);
  const overlays: OverlayLayer[] = [];
  /*
   * 顺序固定：**先昼夜、再天气**。两层不可交换（alpha 叠加不满足交换律），
   * 而 2.5.1 的实算表是按这个顺序算的 —— 雨+夜取 0.485，正是「夜压在草地上、
   * 雨再压在夜上」的结果；反过来叠得 0.435，与表不符。
   * 观感上也对：雨是当下的天气，落在已经暗下来的世界之上。
   */
  const phaseLayer = PHASE_OVERLAYS[phase];
  if (phaseLayer) overlays.push(phaseLayer);
  const weatherLayer = WEATHER_OVERLAYS[weather];
  if (weatherLayer) overlays.push(weatherLayer);

  const { index } = segmentAt(date, hour);
  return {
    phase,
    weather,
    overlays,
    particles: PARTICLES[weather],
    windowGlow: phase === "night" || phase === "dusk",
    shelter: weather === "rain" || weather === "snow",
    nextSegmentHour: SEGMENT_STARTS[(index + 1) % SEGMENTS_PER_DAY],
  };
}
