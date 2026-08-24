import { describe, expect, it } from "vitest";

import {
  DEFAULT_VIDEO_DURATION,
  FADE_SECONDS,
  MAX_PHOTOS,
  MIN_PHOTO_SECONDS,
  VIDEO_DURATION_OPTIONS,
  isVideoDuration,
  maxPhotosFor,
  normalizeDuration,
  perPhotoSeconds,
  shortestDurationFor,
} from "@/domain/video-duration";

describe("video duration", () => {
  it("三档的张数上限：10 秒 ≤10 张，20/30 秒 ≤20 张", () => {
    expect(maxPhotosFor(10)).toBe(10);
    expect(maxPhotosFor(20)).toBe(MAX_PHOTOS);
    expect(maxPhotosFor(30)).toBe(MAX_PHOTOS);
  });

  /**
   * 整个时长功能的核心不变量：任一档取满张数时，单张停留仍不低于下限，
   * 且明显高于两段 fade 之和 —— 否则画面刚淡入完就开始淡出，观感是黑场。
   * （10 秒 ÷ 20 张 = 0.5 秒 < 0.9 秒 正是被修掉的缺陷。）
   */
  it("任一档取满张数时，单张停留不低于下限且明显高于两段 fade", () => {
    for (const option of VIDEO_DURATION_OPTIONS) {
      const perPhoto = perPhotoSeconds(option, maxPhotosFor(option));
      expect(perPhoto).toBeGreaterThanOrEqual(MIN_PHOTO_SECONDS);
      // 余量至少 0.1 秒：floor(10/0.9)=11 张时只多 9 毫秒，那种「刚好合规」不算数。
      expect(perPhoto).toBeGreaterThan(FADE_SECONDS * 2 + 0.05);
    }
  });

  it("下限留了余量，不是紧贴两段 fade", () => {
    expect(MIN_PHOTO_SECONDS).toBeGreaterThan(FADE_SECONDS * 2);
  });

  it("单张停留 = 总时长 ÷ 张数，张数为 0 时按 1 张算（纯色兜底片）", () => {
    expect(perPhotoSeconds(20, 8)).toBeCloseTo(2.5, 10);
    expect(perPhotoSeconds(30, 20)).toBeCloseTo(1.5, 10);
    expect(perPhotoSeconds(10, 0)).toBe(10);
  });

  it("normalizeDuration 把库里的历史值/脏值归到三档", () => {
    expect(normalizeDuration(10)).toBe(10);
    expect(normalizeDuration("30")).toBe(30);
    expect(normalizeDuration(undefined)).toBe(DEFAULT_VIDEO_DURATION);
    expect(normalizeDuration(null)).toBe(DEFAULT_VIDEO_DURATION);
    expect(normalizeDuration(15)).toBe(DEFAULT_VIDEO_DURATION);
    expect(normalizeDuration("abc")).toBe(DEFAULT_VIDEO_DURATION);
  });

  it("isVideoDuration 只认三档", () => {
    expect(isVideoDuration(10)).toBe(true);
    expect(isVideoDuration(20)).toBe(true);
    expect(isVideoDuration(30)).toBe(true);
    expect(isVideoDuration(15)).toBe(false);
    expect(isVideoDuration(0)).toBe(false);
  });

  /** 不让用户选时长的入口（互动页导出、纪念视频）取最短可容纳档，不无脑取最长 */
  it("shortestDurationFor 取能容下张数的最短档", () => {
    expect(shortestDurationFor(1)).toBe(10);
    expect(shortestDurationFor(10)).toBe(10);
    expect(shortestDurationFor(11)).toBe(20);
    expect(shortestDurationFor(20)).toBe(20);
    // 超过最长档的容量时给最长档，由入口校验去拒绝，不在这里抛。
    expect(shortestDurationFor(999)).toBe(30);
  });

  it("缺省档在三档之内", () => {
    expect(VIDEO_DURATION_OPTIONS).toContain(DEFAULT_VIDEO_DURATION);
  });
});
