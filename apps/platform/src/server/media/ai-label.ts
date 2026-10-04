import "server-only";

import sharp from "sharp";

import type { PluginManifest } from "@/domain/models";

/*
 * AI 生成内容标识（《人工智能生成合成内容标识办法》，国信办通字〔2025〕2 号，2025-09-01 施行）。
 *
 * 2026-09 口径（方案见 docs/ui-refactor/2026-09-29-产品UIUX评审/去AI文案与取消水印实施方案.md）：
 *
 * | 层           | 做法                                                        |
 * | ------------ | ----------------------------------------------------------- |
 * | 文件像素     | **不画任何可见标记**（没有营销水印、没有「AI 生成」角标）   |
 * | 文件元数据   | 写隐式标识（第五条），这是文件层唯一的标识，**不能去**      |
 * | 小程序界面   | 生成结果底部叠「该内容由AI生成」蒙层，由服务端下发文案      |
 * | 保存原图     | 首次保存前确认用户自己的标识义务（第九条），日志 ≥ 6 个月   |
 *
 * 隐式元数据是微信等平台自动识别的依据，也是第十条禁止删除的对象。
 * 任何把 withMetadata 去掉的改动都会让文件层彻底失去标识。
 */

/** 小程序与 Web 界面蒙层文案。端上不写死，统一取服务端下发的这一份。 */
export const AI_NOTICE_TEXT = "该内容由AI生成";

/**
 * 只有实际经过生成合成模型的产物才需要标识（元数据 + 界面蒙层）。
 *
 * **这个判据不能放宽成「所有产物」**：
 * - `html-template` 是 SVG 模板套用用户原照片，照片是用户自己拍的，不是生成合成内容；
 * - `ffmpeg` 是模板合成，`05-tech-and-compliance.md` 明确「不用生成式视频模型」。
 *
 * 给它们标「AI 生成」是**错误标注** —— 既误导用户（以为自己的照片被 AI 改过），
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
 * 只写隐式元数据、不改像素，输出 PNG。
 *
 * 预览缩图等「在已写元数据的字节上再处理」的场景，sharp 默认会丢掉 EXIF，
 * 所以每次重新编码后都要再调用一次，而不是指望元数据自己跟过去。
 */
export async function applyAiMetadata(body: Uint8Array, contentId: string): Promise<Uint8Array> {
  return new Uint8Array(await sharp(Buffer.from(body)).withMetadata({ exif: { IFD0: aiLabelMetadata(contentId) } }).png().toBuffer());
}
