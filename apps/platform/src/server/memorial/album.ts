import "server-only";

import sharp from "sharp";
import { PDFDocument, rgb } from "pdf-lib";

import { daysSince } from "@/domain/companion";

/**
 * 纪念册。
 *
 * 原实现是一张 SVG：纯色底 + 标题 + 正文，**完全没有用户的照片**，而 PL-20 定价 29.9。
 * 纪念场景是付费意愿最高、最不比价的一段，粗糙比缺失更伤人。
 *
 * 现在的形态是多页 PDF：封面 → 照片页（每页 1–2 张，配 storySections 的分段文字）→ 结尾页。
 * 选 PDF 而不是长图，因为纪念册的交付形态应当是**可长期保存的文件**
 * （任务书「交付形态优先级」：实物 > 可长期保存的文件 > 分享链接 > 一张图）。
 *
 * 排版模式沿用 `server/generators/svg.ts` 的 `time-album-v1`：照片以
 * base64 data URI 嵌进 SVG，再由 sharp 光栅化。不重写一套排版。
 *
 * ## 纪念线全局约束（改这个文件前必读）
 *
 * 无弹窗、无推销、无热度榜。文案不得出现感叹号、不得替用户表达悲伤。
 * 陪伴天数是**过去式且不递增**（「陪伴了 N 天」），截止日取纪念空间创建时间。
 */

/** 页面尺寸。A4 竖版按 150dpi 取整，打印与屏幕看都够用 */
const PAGE_WIDTH = 1240;
const PAGE_HEIGHT = 1754;

/** 每页最多放 2 张照片 —— 再多单张就小到看不清脸 */
const PHOTOS_PER_PAGE = 2;

type Palette = { ink: string; paper: string; accent: string; muted: string };

/**
 * 三套主题的配色。
 *
 * 底色是浅的纸色而不是深色：纪念册是要打印、要翻看的东西，
 * 深底大面积油墨在纸上发闷，且照片压在深底上显得更暗。
 */
const PALETTES: Record<string, Palette> = {
  stardust: { ink: "#1b2436", paper: "#f4f1e8", accent: "#4a5a7a", muted: "#6b7385" },
  forest: { ink: "#1c2b23", paper: "#f0f3ec", accent: "#3f5c48", muted: "#61705f" },
  dawn: { ink: "#3a2723", paper: "#faf1e6", accent: "#8a5b45", muted: "#7d6355" },
};

export type AlbumPhoto = { body: Uint8Array; contentType: string };
export type AlbumSection = { title: string; body: string };

export type AlbumInput = {
  petName: string;
  title: string;
  story: string;
  theme: string;
  sections: AlbumSection[];
  photos: AlbumPhoto[];
  /** 起算日（生日 / 到家日 / 建档日），用于封面的陪伴天数 */
  anchor?: string;
  /** 截止日：纪念空间创建时间。缺失时不给天数，见 companion.ts 的说明 */
  memorialSince?: string;
};

/**
 * XML 转义。
 *
 * 原实现是 `replace(/[<>&'"]/g, "")` —— **直接删掉**特殊字符，
 * 用户故事里的引号会被吃掉（「他总是"喵"一声」变成「他总是喵一声」）。
 * 纪念册里的每个字都是用户自己写的，不能悄悄改。
 *
 * 单引号不转义成 `&apos;`：XML 1.0 里属性外的 `'` 是合法字符，
 * 而这里所有用户文本都落在元素内容或 `foreignObject` 里。
 */
export function escapeXml(value: unknown) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function dataUri(photo: AlbumPhoto) {
  const type = photo.contentType.startsWith("image/") ? photo.contentType : "image/jpeg";
  return `data:${type};base64,${Buffer.from(photo.body).toString("base64")}`;
}

/**
 * 按字数折行。
 *
 * SVG 的 `<text>` 不会自动折行，超出的部分直接被裁掉（页面上表现为「故事只显示了半句」）。
 * `foreignObject` 能折行，但 librsvg（sharp 的后端）对它的支持不完整，
 * 结果是**整块文字静默消失** —— 原实现的 story 正是放在 foreignObject 里。
 * 所以这里自己折行成多个 `<tspan>`。
 *
 * 按字符数而不是像素宽度：中文等宽，够准；西文会偏保守一点，不至于溢出。
 */
function wrap(text: string, charsPerLine: number, maxLines: number) {
  const lines: string[] = [];
  for (const paragraph of String(text || "").split(/\r?\n/)) {
    if (!paragraph.trim()) { lines.push(""); continue; }
    for (let index = 0; index < paragraph.length; index += charsPerLine) {
      lines.push(paragraph.slice(index, index + charsPerLine));
      if (lines.length >= maxLines) return lines;
    }
  }
  return lines.slice(0, maxLines);
}

function textBlock(text: string, x: number, y: number, options: { size: number; fill: string; lineHeight: number; charsPerLine: number; maxLines: number }) {
  const lines = wrap(text, options.charsPerLine, options.maxLines);
  if (!lines.length) return "";
  const spans = lines.map((line, index) => `<tspan x="${x}" dy="${index ? options.lineHeight : 0}">${escapeXml(line)}</tspan>`).join("");
  return `<text x="${x}" y="${y}" fill="${options.fill}" font-family="serif" font-size="${options.size}">${spans}</text>`;
}

async function rasterize(svg: string) {
  return sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
}

/**
 * 封面：宠物名 + 陪伴天数 + 封面照。
 *
 * 天数只在有截止日时出现。没有截止日就不给数字 —— 一个每天还在涨的
 * 「陪伴了 N 天」对已经失去的用户是冒犯（见 companion.ts）。
 */
function coverSvg(input: AlbumInput, palette: Palette, cover?: AlbumPhoto) {
  const days = input.anchor && input.memorialSince ? daysSince(input.anchor, input.memorialSince) : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
    <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${palette.paper}"/>
    <defs><clipPath id="coverClip"><rect x="170" y="470" width="900" height="760" rx="12"/></clipPath></defs>
    <text x="170" y="230" fill="${palette.muted}" font-family="sans-serif" font-size="24" letter-spacing="6">PETBABY · 纪念册</text>
    <text x="170" y="340" fill="${palette.ink}" font-family="serif" font-size="76">${escapeXml(input.petName)}</text>
    <text x="170" y="400" fill="${palette.accent}" font-family="serif" font-size="34">${escapeXml(input.title)}</text>
    ${cover ? `<image href="${dataUri(cover)}" x="170" y="470" width="900" height="760" preserveAspectRatio="xMidYMid slice" clip-path="url(#coverClip)"/>` : ""}
    ${days > 0 ? `<text x="170" y="1330" fill="${palette.ink}" font-family="serif" font-size="40">陪伴了 ${days} 天</text>` : ""}
    <text x="170" y="${PAGE_HEIGHT - 150}" fill="${palette.muted}" font-family="sans-serif" font-size="22">安静记住，不开放留言</text>
  </svg>`;
}

/**
 * 照片页。每页 1–2 张，配对应的 storySections 分段文字。
 *
 * 分段与照片页一一对应而不是全塞在一页：用户写的是「片段」，
 * 配着当时的照片读才有意义。
 */
function photoPageSvg(photos: AlbumPhoto[], section: AlbumSection | undefined, palette: Palette, pageNumber: number) {
  const single = photos.length === 1;
  /*
   * 单张时给到 1180 高（近 3:4，接近手机照片的原比例），两张时各 560。
   * 之前单张只有 900，页面下方留出一条 300px 的空白带 —— 一本卖 29.9 的
   * 册子不该有这种「没排完」的观感。
   */
  const height = single ? 1180 : 560;
  const top = 190;
  const clips: string[] = [];
  const images: string[] = [];
  photos.forEach((photo, index) => {
    const y = top + index * (height + 60);
    const clipId = `clip-${pageNumber}-${index}`;
    clips.push(`<clipPath id="${clipId}"><rect x="150" y="${y}" width="940" height="${height}" rx="12"/></clipPath>`);
    images.push(`<image href="${dataUri(photo)}" x="150" y="${y}" width="940" height="${height}" preserveAspectRatio="xMidYMid slice" clip-path="url(#${clipId})"/>`);
  });
  // 文字紧跟在最后一张照片下方，不用写死的 y —— 单张与两张的照片底边不同高。
  const photoBottom = top + photos.length * height + (photos.length - 1) * 60;
  const textTop = photoBottom + 70;
  const sectionTitle = section?.title?.trim()
    ? `<text x="150" y="${textTop}" fill="${palette.ink}" font-family="serif" font-size="38">${escapeXml(section.title)}</text>`
    : "";
  const sectionBody = section?.body?.trim()
    ? textBlock(section.body, 150, textTop + (sectionTitle ? 60 : 0), { size: 27, fill: palette.accent, lineHeight: 44, charsPerLine: 34, maxLines: single ? 4 : 5 })
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
    <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${palette.paper}"/>
    <defs>${clips.join("")}</defs>
    ${images.join("")}
    ${sectionTitle}${sectionBody}
    <text x="${PAGE_WIDTH - 150}" y="${PAGE_HEIGHT - 110}" text-anchor="end" fill="${palette.muted}" font-family="sans-serif" font-size="20">${pageNumber}</text>
  </svg>`;
}

/**
 * 故事页：`story` 整段。分段多到照片页放不下时，剩下的也落到这里。
 *
 * 文字块**按行数垂直居中**而不是从页顶开始排：故事通常只有两三行，
 * 顶部对齐会得到「一页几乎全空、文字孤零零挂在上边」的版面。
 */
function storyPageSvg(text: string, palette: Palette, pageNumber: number) {
  const lineHeight = 52;
  const lines = wrap(text, 32, 26);
  const blockHeight = Math.max(1, lines.length) * lineHeight;
  const top = Math.max(260, (PAGE_HEIGHT - blockHeight) / 2);
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
    <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${palette.paper}"/>
    <path d="M150 ${top - 90}h120" stroke="${palette.accent}" stroke-width="3"/>
    ${textBlock(text, 150, top, { size: 29, fill: palette.ink, lineHeight, charsPerLine: 32, maxLines: 26 })}
    <text x="${PAGE_WIDTH - 150}" y="${PAGE_HEIGHT - 110}" text-anchor="end" fill="${palette.muted}" font-family="sans-serif" font-size="20">${pageNumber}</text>
  </svg>`;
}

/** 结尾页。只陈述事实，不替用户表达悲伤，不用感叹号 */
function closingSvg(input: AlbumInput, palette: Palette) {
  const days = input.anchor && input.memorialSince ? daysSince(input.anchor, input.memorialSince) : 0;
  const fact = days > 0 ? `你们一起过了 ${days} 天` : "这些是你们一起的日子";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}">
    <rect width="${PAGE_WIDTH}" height="${PAGE_HEIGHT}" fill="${palette.paper}"/>
    <text x="${PAGE_WIDTH / 2}" y="${PAGE_HEIGHT / 2 - 30}" text-anchor="middle" fill="${palette.ink}" font-family="serif" font-size="42">${escapeXml(fact)}</text>
    <text x="${PAGE_WIDTH / 2}" y="${PAGE_HEIGHT / 2 + 40}" text-anchor="middle" fill="${palette.muted}" font-family="serif" font-size="26">${escapeXml(input.photos.length)} 张照片收在这里</text>
    <text x="${PAGE_WIDTH / 2}" y="${PAGE_HEIGHT - 150}" text-anchor="middle" fill="${palette.muted}" font-family="sans-serif" font-size="20" letter-spacing="4">PETBABY · MEMORIAL ALBUM</text>
  </svg>`;
}

/**
 * 生成多页纪念册 PDF。
 *
 * @returns PDF 字节。页数 = 1 封面 + ceil(照片数 / 2) 照片页 + 可选故事页 + 1 结尾页
 */
export async function renderMemorialAlbum(input: AlbumInput): Promise<Uint8Array> {
  const pages = buildPages(input);
  const pdf = await PDFDocument.create();
  pdf.setTitle(`${input.petName} · ${input.title}`);
  pdf.setProducer("PETBABY");
  for (const svg of pages) {
    const png = await rasterize(svg);
    const image = await pdf.embedPng(png);
    const page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
    // 光栅化尺寸就是页面尺寸，1:1 铺满，不缩放。
    page.drawRectangle({ x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT, color: rgb(1, 1, 1) });
    page.drawImage(image, { x: 0, y: 0, width: PAGE_WIDTH, height: PAGE_HEIGHT });
  }
  return new Uint8Array(await pdf.save());
}

/** 页面 SVG 列表。抽出来便于单测断言页序与内容，不必解析 PDF */
export function buildPages(input: AlbumInput): string[] {
  const palette = PALETTES[input.theme] || PALETTES.stardust;
  const pages: string[] = [coverSvg(input, palette, input.photos[0])];

  let pageNumber = 2;
  for (let index = 0; index < input.photos.length; index += PHOTOS_PER_PAGE) {
    const group = input.photos.slice(index, index + PHOTOS_PER_PAGE);
    const section = input.sections[Math.floor(index / PHOTOS_PER_PAGE)];
    pages.push(photoPageSvg(group, section, palette, pageNumber));
    pageNumber += 1;
  }

  /*
   * 照片页只能消化前 ceil(照片数 / 2) 个分段，多出来的分段与 story 正文
   * 一起落到故事页 —— 用户写了的东西不能因为照片不够就丢掉。
   */
  const consumedSections = Math.ceil(input.photos.length / PHOTOS_PER_PAGE);
  const leftover = input.sections.slice(consumedSections)
    .map((section) => [section.title, section.body].filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n");
  const storyText = [input.story, leftover].filter((part) => part && part.trim()).join("\n\n");
  if (storyText.trim()) {
    pages.push(storyPageSvg(storyText, palette, pageNumber));
    pageNumber += 1;
  }

  pages.push(closingSvg(input, palette));
  return pages;
}
