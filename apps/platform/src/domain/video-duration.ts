/**
 * 成片时长的口径，单一事实来源。
 *
 * 服务端校验（`server/video/service.ts`）、实际渲染（`server/video/ffmpeg.ts`）、
 * Web 端选择器（`components/video-create-client.tsx`）都从这里取，避免各写一份走散 ——
 * 小程序曾提示「每张约 1.5 秒」而服务端固定 2.4 秒，就是这类分歧。
 *
 * 放在 `domain/` 而不是 `server/`：它是纯函数、不 import server-only，
 * 客户端组件要用同一套上限，从 `server/` 导入会让 RSC 边界看起来是错的。
 * 小程序侧无法共享模块，`pages/video-create/video-create.js` 有一份对照实现，
 * 改这里的档位或上限要同步过去。
 */

/** 用户可选的三档总时长（秒）。20 张 × 2.4 秒 = 48 秒对小红书偏长，所以改为选总长 */
export const VIDEO_DURATION_OPTIONS = [10, 20, 30] as const;

export type VideoDurationSeconds = (typeof VIDEO_DURATION_OPTIONS)[number];

/** 缺省时长。历史项目没有这一列，迁移的 DEFAULT 与这里必须一致 */
export const DEFAULT_VIDEO_DURATION: VideoDurationSeconds = 20;

/**
 * 单侧淡入/淡出时长（秒）。
 *
 * 必须写成 `0.45` 而不是 `.45`：ffmpeg 6+ 拒绝把 `.45` 解析为时长
 * （`Unable to parse option value ".45" as duration`），filtergraph 初始化直接失败。
 * 生产镜像 `apk add ffmpeg` 装的正是 6.x。
 */
export const FADE_SECONDS = 0.45;

/**
 * 单张停留的下限（秒）。
 *
 * 硬下限是两段 fade 之和 0.9 秒，低于它画面大半时间在黑场 ——
 * 10 秒 ÷ 20 张 = 0.5 秒正是这种情况。但**不能直接取 0.9**：
 * `floor(10 / 0.9) = 11` 张时每张 0.909 秒，只比两段 fade 多 9 毫秒，
 * 完全淡入的那一瞬间就开始淡出，观感上仍然是黑场。
 *
 * 所以留出余量取整到 1 秒 —— 这也正好给出任务书定的三档上限：
 * 10 秒 ≤10 张、20 秒 ≤20 张、30 秒 ≤20 张（后者受 MAX_PHOTOS 约束）。
 */
export const MIN_PHOTO_SECONDS = 1;

/** `projectSchema` 的绝对张数上限，与照片选择器一致 */
export const MAX_PHOTOS = 20;

/**
 * 某档时长下最多能放几张照片。
 *
 * 10 秒 → 10 张（每张 1 秒，刚好高于 0.9 秒的黑场下限）
 * 20 / 30 秒 → 20 张（受 `MAX_PHOTOS` 而非黑场下限约束）
 */
export function maxPhotosFor(durationSeconds: number): number {
  const byFade = Math.floor(durationSeconds / MIN_PHOTO_SECONDS);
  return Math.max(1, Math.min(MAX_PHOTOS, byFade));
}

/** 单张停留时长 = 总时长 ÷ 张数。张数为 0 时按 1 张算，给纯色兜底片用 */
export function perPhotoSeconds(durationSeconds: number, photoCount: number): number {
  return durationSeconds / Math.max(1, photoCount);
}

/**
 * 传入值是否**已经是**三档数字之一。
 *
 * 刻意不做 `Number(value)` 转换：那样 `"30"` 会判真、随后被当 `VideoDurationSeconds`
 * 用，但值仍是字符串，`durationSeconds + 1` 之类会得到 `"301"`。
 * 需要接受字符串输入的场合走 `normalizeDuration`，它负责转换。
 */
export function isVideoDuration(value: unknown): value is VideoDurationSeconds {
  return typeof value === "number" && VIDEO_DURATION_OPTIONS.includes(value as VideoDurationSeconds);
}

/**
 * 能容下这么多张照片的**最短**档位。
 *
 * 用于不让用户选时长的入口（互动页导出、纪念视频）：既不能黑闪，也不该无脑取最长档
 * 把 3 张照片摊成 30 秒。张数超过最长档能容纳的量时返回最长档，
 * 由调用方或 `maxPhotosFor` 的入口校验去拒绝。
 */
export function shortestDurationFor(photoCount: number): VideoDurationSeconds {
  return VIDEO_DURATION_OPTIONS.find((option) => photoCount <= maxPhotosFor(option))
    ?? VIDEO_DURATION_OPTIONS[VIDEO_DURATION_OPTIONS.length - 1];
}

/**
 * 把任意来源的时长归一到三档之一，认不出就落到缺省档。
 *
 * 必须接受字符串：PostgreSQL 驱动可能把 integer 列作为字符串交回
 * （`jsonIdArray` 的注释记着同一类坑），jsonb 里的 config 值同理。
 * 归一化后一定是数字，下游可以直接参与算术。
 */
export function normalizeDuration(value: unknown): VideoDurationSeconds {
  const numeric = typeof value === "string" || typeof value === "number" ? Number(value) : Number.NaN;
  return isVideoDuration(numeric) ? numeric : DEFAULT_VIDEO_DURATION;
}
