import "server-only";

import sharp from "sharp";

import { escapeXml } from "@/server/memorial/album";
import type { AnnualAggregate } from "@/server/annual/aggregate";

/**
 * 年度报告长图。
 *
 * 原实现是纯计数 SVG：几个大数字 + 一句「这一年，我们认真生活过」，**没有任何照片**。
 * 那句话把宠物名字换掉仍然成立，按任务书的判定方法它就是无效文案。
 *
 * 现在的结构：封面（陪伴天数 + 主图）→ 三张真实照片带日期与「第 N 天」
 * → 数据条（照片/作品/互动计数）→ 年初 vs 年末的跨度。
 * 每个数字都可核对，每张照片都是用户自己的。
 *
 * 仍是单张长图而不是 PDF：年度报告的用途是**分享**（获客物追求可传播），
 * 与纪念册（付费物追求可保存）刚好相反。见任务书「交付形态优先级」的分层说明。
 */

const WIDTH = 1080;

/** 报告里放几张照片。三张够撑起叙事，再多长图会长到没人滑到底 */
export const REPORT_PHOTOS = 3;

type Palette = { paper: string; ink: string; accent: string; muted: string; hot: string };

const PALETTE: Palette = { paper: "#edf8f2", ink: "#14251c", accent: "#216844", muted: "#53645b", hot: "#f56643" };

function dataUri(object: { body: Uint8Array; contentType: string }) {
  const type = object.contentType.startsWith("image/") ? object.contentType : "image/jpeg";
  return `data:${type};base64,${Buffer.from(object.body).toString("base64")}`;
}

/**
 * 按字数折行成 tspan。
 *
 * SVG 的 `<text>` 不折行，超出部分被静默裁掉；`foreignObject` 在 librsvg 下
 * 整块消失（纪念册那边踩过，见 `memorial/album.ts`）。所以自己折。
 */
function textBlock(text: string, x: number, y: number, options: { size: number; fill: string; lineHeight: number; charsPerLine: number; maxLines: number }) {
  const lines: string[] = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    for (let index = 0; index < paragraph.length; index += options.charsPerLine) {
      lines.push(paragraph.slice(index, index + options.charsPerLine));
      if (lines.length >= options.maxLines) break;
    }
    if (lines.length >= options.maxLines) break;
  }
  if (!lines.length) return "";
  const spans = lines.map((line, index) => `<tspan x="${x}" dy="${index ? options.lineHeight : 0}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" fill="${options.fill}" font-family="serif" font-size="${options.size}">${spans}</text>`;
}

export type ReportPhoto = { body: Uint8Array; contentType: string; day: number; date: string };

export type ReportInput = {
  aggregate: AnnualAggregate;
  /** 已按 aggregate.photos 顺序取到字节的照片，最多 REPORT_PHOTOS 张 */
  photos: ReportPhoto[];
};

/**
 * 报告的 SVG。抽出来便于单测断言内容，不必光栅化。
 */
export function buildReportSvg(input: ReportInput) {
  const { aggregate, photos } = input;
  const petName = aggregate.petName || "我们";
  const year = aggregate.year;

  /*
   * 版面高度。封面照给到 320 高（原 240 太扁，主图看着像一条色带），
   * 照片块 760 = 图 580 + 文字区 180 —— 文字区留够，否则说明文字会贴到下一张图上。
   */
  const coverPhotoHeight = 320;
  const coverHeight = 470 + coverPhotoHeight + 90;
  const photoImageHeight = 580;
  const photoHeight = photoImageHeight + 180;
  const statsHeight = 480;
  const spanHeight = aggregate.pair ? 240 : 0;
  const height = coverHeight + photos.length * photoHeight + statsHeight + spanHeight + 160;

  const clips: string[] = [];
  const body: string[] = [];

  // ── 封面 ──────────────────────────────────────────────
  body.push(`<text x="80" y="130" fill="${PALETTE.accent}" font-family="sans-serif" font-size="34" letter-spacing="6">PETBABY · ${year}</text>`);
  body.push(`<text x="80" y="250" fill="${PALETTE.ink}" font-family="serif" font-size="82">${escapeXml(`${petName}的 ${year}`)}</text>`);
  /*
   * 陪伴天数是这份报告里最不可替代的一个数：它只属于这个用户。
   * 纪念场景用过去式「陪伴了」，且不递增（截止日已在 aggregate 里封口）。
   */
  if (aggregate.companionDays > 0) {
    // 纪念场景过去式；数字在上、说明在下，说明句要能独立读通（「天的陪伴」而非「天，陪伴了」）。
    const caption = aggregate.memorialSince ? "天的陪伴" : "天，一起走过来";
    body.push(`<text x="80" y="360" fill="${PALETTE.hot}" font-family="serif" font-size="120">${aggregate.companionDays}</text>`);
    body.push(`<text x="80" y="424" fill="${PALETTE.muted}" font-family="sans-serif" font-size="32">${escapeXml(caption)}</text>`);
  }
  if (photos[0]) {
    clips.push(`<clipPath id="cover"><rect x="80" y="470" width="920" height="${coverPhotoHeight}" rx="14"/></clipPath>`);
    body.push(`<image href="${dataUri(photos[0])}" x="80" y="470" width="920" height="${coverPhotoHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#cover)"/>`);
  }

  // ── 照片段：每张带真实日期与「第 N 天」 ────────────────
  photos.forEach((photo, index) => {
    const top = coverHeight + index * photoHeight;
    const clipId = `p${index}`;
    clips.push(`<clipPath id="${clipId}"><rect x="80" y="${top}" width="920" height="${photoImageHeight}" rx="14"/></clipPath>`);
    body.push(`<image href="${dataUri(photo)}" x="80" y="${top}" width="920" height="${photoImageHeight}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`);
    // 文字基线相对图片底边定位，不用 photoHeight 反推 —— 后者改了间距就会错位。
    body.push(`<text x="80" y="${top + photoImageHeight + 56}" fill="${PALETTE.ink}" font-family="serif" font-size="40">第 ${photo.day} 天</text>`);
    body.push(`<text x="80" y="${top + photoImageHeight + 100}" fill="${PALETTE.muted}" font-family="sans-serif" font-size="26">${escapeXml(photo.date)}</text>`);
  });

  // ── 数据条：真实计数 ─────────────────────────────────
  const statsTop = coverHeight + photos.length * photoHeight;
  const stats: Array<[number, string, string]> = [
    [aggregate.counts.photos, "张照片被好好收藏", PALETTE.hot],
    [aggregate.counts.works, "件作品让日常有了新身份", PALETTE.accent],
    [aggregate.counts.interactions, "次互动让回忆继续发光", "#e0a52b"],
  ];
  stats.forEach(([value, label, color], index) => {
    const top = statsTop + index * 150;
    body.push(`<text x="80" y="${top + 90}" fill="${color}" font-family="serif" font-size="96">${value}</text>`);
    body.push(`<text x="80" y="${top + 132}" fill="${PALETTE.muted}" font-family="sans-serif" font-size="28">${escapeXml(label)}</text>`);
  });

  // ── 跨度：年初 vs 年末 ───────────────────────────────
  if (aggregate.pair) {
    const top = statsTop + statsHeight;
    const gap = aggregate.pair.gapDays;
    const line = gap > 0
      ? `从 ${aggregate.pair.earliest.date} 到 ${aggregate.pair.latest.date}，这中间过了 ${gap} 天`
      : `${aggregate.pair.earliest.date} 这一天`;
    body.push(`<path d="M80 ${top}h920" stroke="${PALETTE.accent}" stroke-width="3"/>`);
    body.push(textBlock(line, 80, top + 80, { size: 32, fill: PALETTE.ink, lineHeight: 48, charsPerLine: 26, maxLines: 3 }));
  }

  body.push(`<text x="80" y="${height - 60}" fill="${PALETTE.muted}" font-family="sans-serif" font-size="26">${escapeXml(`属于你和${petName}的 ${year}`)}</text>`);

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${WIDTH}" height="${height}"><rect width="${WIDTH}" height="${height}" fill="${PALETTE.paper}"/><defs>${clips.join("")}</defs>${body.join("")}</svg>`;
}

/**
 * 预览版：叠一条水印。
 *
 * 保留原实现的做法（在 `</svg>` 前插一组元素）而不是重新排版 ——
 * 水印必须压在内容之上，且预览与正式版的版面要完全一致，
 * 否则用户解锁后会发现「我买到的和我看到的不一样」。
 */
export function withPreviewWatermark(svg: string) {
  const height = Number(/height="(\d+)"/.exec(svg)?.[1] || 1920);
  const band = Math.round(height * 0.42);
  return svg.replace("</svg>", `<g opacity=".82"><rect x="80" y="${band}" width="920" height="120" rx="20" fill="${PALETTE.ink}"/><text x="540" y="${band + 76}" text-anchor="middle" font-size="38" fill="#fff" font-family="sans-serif">PETBABY 免费预览 · 解锁高清版</text></g></svg>`);
}

/** 长图转 PNG。SVG 直接下发时微信内置浏览器与部分客户端渲染不一致 */
export async function rasterizeReport(svg: string) {
  return new Uint8Array(await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer());
}
