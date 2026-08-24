import "server-only";

import { FADE_SECONDS, normalizeDuration } from "@/domain/video-duration";

/**
 * 叙事型年度视频的 filtergraph 构造。
 *
 * 这是视频「可变玩法」的第一个具体形态，也是方向判断里「往叙事和数据上加、
 * 不往滤镜特效上加」的落地 —— 后者是抖音主场，我们做到 60 分它也是 100 分。
 *
 * 四段结构：
 *   1. 开场   陪伴天数从 0 计数到当前值（drawtext + eif）
 *   2. 时间线 每张照片带真实拍摄日期 + 「第 N 天」
 *   3. 对比   vstack 上下分屏，年初 vs 年末
 *   4. 数据卡 照片数、作品数等逐行淡入
 *
 * 每个数字都来自这个用户的真实档案（见 `annual/aggregate.ts` 的判定方法）。
 *
 * ## 为什么是单次 spawn 而不是分段渲染 + concat
 *
 * 任务书附录 B 提到分段渲染，但也点明它的代价：每段一次 `spawn` 加最终拼接，
 * CPU 占用是单段方案的数倍，而 `processNextVideo` 的队列并发是 **1** ——
 * 视频任务独占 CPU 时图文任务跟着延迟。所以这里用一条 filtergraph 走完四段，
 * 不引入分段。真正需要分段时再回来，届时必须同步决定视频任务的独立限流。
 */

/** 各段时长占比。总时长仍由用户选（10 / 20 / 30 秒） */
const OPENING_RATIO = 0.14;
const COMPARE_RATIO = 0.18;
const CLOSING_RATIO = 0.18;

/** 画布。1080×1920 是小红书基准，但成本翻倍；沿用现有链路的 720×1280 */
const WIDTH = 720;
const HEIGHT = 1280;

/** 每段至少 1.2 秒，否则字还没读完就切走了 */
const MIN_SEGMENT_SECONDS = 1.2;

export type NarrativeShot = {
  /** 已归一到 720×1280 的本地文件路径 */
  file: string;
  /** 「第 N 天」 */
  day: number;
  /** 拍摄日期，YYYY-MM-DD */
  date: string;
};

export type NarrativeInput = {
  petName: string;
  companionDays: number;
  shots: NarrativeShot[];
  /** 成长对比的两张（已归一）。不足两张时省略该段 */
  compare?: { earliestFile: string; latestFile: string; earliestDay: number; latestDay: number; gapDays: number };
  counts: { photos: number; works: number; interactions: number };
  year: number;
  totalSeconds: number;
  outputFile: string;
  /** 纪念语气：陪伴天数用过去式，且不出现「今天」这类仍在继续的说法 */
  memorial?: boolean;
};

/**
 * drawtext 的文本转义。
 *
 * filtergraph 里 `:` 是参数分隔符、`'` 会提前闭合引号、`\` 是转义引导符，
 * 任何一个漏掉都会让整条 filtergraph 解析失败（或更糟：静默画出错误内容）。
 * `%` 也要处理 —— drawtext 会把它当 strftime 格式符。
 */
export function escapeDrawtext(value: string) {
  return String(value)
    .replace(/\\/g, "")
    .replace(/'/g, "")
    .replace(/:/g, " ")
    .replace(/%/g, " ")
    .replace(/[\r\n]+/g, " ")
    .slice(0, 60);
}

function fontArg() {
  const fontFile = process.env.FFMPEG_FONT_FILE;
  // 路径里的 ":"（Windows 盘符 C:/…）对 filtergraph 是分隔符，必须转义成 "C\:/…"
  return fontFile ? `fontfile='${fontFile.replace(/:/g, "\\:")}':` : "";
}

function drawtext(text: string, options: { size: number; y: string; from?: number; to?: number; color?: string }) {
  const enable = options.from !== undefined && options.to !== undefined
    ? `:enable='between(t,${options.from.toFixed(2)},${options.to.toFixed(2)})'`
    : "";
  return `drawtext=${fontArg()}text='${escapeDrawtext(text)}':fontcolor=${options.color || "white"}:fontsize=${options.size}:x=(w-text_w)/2:y=${options.y}${enable}`;
}

/**
 * 计数动画：数字随时间从 0 涨到 `target`。
 *
 * `eif` 在每一帧求值，所以不需要预生成 N 张图。
 * `%` 在 drawtext 里是 strftime 格式符，所以这里用 `text=` 的表达式形式而非
 * 拼字符串；`expansion=normal` 是默认值，`%{eif:...}` 才会被求值。
 */
function countUp(target: number, from: number, to: number, y: string, size: number) {
  const span = Math.max(0.1, to - from);
  // clip 住上界：t 超过 to 之后表达式仍在求值，不夹住会一路涨过 target。
  const expression = `min(${target}\\,floor((t-${from.toFixed(2)})/${span.toFixed(2)}*${target}))`;
  const guarded = `max(0\\,${expression})`;
  return `drawtext=${fontArg()}text='%{eif\\:${guarded}\\:d}':fontcolor=white:fontsize=${size}:x=(w-text_w)/2:y=${y}:enable='between(t,${from.toFixed(2)},${to.toFixed(2)})'`;
}

/**
 * 计算四段的时间分配。
 *
 * 时间线段拿走剩下的全部时间，并按张数均分。段数或时长不够时**省略可选段**
 * （对比、数据卡），而不是把每段压到看不清 —— 一段 0.3 秒的数据卡等于没有。
 */
export function planSegments(input: { totalSeconds: number; shotCount: number; hasCompare: boolean }) {
  const total = normalizeDuration(input.totalSeconds);
  let opening = Math.max(MIN_SEGMENT_SECONDS, total * OPENING_RATIO);
  let compare = input.hasCompare ? Math.max(MIN_SEGMENT_SECONDS, total * COMPARE_RATIO) : 0;
  let closing = Math.max(MIN_SEGMENT_SECONDS, total * CLOSING_RATIO);

  // 时间线至少要能给每张照片 1 秒（与 MIN_PHOTO_SECONDS 同口径）。
  const timelineNeeded = Math.max(1, input.shotCount) * 1;
  if (opening + compare + closing + timelineNeeded > total) {
    // 先砍对比段：它是四段里唯一能用一张静图替代表达的。
    compare = 0;
    if (opening + closing + timelineNeeded > total) {
      // 再压缩开场与结尾到下限；仍不够就让时间线吃掉不足，由调用方限制张数。
      opening = MIN_SEGMENT_SECONDS;
      closing = MIN_SEGMENT_SECONDS;
    }
  }
  const timeline = Math.max(MIN_SEGMENT_SECONDS, total - opening - compare - closing);
  return { total, opening, timeline, compare, closing, perShot: timeline / Math.max(1, input.shotCount) };
}

/**
 * 拼出叙事视频的 ffmpeg 参数。
 *
 * ## zoompan 帧数陷阱（不要移除这段注释）
 *
 * `zoompan` 对**每个输入帧**都输出 `d` 帧。若输入用 `-loop 1 -t 2.4`（= 72 帧），
 * 实际输出是 72×72 帧 —— 实测把 26 秒的片子撑成 3 分 16 秒。
 * 必须只喂**单帧**静图（不加 `-loop`），再用
 * `trim=duration=N,setpts=PTS-STARTPTS` 封口。
 *
 * 本实现因此**不使用 zoompan**：Ken Burns 的观感收益不足以换来这个风险，
 * 而任务书的方向判断也明说「往叙事和数据上加，不往滤镜特效上加」。
 * 若将来要加，照上面的方式做，并补一条断言总时长的测试。
 */
export function buildNarrativeArgs(input: NarrativeInput) {
  const plan = planSegments({ totalSeconds: input.totalSeconds, shotCount: input.shots.length, hasCompare: Boolean(input.compare) });
  const useCompare = plan.compare > 0 && input.compare;

  const inputs: string[] = [];
  const filters: string[] = [];
  const labels: string[] = [];
  let index = 0;

  // ── 1. 开场：陪伴天数计数 ──────────────────────────────
  inputs.push("-f", "lavfi", "-i", `color=c=#14251c:s=${WIDTH}x${HEIGHT}:d=${plan.opening.toFixed(3)}:r=30`);
  const openingLead = `${input.petName} · ${input.year}`;
  // 纪念语气用过去式，且不说「到今天」——那件事已经结束了。
  const daysCaption = input.memorial ? "天的陪伴" : "天，一起过来的";
  filters.push([
    `[${index}:v]setsar=1`,
    drawtext(openingLead, { size: 40, y: "h*0.28" }),
    countUp(input.companionDays, 0.2, Math.max(0.4, plan.opening - 0.3), "h*0.44", 132),
    drawtext(daysCaption, { size: 34, y: "h*0.60" }),
    `fade=t=in:st=0:d=${FADE_SECONDS.toFixed(2)}`,
  ].join(",") + `[s${index}]`);
  labels.push(`[s${index}]`);
  index += 1;

  // ── 2. 时间线：每张带真实日期 + 第 N 天 ───────────────
  const perShot = plan.perShot;
  for (const shot of input.shots) {
    inputs.push("-loop", "1", "-t", perShot.toFixed(3), "-i", shot.file);
    filters.push([
      `[${index}:v]scale=${WIDTH}:${HEIGHT}:force_original_aspect_ratio=increase`,
      `crop=${WIDTH}:${HEIGHT}`,
      "setsar=1",
      // 半透明底衬让字幕在任何底图上都可读（服务端不受 .wxss 禁 rgba( 的门禁约束）
      `drawbox=x=0:y=ih-190:w=iw:h=190:color=black@0.45:t=fill`,
      drawtext(`第 ${shot.day} 天`, { size: 44, y: "h-150" }),
      drawtext(shot.date, { size: 28, y: "h-92" }),
      `fade=t=in:st=0:d=${FADE_SECONDS.toFixed(2)}`,
      `fade=t=out:st=${Math.max(0, perShot - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS.toFixed(2)}`,
    ].join(",") + `[s${index}]`);
    labels.push(`[s${index}]`);
    index += 1;
  }

  // ── 3. 成长对比：vstack 上下分屏 ──────────────────────
  if (useCompare && input.compare) {
    const half = Math.floor(HEIGHT / 2);
    inputs.push("-loop", "1", "-t", plan.compare.toFixed(3), "-i", input.compare.earliestFile);
    const topIndex = index; index += 1;
    inputs.push("-loop", "1", "-t", plan.compare.toFixed(3), "-i", input.compare.latestFile);
    const bottomIndex = index; index += 1;
    // 两幅各占半屏，必须分别预缩到 720×640 —— vstack 要求输入等宽。
    filters.push(`[${topIndex}:v]scale=${WIDTH}:${half}:force_original_aspect_ratio=increase,crop=${WIDTH}:${half},setsar=1,${drawtext(`第 ${input.compare.earliestDay} 天`, { size: 34, y: "h-60" })}[cmpTop]`);
    filters.push(`[${bottomIndex}:v]scale=${WIDTH}:${half}:force_original_aspect_ratio=increase,crop=${WIDTH}:${half},setsar=1,${drawtext(`第 ${input.compare.latestDay} 天`, { size: 34, y: "h-60" })}[cmpBottom]`);
    const gapLine = input.compare.gapDays > 0 ? `这中间过了 ${input.compare.gapDays} 天` : "同一天的两张";
    filters.push([
      "[cmpTop][cmpBottom]vstack=inputs=2",
      "setsar=1",
      `drawbox=x=0:y=(ih-96)/2:w=iw:h=96:color=black@0.5:t=fill`,
      drawtext(gapLine, { size: 36, y: "(h-36)/2" }),
      `fade=t=in:st=0:d=${FADE_SECONDS.toFixed(2)}`,
      `fade=t=out:st=${Math.max(0, plan.compare - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS.toFixed(2)}`,
    ].join(",") + "[sCmp]");
    labels.push("[sCmp]");
  }

  // ── 4. 数据卡：逐行淡入 ──────────────────────────────
  inputs.push("-f", "lavfi", "-i", `color=c=#14251c:s=${WIDTH}x${HEIGHT}:d=${plan.closing.toFixed(3)}:r=30`);
  const closingIndex = index; index += 1;
  const lines: Array<[string, number]> = [
    [`${input.counts.photos} 张照片`, 0.32],
    [`${input.counts.works} 件作品`, 0.46],
    [`${input.counts.interactions} 次互动`, 0.60],
  ];
  const closingParts = [`[${closingIndex}:v]setsar=1`, drawtext(`${input.petName} 的 ${input.year}`, { size: 44, y: "h*0.16" })];
  lines.forEach(([text, position], order) => {
    // 逐行淡入 = 按时间点依次 enable。第 order 行在 closing 的 order/3 处出现。
    const from = (plan.closing / (lines.length + 1)) * order;
    closingParts.push(drawtext(text, { size: 52, y: `h*${position.toFixed(2)}`, from, to: plan.closing }));
  });
  closingParts.push(drawtext(`陪伴${input.memorial ? "了" : "第"} ${input.companionDays} 天`, { size: 30, y: "h*0.80" }));
  closingParts.push(`fade=t=out:st=${Math.max(0, plan.closing - FADE_SECONDS).toFixed(2)}:d=${FADE_SECONDS.toFixed(2)}`);
  filters.push(closingParts.join(",") + "[sEnd]");
  labels.push("[sEnd]");

  const filterComplex = `${filters.join(";")};${labels.join("")}concat=n=${labels.length}:v=1:a=0[vout]`;
  const args = ["-y", ...inputs, "-filter_complex", filterComplex, "-map", "[vout]",
    "-t", plan.total.toFixed(3), "-r", "30", "-c:v", "libx264", "-pix_fmt", "yuv420p", "-movflags", "+faststart", input.outputFile];
  return { args, plan, segmentCount: labels.length };
}
