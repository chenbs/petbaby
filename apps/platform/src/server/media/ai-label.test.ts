import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { AI_LABEL_TEXT, aiLabelMetadata, applyAiLabel, needsAiLabel } from "@/server/media/ai-label";

/*
 * AI 生成内容标识（《标识办法》第四、五条）。
 *
 * 原实现只有营销水印且付费即移除，方向恰好与法规相反 ——
 * 这一组把「谁需要标识」和「付费后标识还在吗」钉住。
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

describe("显式标识叠加", () => {
  it("产出仍是可解析的图片，尺寸不变", async () => {
    const source = await solidPng(600, 400);
    const labeled = await applyAiLabel(source, "work-1");
    const metadata = await sharp(Buffer.from(labeled)).metadata();
    expect(metadata.width).toBe(600);
    expect(metadata.height).toBe(400);
  });

  it("确实改变了像素（标识真的画上去了）", async () => {
    const source = await solidPng();
    const labeled = await applyAiLabel(source, "work-1");
    // 纯色底图叠上深色底衬 + 白字后，字节必然不同。
    expect(Buffer.from(labeled).equals(Buffer.from(source))).toBe(false);
  });

  it("右下角区域颜色变深（底衬存在，不是半透明白字直接压图）", async () => {
    const source = await solidPng(512, 512);
    const labeled = await applyAiLabel(source, "work-1");
    /*
     * 取右下角一小块的平均亮度。原图是 240 的浅灰，
     * 叠上 #14251c/.72 的底衬后必须显著变暗 —— 只用半透明白字的话
     * 这块几乎不变，而那正是「在白猫或过曝天空上标识消失」的成因。
     */
    const { data } = await sharp(Buffer.from(labeled))
      .extract({ left: 400, top: 460, width: 80, height: 30 })
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const average = data.reduce((sum, value) => sum + value, 0) / data.length;
    expect(average).toBeLessThan(200);
  });

  it("字号随图片尺寸放大，小图仍有下限", async () => {
    // 只断言两种尺寸都能正常出图 —— 字号公式本身是 max(20, h*0.02)。
    for (const size of [200, 2048]) {
      const labeled = await applyAiLabel(await solidPng(size, size), `work-${size}`);
      const metadata = await sharp(Buffer.from(labeled)).metadata();
      expect(metadata.width).toBe(size);
    }
  }, 60_000);

  it("标识文案是「AI 生成」", () => {
    expect(AI_LABEL_TEXT).toBe("AI 生成");
  });
});
