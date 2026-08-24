import "server-only";

import sharp from "sharp";

import type { PluginManifest } from "@/domain/models";

/*
 * AI 生成内容标识（《人工智能生成合成内容标识办法》，国信办通字〔2025〕2 号，2025-09-01 施行）。
 *
 * 与营销水印是**两件不同的事**，命运相反：
 *
 * | 类型          | 内容                          | 免费版 | 付费版   |
 * | ------------- | ----------------------------- | ------ | -------- |
 * | 营销水印      | PETBABY 免费预览 · 小程序码   | 有     | **移除** |
 * | AI 生成标识   | 「AI 生成」+ 元数据           | 有     | **保留** |
 *
 * 营销水印是用户付费买走的东西；AI 标识是法规要求，付费也不能去。
 * 原实现只有营销水印且付费即移除，方向恰好与第四条相反。
 */

/** 显式标识文案。第四条要求「在适当位置添加显著的提示标识」。 */
const LABEL_TEXT = "AI 生成";

/**
 * 只有实际经过生成合成模型的产物才需要标识。
 *
 * **这个判据不能放宽成「所有产物」**：
 * - `html-template` 是 SVG 模板套用用户原照片，照片是用户自己拍的，不是生成合成内容；
 * - `ffmpeg` 是模板合成，`05-tech-and-compliance.md` 明确「不用生成式视频模型」。
 *
 * 给它们打「AI 生成」是**错误标注** —— 既误导用户（以为自己的照片被 AI 改过），
 * 又不必要地损害观感。法规要求的是标识生成合成内容，不是标识所有输出。
 */
export function needsAiLabel(plugin: Pick<PluginManifest, "generator">): boolean {
  return plugin.generator.type === "image-api";
}

/**
 * 隐式标识（第五条）：文件元数据中的生成合成属性、服务提供者名称、内容编号。
 *
 * 返回值交给 sharp 的 `withMetadata({ exif: { IFD0: ... } })`。
 */
export function aiLabelMetadata(contentId: string): Record<string, string> {
  return {
    // 第五条列举的三项。ImageDescription / Software / Artist 是 IFD0 里
    // 通用阅读器都认的标准 tag，自定义 tag 多数工具读不出来。
    ImageDescription: "AI-generated content / 人工智能生成合成内容",
    Software: "PETBABY",
    Artist: `PETBABY:${contentId}`,
  };
}

/**
 * 标识底衬的默认取值。深绿黑 @0.72 —— 既有作品图沿用这一组，不要改动：
 * 换值会让历史图与新图的标识观感不一致，而标识的价值一部分来自「总是长一个样」。
 */
const DEFAULT_PLATE = { color: "#14251c", opacity: 0.72, textColor: "#ffffff" } as const;

/** 底衬规格。调用方可覆盖 —— 宠物小岛用 `AI_LABEL_PLATE`，见下方 `plate` 参数说明 */
export interface AiLabelPlate {
  color: string;
  opacity: number;
  textColor: string;
}

/**
 * 在图片上叠加显式 AI 标识。
 *
 * 三个不显然的决定：
 *
 * 1. **必须有深色底衬，不能只用半透明白字。** 白字压在亮背景（白猫、雪地、
 *    过曝天空）上等于没有标识，而「显著」是法条用词。这与官网那条
 *    「半透明层叠在图片上的必须按最坏帧实测」是同一个坑。
 * 2. **字号按图片高度比例算**（下限 20px）。固定字号在 1024px 图上勉强可见，
 *    在 2048px 图上会小到不算「显著」。
 * 3. **底衬取值可覆盖，但只能往「更深」的方向改。** 宠物小岛的画面比作品图更亮
 *    （明亮暖色调场景 + 雪档提亮），所以它传 `domain/island-weather.ts` 的
 *    `AI_LABEL_PLATE`：`#2A1F1F` @0.65，实算在纯白上让白字达到 5.04:1
 *    （≥0.62 才够 4.57:1，取 0.65 留余量）。那个值是照最坏画面算的 ——
 *    **最坏情况不是任一地表色，而是阳光高光或白猫身上的纯白像素**。
 *
 * @param plate 底衬规格。缺省用既有作品图那一组，不要为了统一而改动默认值。
 */
export async function applyAiLabel(body: Uint8Array, contentId: string, plate: AiLabelPlate = DEFAULT_PLATE): Promise<Uint8Array> {
  const image = sharp(Buffer.from(body));
  const metadata = await image.metadata();
  const width = metadata.width || 1024;
  const height = metadata.height || 1024;

  const fontSize = Math.max(20, Math.round(height * 0.02));
  const padding = Math.round(fontSize * 0.5);
  // 中文字符按字号等宽估算，比测量实际字宽省一次渲染，且宁可底衬略宽不能略窄。
  const boxWidth = fontSize * LABEL_TEXT.replace(/\s/g, "").length + padding * 2;
  const boxHeight = fontSize + padding * 2;
  const marginX = Math.round(width * 0.02);
  const marginY = Math.round(height * 0.02);

  const overlay = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><g transform="translate(${Math.max(0, width - boxWidth - marginX)} ${Math.max(0, height - boxHeight - marginY)})"><rect width="${boxWidth}" height="${boxHeight}" rx="${Math.round(fontSize * 0.3)}" fill="${plate.color}" fill-opacity="${plate.opacity}"/><text x="${padding}" y="${padding + fontSize * 0.82}" fill="${plate.textColor}" font-family="sans-serif" font-size="${fontSize}">${LABEL_TEXT}</text></g></svg>`;

  return new Uint8Array(
    await sharp(Buffer.from(body))
      .composite([{ input: Buffer.from(overlay), gravity: "northwest" }])
      .withMetadata({ exif: { IFD0: aiLabelMetadata(contentId) } })
      .png()
      .toBuffer(),
  );
}

export const AI_LABEL_TEXT = LABEL_TEXT;
export const AI_LABEL_DEFAULT_PLATE: AiLabelPlate = DEFAULT_PLATE;
