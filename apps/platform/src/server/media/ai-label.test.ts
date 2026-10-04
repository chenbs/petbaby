import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { AI_NOTICE_TEXT, aiLabelMetadata, applyAiMetadata, needsAiLabel } from "@/server/media/ai-label";

/*
 * AI 生成内容标识（《标识办法》第四、五条）。
 *
 * 2026-09 口径：文件像素不画任何可见标记，只写隐式元数据；
 * 可见提示由小程序界面蒙层承担（文案由服务端下发）。
 * 这一组把「谁需要标识」「像素不被改动」「元数据确实写入」钉住。
 */

async function solidPng(width = 512, height = 512) {
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 240, g: 240, b: 240 } } }).png().toBuffer(),
  );
}

describe("标识适用范围", () => {
  /*
   * **只有实际经过生成合成模型的产物需要标识。**
   *
   * 给排版类/视频类打「AI 生成」是错误标注：既误导用户（以为自己的照片
   * 被 AI 改过），又不必要地损害观感。法规要求标识生成合成内容，
   * 不是标识所有输出。
   */
  it("image-api 需要标识", () => {
    expect(needsAiLabel({ generator: { type: "image-api", template: "ai-portrait-v1" } })).toBe(true);
  });

  it.each([
    ["html-template", "id-card-v1"],
    ["ffmpeg", "memory-film-v1"],
    ["h5-theme", "stardust-v1"],
    ["report", "annual-v1"],
  ] as const)("%s 不需要标识", (type, template) => {
    expect(needsAiLabel({ generator: { type, template } })).toBe(false);
  });
});

describe("隐式标识元数据（第五条）", () => {
  it("含生成合成属性、服务提供者与内容编号三项", () => {
    const metadata = aiLabelMetadata("work-123");
    // 第五条要求的三项
    expect(metadata.ImageDescription).toMatch(/AI-generated|生成合成/);
    expect(metadata.Software).toBe("PETBABY");
    expect(metadata.Artist).toContain("work-123");
  });
});

describe("只写元数据，不改像素", () => {
  async function rawPixels(body: Uint8Array) {
    return sharp(Buffer.from(body)).raw().toBuffer();
  }

  it("产出仍是可解析的图片，尺寸不变", async () => {
    const source = await solidPng(600, 400);
    const output = await applyAiMetadata(source, "work-1");
    const metadata = await sharp(Buffer.from(output)).metadata();
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(400);
  });

  it("像素与原图逐字节一致（图上没有任何可见标记）", async () => {
    const source = await solidPng(512, 512);
    const output = await applyAiMetadata(source, "work-1");
    expect((await rawPixels(output)).equals(await rawPixels(source))).toBe(true);
  });

  it("界面蒙层文案由服务端统一提供", () => {
    expect(AI_NOTICE_TEXT).toBe("该内容由AI生成");
  });
});
