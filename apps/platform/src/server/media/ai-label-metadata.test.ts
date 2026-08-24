import sharp from "sharp";
import { describe, expect, it } from "vitest";

import { plugins } from "@/plugins/registry";
import { applyAiLabel, needsAiLabel } from "@/server/media/ai-label";

/*
 * 隐式标识（《标识办法》第五条）的**实际写入**验证。
 *
 * 单列一个文件是因为技术方案 §11 把它列为「可能需要换实现」的风险项：
 * sharp 对 PNG 的 EXIF 支持不如 JPEG，写不进去就要改 XMP 或 tEXt 块。
 * 这一组用来回答「到底写进去了没有」，而不是「代码里调了 withMetadata 没有」。
 */
describe("隐式标识写入 PNG", () => {
  it("EXIF 段真实存在且含三项要求内容", async () => {
    const base = await sharp({ create: { width: 512, height: 512, channels: 3, background: { r: 250, g: 250, b: 250 } } })
      .png()
      .toBuffer();
    const labeled = await applyAiLabel(new Uint8Array(base), "work-verify-1");
    const metadata = await sharp(Buffer.from(labeled)).metadata();

    expect(metadata.exif, "PNG 未写入 EXIF —— 需改 XMP 或 tEXt 块").toBeTruthy();
    const raw = Buffer.from(metadata.exif as Buffer).toString("latin1");
    // 第五条：服务者名称、内容编号、生成合成属性
    expect(raw).toContain("PETBABY");
    expect(raw).toContain("work-verify-1");
    expect(raw).toMatch(/AI-generated/);
  }, 60_000);
});

/*
 * V1-1-3/4：标识范围。用真实 registry 而不是构造对象 ——
 * 要验的正是「线上这 7 个玩法里，哪些会被打标」。
 */
describe("标识范围对齐真实 registry", () => {
  it("只有 image-api 类玩法需要标识", () => {
    const labeled = plugins.filter((plugin) => needsAiLabel(plugin)).map((plugin) => plugin.id);
    expect(labeled).toEqual(["pl-10"]);
  });
});
