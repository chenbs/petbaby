import { describe, expect, it } from "vitest";
import sharp from "sharp";

import { REPORT_PHOTOS, buildReportSvg, rasterizeReport, withPreviewWatermark } from "@/server/annual/report";
import type { AnnualAggregate } from "@/server/annual/aggregate";

async function jpeg() {
  const body = await sharp({ create: { width: 300, height: 220, channels: 3, background: { r: 120, g: 140, b: 160 } } }).jpeg().toBuffer();
  return { body: new Uint8Array(body), contentType: "image/jpeg" };
}

function aggregate(overrides: Partial<AnnualAggregate> = {}): AnnualAggregate {
  return {
    year: 2025,
    petId: "p",
    petName: "年糕",
    anchor: "2024-01-01",
    companionDays: 731,
    counts: { photos: 128, works: 9, shares: 5, pets: 2, interactions: 42 },
    photos: [],
    ...overrides,
  } as AnnualAggregate;
}

async function photos(count: number) {
  const base = await jpeg();
  return Array.from({ length: count }, (_, index) => ({ ...base, day: 20 + index * 170, date: `2025-0${index + 1}-15` }));
}

describe("buildReportSvg", () => {
  /**
   * 验收标准：报告包含用户的真实照片，不是纯计数卡片。
   * 原实现一张照片都没有。
   */
  it("嵌入真实照片，每张带「第 N 天」与拍摄日期", async () => {
    const svg = buildReportSvg({ aggregate: aggregate(), photos: await photos(3) });
    // 3 张照片段 + 1 张封面复用 photos[0] = 4 处引用
    expect(svg.match(/data:image\/jpeg;base64,/g)).toHaveLength(4);
    expect(svg).toContain("第 20 天");
    expect(svg).toContain("第 190 天");
    expect(svg).toContain("2025-01-15");
  });

  /**
   * 验收标准：数字都能核对。
   * 判定方法：把宠物名字换掉，句子仍成立的文案就是无效的 ——
   * 所以原来的「这一年，我们认真生活过」必须不在。
   */
  it("计数与陪伴天数进版面，无效文案已删除", async () => {
    const svg = buildReportSvg({ aggregate: aggregate(), photos: await photos(3) });
    expect(svg).toContain("731");
    expect(svg).toContain("128");
    expect(svg).toContain("9");
    expect(svg).toContain("42");
    expect(svg).toContain("年糕的 2025");
    expect(svg).not.toContain("这一年，我们认真生活过");
  });

  it("纪念场景用过去式，不说仍在继续", async () => {
    const normal = buildReportSvg({ aggregate: aggregate(), photos: await photos(1) });
    const memorial = buildReportSvg({ aggregate: aggregate({ memorialSince: "2025-05-01T00:00:00.000Z" }), photos: await photos(1) });
    expect(normal).toContain("天，一起走过来");
    expect(memorial).toContain("天的陪伴");
    expect(memorial).not.toContain("一起走过来");
  });

  it("有跨度时给出年初到年末的天数", async () => {
    const svg = buildReportSvg({
      aggregate: aggregate({
        pair: {
          earliest: { date: "2025-01-20", day: 20 } as never,
          latest: { date: "2025-12-26", day: 360 } as never,
          gapDays: 340,
        },
      }),
      photos: await photos(2),
    });
    expect(svg).toContain("340");
    expect(svg).toContain("2025-01-20");
  });

  /** 一张照片都取不到时仍要产出合法 SVG（调用方决定是否拦） */
  it("没有照片时不崩，产出合法 SVG", () => {
    const svg = buildReportSvg({ aggregate: aggregate(), photos: [] });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).not.toContain("data:image");
    expect(svg).not.toContain("NaN");
  });

  it("陪伴天数为 0 时不显示天数块", () => {
    const svg = buildReportSvg({ aggregate: aggregate({ companionDays: 0, petName: undefined }), photos: [] });
    expect(svg).not.toContain("一起走过来");
    // 没有宠物名时退回「我们」，不留空字符串
    expect(svg).toContain("我们的 2025");
  });

  it("照片张数上限是 3", () => {
    expect(REPORT_PHOTOS).toBe(3);
  });

  it("引号不被吞掉（复用纪念册的 escapeXml）", async () => {
    const svg = buildReportSvg({ aggregate: aggregate({ petName: '"年糕"' }), photos: await photos(1) });
    expect(svg).toContain("&quot;年糕&quot;");
  });
});

describe("withPreviewWatermark", () => {
  /** 预览与正式版版面必须一致，否则用户解锁后会发现「买到的和看到的不一样」 */
  it("只叠水印，不改版面尺寸", async () => {
    const svg = buildReportSvg({ aggregate: aggregate(), photos: await photos(3) });
    const preview = withPreviewWatermark(svg);
    const size = (input: string) => /width="(\d+)" height="(\d+)"/.exec(input)?.slice(1, 3);
    expect(size(preview)).toEqual(size(svg));
    expect(preview).toContain("解锁高清版");
    expect(svg).not.toContain("解锁高清版");
  });
});

describe("rasterizeReport", () => {
  it("产出真 PNG，宽度 1080", async () => {
    const png = await rasterizeReport(buildReportSvg({ aggregate: aggregate(), photos: await photos(2) }));
    const metadata = await sharp(Buffer.from(png)).metadata();
    expect(metadata.format).toBe("png");
    expect(metadata.width).toBe(1080);
    expect(metadata.height).toBeGreaterThan(1500);
  }, 60_000);
});
