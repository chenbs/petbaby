import "server-only";

import { normalizeDuration } from "@/domain/video-duration";
import { escapeDrawtext } from "@/server/video/narrative";

/*
 * 记忆短片 v2（2026-10-27）：原先只是「照片轮播 + 统一淡入淡出 + 一行字幕 + 单音正弦波」，用户反馈太简单。
 *
 * 这一版仍然是**一条 filtergraph、一次 spawn**（processNextVideo 队列并发是 1，分段渲染的 CPU 代价见 narrative.ts），
 * 加的都是「讲这只宠物」的东西，而不是滤镜特效：
 *   1. 片头卡：片名、宠物名、陪伴天数从 0 数上来
 *   2. 每张照片：缓慢平移（方向轮换）、左上角趣味贴纸、右上角「03 / 08」计数、底部「第 N 天 + 日期 + 用户写的照片说明」
 *   3. 转场：xfade 轮换几种形状；纪念语气只用淡化
 *   4. 片尾卡：片尾字幕 + 「N 张照片 · 跨越 M 天」
 *   5. 配乐：aevalsrc 合成的分解和弦旋律（晚风慢、晴天快），代替原来的单音正弦
 *
 * ## 时长口径
 * 成片总长**严格等于**所选档位：xfade 每次重叠 T 秒，
 *   total = 片头 + N × 单张 + 片尾 − (N + 1) × T
 * 单张时长由此反推。张数上限仍由 maxPhotosFor 在入口校验，这里不静默丢照片。
 *
 * ## 不用 zoompan
 * zoompan 对每个输入帧输出 d 帧，配 -loop 会把片子撑长数十倍（见 narrative.ts 的注释）。
 * 平移用 crop 的 x/y 随 t 变化实现，帧数不变。
 */

export const STORY_WIDTH = 720;
export const STORY_HEIGHT = 1280;
/** 照片先按这个尺寸铺满再裁出 720×1280，多出来的 15% 用来平移 */
export const PAN_WIDTH = 828;
export const PAN_HEIGHT = 1472;

const INK = "0x2A2140";
const ACCENT = "0xE8603C";
const PAPER = "0xFFF6EC";
const GOLD = "0xFFD45C";

const STICKERS = ["今日份可爱", "高光时刻", "偷拍成功", "营业中", "可爱暴击", "这一刻收好了", "看镜头", "认真脸"];
const PLAYFUL_TRANSITIONS = ["circleopen", "slideleft", "smoothup", "radial", "slideup", "dissolve"];
const QUIET_TRANSITIONS = ["fade", "dissolve"];

export type StoryShot = {
  /** 已按 PAN_WIDTH×PAN_HEIGHT 铺满的本地文件 */
  file: string;
  day?: number;
  showDay?: boolean;
  /** YYYY-MM-DD */
  date?: string;
  /** 用户给这张照片写的说明 */
  caption?: string;
};

export type StoryFilmInput = {
  title: string;
  petName: string;
  companionDays: number;
  memorial?: boolean;
  shots: StoryShot[];
  endCaption?: string;
  bgm?: string;
  totalSeconds: number;
  outputFile: string;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

/** 秒数统一 3 位小数，且一定带前导零（ffmpeg 6+ 拒绝 ".45"，见 domain/video-duration.ts） */
function sec(value: number) {
  return Math.max(0, value).toFixed(3);
}

function fontArg() {
  const fontFile = process.env.FFMPEG_FONT_FILE;
  return fontFile ? `fontfile='${fontFile.replace(/:/g, "\\:")}':` : "";
}

function clip(value: string, max: number) {
  const chars = Array.from(escapeDrawtext(value).trim());
  return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : chars.join("");
}

function text(value: string, options: { size: number; x?: string; y: string; color?: string; box?: string; from?: number; to?: number }) {
  const box = options.box ? `:box=1:boxcolor=${options.box}:boxborderw=14` : "";
  const enable = options.from !== undefined && options.to !== undefined ? `:enable='between(t,${sec(options.from)},${sec(options.to)})'` : "";
  return `drawtext=${fontArg()}text='${escapeDrawtext(value)}':fontcolor=${options.color || "white"}:fontsize=${options.size}:x=${options.x || "(w-text_w)/2"}:y=${options.y}${box}${enable}`;
}

/** 数字从 0 涨到 target。写法与 narrative.ts 的 countUp 一致（生产已验证），上界夹住，t 越界不会继续涨。 */
function countUp(target: number, from: number, to: number, y: string, size: number, color: string) {
  const span = Math.max(0.1, to - from);
  const expression = `max(0\\,min(${target}\\,floor((t-${sec(from)})/${sec(span)}*${target})))`;
  return `drawtext=${fontArg()}text='%{eif\\:${expression}\\:d}':fontcolor=${color}:fontsize=${size}:x=(w-text_w)/2:y=${y}`;
}

/** 每段统一帧率、像素格式与时基：xfade 要求两路输入完全一致 */
const NORMALIZE = "fps=30,format=yuv420p,settb=AVTB,setsar=1";

/**
 * 时间分配。片头、片尾按总长取比例并夹在区间内；转场在照片多、单张短时缩短，保证每张至少有约 0.5 秒完全露出。
 */
export function planStoryFilm(input: { totalSeconds: number; shotCount: number }) {
  const total = normalizeDuration(input.totalSeconds);
  const count = Math.max(0, input.shotCount);
  if (!count) {
    const transition = 0.4;
    const half = (total + transition) / 2;
    return { total, opening: half, closing: half, perShot: 0, transition };
  }
  const opening = clamp(total * 0.12, 1.2, 2.4);
  const closing = clamp(total * 0.14, 1.4, 3);
  const base = (total - opening - closing) / count;
  const transition = base >= 1.2 ? 0.4 : 0.25;
  const perShot = (total - opening - closing + (count + 1) * transition) / count;
  return { total, opening, closing, perShot, transition };
}

/** 分解和弦旋律。频率按拍号在 8 个音里轮换，每拍指数衰减到接近 0，换音时不爆音。 */
export function melodyExpression(bgm: string) {
  const bright = bgm === "bright";
  const beat = bright ? 0.25 : 0.5;
  const decay = bright ? 10 : 5;
  const notes = bright
    ? [523.25, 587.33, 659.25, 783.99, 880, 783.99, 659.25, 587.33]
    : [261.63, 329.63, 392, 523.25, 392, 329.63, 293.66, 392];
  const step = `mod(floor(t/${beat}),${notes.length})`;
  const frequency = notes.slice(0, -1).reduceRight((rest, note, index) => `if(eq(${step},${index}),${note},${rest})`, String(notes[notes.length - 1]));
  const pluck = `0.22*(sin(2*PI*(${frequency})*t)+0.35*sin(4*PI*(${frequency})*t))*exp(-${decay}*mod(t,${beat}))`;
  const bass = bright ? "0.07*sin(2*PI*130.81*t)*exp(-6*mod(t,1))" : "0.05*sin(2*PI*130.81*t)";
  return `${pluck}+${bass}`;
}

export function buildStoryFilmArgs(input: StoryFilmInput) {
  const plan = planStoryFilm({ totalSeconds: input.totalSeconds, shotCount: input.shots.length });
  const quiet = Boolean(input.memorial);
  const transitions = quiet ? QUIET_TRANSITIONS : PLAYFUL_TRANSITIONS;
  const inputs: string[] = [];
  const filters: string[] = [];
  const durations: number[] = [];
  let index = 0;

  // ── 片头卡 ─────────────────────────────────────────────
  inputs.push("-f", "lavfi", "-i", `color=c=${PAPER}:s=${STORY_WIDTH}x${STORY_HEIGHT}:d=${sec(plan.opening)}:r=30`);
  const opening = [
    `[${index}:v]${NORMALIZE}`,
    `drawbox=x=0:y=0:w=iw:h=18:color=${ACCENT}:t=fill`,
    `drawbox=x=0:y=ih-18:w=iw:h=18:color=${ACCENT}:t=fill`,
    text(quiet ? "麻麻抱我 · 纪念短片" : "麻麻抱我 · 记忆短片", { size: 28, y: "h*0.22", color: "0x6B6480" }),
    text(clip(input.title || "我们的日常电影", 12), { size: 62, y: "h*0.30", color: INK }),
    text(clip(input.petName || "宝宝", 10), { size: 36, y: "h*0.42", color: "white", box: `${ACCENT}@0.95` }),
  ];
  if (input.companionDays > 0) {
    opening.push(
      countUp(input.companionDays, 0.15, Math.max(0.4, plan.opening - 0.35), "h*0.52", 150, ACCENT),
      text(quiet ? "天的陪伴" : "天，一起过来的", { size: 34, y: "h*0.67", color: INK }),
    );
  }
  opening.push(`fade=t=in:st=0:d=0.40`);
  filters.push(opening.join(",") + `[s${index}]`);
  durations.push(plan.opening);
  index += 1;

  // ── 每张照片 ───────────────────────────────────────────
  const count = input.shots.length;
  const maxX = PAN_WIDTH - STORY_WIDTH;
  const maxY = PAN_HEIGHT - STORY_HEIGHT;
  const pans = [
    [`${maxX}*min(1,t/${sec(plan.perShot)})`, `${maxY / 2}`],
    [`${maxX}*(1-min(1,t/${sec(plan.perShot)}))`, `${maxY / 2}`],
    [`${maxX / 2}`, `${maxY}*min(1,t/${sec(plan.perShot)})`],
    [`${maxX / 2}`, `${maxY}*(1-min(1,t/${sec(plan.perShot)}))`],
  ];
  input.shots.forEach((shot, order) => {
    inputs.push("-loop", "1", "-framerate", "30", "-t", sec(plan.perShot), "-i", shot.file);
    const [x, y] = pans[order % pans.length];
    const parts = [
      `[${index}:v]scale=${PAN_WIDTH}:${PAN_HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${PAN_WIDTH}:${PAN_HEIGHT}`,
      `crop=${STORY_WIDTH}:${STORY_HEIGHT}:x='${x}':y='${y}'`,
      NORMALIZE,
      // 底部半透明底衬：字在白猫、雪地、过曝天空上也读得出来
      `drawbox=x=0:y=ih-240:w=iw:h=240:color=black@0.40:t=fill`,
      text(`${String(order + 1).padStart(2, "0")} / ${String(count).padStart(2, "0")}`, { size: 26, x: "w-text_w-44", y: "64", box: "black@0.35" }),
    ];
    if (!quiet) parts.push(text(STICKERS[order % STICKERS.length], { size: 30, x: "44", y: "60", color: "white", box: `${ACCENT}@0.92` }));
    const headline = shot.showDay !== false && shot.day ? `第 ${shot.day} 天` : shot.date || "";
    if (headline) parts.push(text(headline, { size: 52, y: "h-200", color: GOLD }));
    if (headline && shot.date && headline !== shot.date) parts.push(text(shot.date, { size: 28, y: "h-126" }));
    if (shot.caption) parts.push(text(clip(shot.caption, 16), { size: 30, y: "h-80" }));
    filters.push(parts.join(",") + `[s${index}]`);
    durations.push(plan.perShot);
    index += 1;
  });

  // ── 片尾卡 ─────────────────────────────────────────────
  inputs.push("-f", "lavfi", "-i", `color=c=${INK}:s=${STORY_WIDTH}x${STORY_HEIGHT}:d=${sec(plan.closing)}:r=30`);
  const ending = Array.from(escapeDrawtext(input.endCaption || (quiet ? "谢谢你来过我们的生活" : "下一段，继续一起拍")).trim());
  // 一行最多 13 个字；超过就均分成两行，免得第二行只剩一个字
  const split = ending.length > 13 ? Math.ceil(Math.min(ending.length, 26) / 2) : ending.length;
  const lines = [ending.slice(0, split).join(""), ending.slice(split, 26).join("")].filter(Boolean);
  const dated = input.shots.map((shot) => shot.date).filter((date): date is string => Boolean(date)).sort();
  const spanDays = dated.length > 1 ? Math.round((Date.parse(dated[dated.length - 1]) - Date.parse(dated[0])) / 86_400_000) + 1 : 0;
  const stats = count ? `${count} 张照片${spanDays > 1 ? ` · 跨越 ${spanDays} 天` : ""}` : "";
  const closing = [`[${index}:v]${NORMALIZE}`];
  lines.forEach((line, order) => closing.push(text(line, { size: 46, y: `h*${(0.34 + order * 0.07).toFixed(2)}` })));
  if (stats) closing.push(text(stats, { size: 32, y: "h*0.52", color: GOLD }));
  if (quiet && input.companionDays > 0) closing.push(text(`陪伴了 ${input.companionDays} 天`, { size: 30, y: "h*0.60" }));
  closing.push(text("麻麻抱我", { size: 28, y: "h*0.86", color: "white@0.7" }), `fade=t=out:st=${sec(plan.closing - 0.6)}:d=0.60`);
  filters.push(closing.join(",") + `[s${index}]`);
  durations.push(plan.closing);
  const segmentCount = index + 1;

  // ── xfade 串联：第 k 次转场的 offset = 已拼接长度 − T ──────────────
  let label = "[s0]";
  let length = durations[0];
  for (let segment = 1; segment < segmentCount; segment += 1) {
    const next = `[x${segment}]`;
    const kind = segment === 1 ? "fadewhite" : segment === segmentCount - 1 ? "fadeblack" : transitions[(segment - 2) % transitions.length];
    filters.push(`${label}[s${segment}]xfade=transition=${quiet ? "fade" : kind}:duration=${sec(plan.transition)}:offset=${sec(length - plan.transition)}${next}`);
    length += durations[segment] - plan.transition;
    label = next;
  }

  const withAudio = Boolean(input.bgm) && input.bgm !== "none";
  if (withAudio) inputs.push("-f", "lavfi", "-i", `aevalsrc='${melodyExpression(String(input.bgm))}':s=44100:d=${sec(plan.total)}`);
  const audioIndex = segmentCount;
  if (withAudio) filters.push(`[${audioIndex}:a]afade=t=in:st=0:d=0.60,afade=t=out:st=${sec(plan.total - 1.2)}:d=1.20[aout]`);

  const args = ["-y", ...inputs, "-filter_complex", filters.join(";"), "-map", label];
  if (withAudio) args.push("-map", "[aout]", "-c:a", "aac", "-b:a", "128k");
  args.push("-t", String(plan.total), "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.outputFile);
  return { args, plan, segmentCount, renderedSeconds: length };
}
