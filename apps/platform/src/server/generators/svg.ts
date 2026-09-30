import sharp from "sharp";

import { localCopy } from "@/server/generators/copy";
import type { GeneratorInput, GeneratorOutput } from "@/server/generators/types";
import { anchorOf, dayIndexOf } from "@/domain/companion";
import { effectivePhotoDate, photoLocalDate } from "@/domain/photo-memory";
import { spanDaysBetween } from "@/domain/pricing";
import { generateMoviePoster } from "@/server/generators/movie-poster";

export { generateMoviePoster } from "@/server/generators/movie-poster";

function escapeXml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function option(input: GeneratorInput, key: string) {
  return typeof input.task.options[key] === "string" ? input.task.options[key] as string : undefined;
}

function stringArray(input: GeneratorInput, key: string) {
  const value = input.task.options[key];
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function embeddedImage(object: { body: Uint8Array; contentType: string }) {
  return `data:${object.contentType};base64,${Buffer.from(object.body).toString("base64")}`;
}

function baseOutput(input: GeneratorInput, svg: string, title: string, subtitle: string): GeneratorOutput {
  return {
    title,
    subtitle,
    serialNumber: `${new Date().getFullYear()}-${input.pet.id.slice(0, 4).toUpperCase()}-PET`,
    authority: input.pet.species === "cat" ? "猫猫管理局" : "好朋友管理局",
    files: [{ suffix: "svg", body: new TextEncoder().encode(svg), contentType: "image/svg+xml" }],
  };
}

function idCardPanel(input: GeneratorInput, type: string, x: number, y: number, width: number, height: number) {
  const labels: Record<string, string> = { identity: "居民身份证", passport: "宠物护照", household: "家庭户口本", vaccine: "疫苗接种证" };
  const photo = embeddedImage(input.photos[0].object);
  const title = labels[type] || labels.identity;
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="${height}" rx="32" fill="#fff1b7" stroke="#14251c" stroke-width="5"/><rect width="${width}" height="100" rx="32" fill="#14251c"/><text x="36" y="65" fill="#fff" font-family="sans-serif" font-size="28" font-weight="700">麻麻抱我 · ${title}</text><image href="${photo}" x="36" y="135" width="${width - 72}" height="${height - 310}" preserveAspectRatio="xMidYMid slice"/><text x="36" y="${height - 115}" fill="#216844" font-family="serif" font-size="44" font-weight="900">${escapeXml(input.pet.name)}</text><text x="36" y="${height - 65}" fill="#14251c" font-family="sans-serif" font-size="20">签发：${input.pet.species === "cat" ? "猫猫管理局" : "好朋友管理局"}</text></g>`;
}

export async function generateIdCard(input: GeneratorInput) {
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const type = option(input, "documentType") || "identity";
  if (type === "bundle") {
    const panels = ["identity", "passport", "household", "vaccine"].map((item, index) => idCardPanel(input, item, 50 + (index % 2) * 510, 180 + Math.floor(index / 2) * 730, 470, 660)).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1640"><rect width="1080" height="1640" fill="#edf8f2"/><text x="50" y="100" fill="#14251c" font-family="serif" font-size="64" font-weight="900">${escapeXml(input.pet.name)} · 四证套装</text>${panels}</svg>`;
    return baseOutput(input, svg, `${input.pet.name}四证套装`, copy.subtitle);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect width="1080" height="1440" fill="#edf8f2"/>${idCardPanel(input, type, 72, 120, 936, 1200)}</svg>`;
  return baseOutput(input, svg, copy.title, copy.subtitle);
}

export async function generateTimeAlbum(input: GeneratorInput) {
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const theme = option(input, "theme") || "growth";
  const themes: Record<string, { paper: string; accent: string; eyebrow: string; ornament: string }> = {
    growth: { paper: "#e4f2e7", accent: "#37735a", eyebrow: "MY LITTLE DAYS", ornament: '<path d="M869 109q53-69 106 0q-53 53-106 0ZM870 110q-31 57-80 70" fill="none" stroke="#37735a" stroke-width="5"/>' },
    birthday: { paper: "#fff0bb", accent: "#c95f53", eyebrow: "A DAY FOR YOU", ornament: '<circle cx="886" cy="102" r="15" fill="#c95f53"/><circle cx="948" cy="148" r="10" fill="#e8a965"/><path d="M810 80l22 26 25-20" fill="none" stroke="#c95f53" stroke-width="5"/>' },
    healing: { paper: "#e4eef8", accent: "#5879a2", eyebrow: "SOFT DAYS TOGETHER", ornament: '<path d="M800 117q65-52 130 0t130 0M816 160q59-43 118 0" fill="none" stroke="#5879a2" stroke-width="5" opacity=".6"/>' },
    holiday: { paper: "#f8e9e0", accent: "#b75f58", eyebrow: "OUR BRIGHTEST DAY", ornament: '<path d="M774 87q120 65 244-8M822 112l17 31 18-32M926 107l18 31 18-34" fill="none" stroke="#b75f58" stroke-width="5"/>' },
  };
  const visual = themes[theme] || themes.growth;
  const captions = stringArray(input, "pageCaptions");
  const photos = theme === "growth"
    ? [...input.photos].sort((a, b) => effectivePhotoDate(a.metadata).date.localeCompare(effectivePhotoDate(b.metadata).date))
    : input.photos;
  const placements = [
    { x: 72, y: 275, width: 446, height: 348, rotation: -2 },
    { x: 562, y: 305, width: 442, height: 348, rotation: 2 },
    { x: 254, y: 715, width: 570, height: 380, rotation: -1 },
  ];
  const pageHeight = 1250;
  const pageCount = Math.ceil(photos.length / 3);
  const height = pageCount * pageHeight;
  const pages = Array.from({ length: pageCount }, (_, pageIndex) => {
    const cards = photos.slice(pageIndex * 3, pageIndex * 3 + 3).map((photo, localIndex) => {
      const placement = placements[localIndex];
      const index = pageIndex * 3 + localIndex;
      const rawCaption = captions[index] || effectivePhotoDate(photo.metadata).date.replaceAll("-", ".");
      const caption = [...rawCaption].length > 15 ? [...rawCaption].slice(0, 14).join("") + "…" : rawCaption;
      const imageWidth = placement.width - 32;
      const imageHeight = placement.height - 65;
      return `<g transform="translate(${placement.x} ${placement.y}) rotate(${placement.rotation} ${placement.width / 2} ${placement.height / 2})"><rect x="-7" y="-7" width="${placement.width + 14}" height="${placement.height + 14}" fill="#d2d2cd" opacity=".35"/><rect width="${placement.width}" height="${placement.height}" fill="#fffefa"/><rect x="16" y="16" width="${imageWidth}" height="${imageHeight}" fill="#f2f2ee"/><image href="${embeddedImage(photo.object)}" x="16" y="16" width="${imageWidth}" height="${imageHeight}" preserveAspectRatio="xMidYMid meet"/><text x="22" y="${placement.height - 18}" fill="#53645b" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="19">${String(index + 1).padStart(2, "0")} · ${escapeXml(caption)}</text><rect x="${placement.width / 2 - 52}" y="-24" width="104" height="34" fill="${visual.accent}" opacity=".48"/></g>`;
    }).join("");
    const pageTitle = pageIndex === 0 ? copy.title : `${input.pet.name}的日子 · ${pageIndex + 1}`;
    const characters = [...pageTitle];
    const titleSize = characters.length > 32 ? 30 : characters.length > 13 ? 48 : 66;
    const lineLength = Math.floor(900 / titleSize);
    const titleLines = [characters.splice(0, lineLength).join(""), characters.splice(0, lineLength).join("")].filter(Boolean);
    const title = titleLines.map((line, index) => `<text x="68" y="${titleLines.length === 1 ? 184 : 157 + index * (titleSize + 10)}" fill="#243835" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="${titleSize}" font-weight="800">${escapeXml(line)}</text>`).join("");
    return `<g transform="translate(0 ${pageIndex * pageHeight})"><rect width="1080" height="${pageHeight}" fill="${visual.paper}"/><path d="M55 42h970M55 1208h970" stroke="${visual.accent}" stroke-opacity=".28" stroke-width="2"/><text x="70" y="94" fill="${visual.accent}" font-family="sans-serif" font-size="23" letter-spacing="4">${visual.eyebrow}</text>${title}${visual.ornament}${cards}<text x="540" y="1180" text-anchor="middle" fill="${visual.accent}" font-family="Noto Sans CJK SC,Microsoft YaHei,sans-serif" font-size="22">麻麻抱我 · 时间画册  ${pageIndex + 1}/${pageCount}</text></g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="${height}">${pages}</svg>`;
  const preview = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const output = baseOutput(input, svg, copy.title, copy.subtitle);
  output.files.push({ suffix: "png", body: new Uint8Array(preview), contentType: "image/png" });
  return output;
}

/**
 * 成长对比图：同一只宠物两个时间点并排 + 间隔天数。
 *
 * 属「积累」层，免费带水印，作分享钩子（任务书定价表）。
 * 它之所以不可替代不在于排版，而在于**间隔天数来自这个用户的真实档案** ——
 * 判定方法：把宠物名字换掉，如果句子仍然成立，这句文案就是无效的。
 * 「你们一起过了 743 天」成立不了，「多么温暖的时光」谁都能说。
 */
export async function generateGrowthCompare(input: GeneratorInput) {
  /*
   * 按拍摄时间排序，最早的在左。不能依赖 photoIds 的顺序 ——
   * 用户在选择器里点选的顺序与拍摄先后无关，排错了「成长」方向就是倒的。
   * `shotAt` 无 EXIF 时已由 mapPhoto 回落到上传时间，所以一定有值。
   */
  const sorted = [...input.photos].sort((left, right) => effectivePhotoDate(left.metadata).date.localeCompare(effectivePhotoDate(right.metadata).date));
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const anchor = anchorOf({ birthday: input.pet.birthday, createdAt: input.pet.createdAt });
  const earliestDate = effectivePhotoDate(earliest.metadata);
  const latestDate = effectivePhotoDate(latest.metadata);
  const earliestDay = dayIndexOf(anchor, earliestDate.date);
  const latestDay = dayIndexOf(anchor, latestDate.date);
  const gap = spanDaysBetween(new Date(`${earliestDate.date}T12:00:00`), new Date(`${latestDate.date}T12:00:00`));
  const dateOf = (photo: typeof earliest) => {
    const recorded = effectivePhotoDate(photo.metadata);
    return `${recorded.date} · ${recorded.source === "manual" ? "你设置的日期" : recorded.source === "exif" ? "照片里的拍摄时间" : "按上传时间记录"}`;
  };
  const dayOf = (photo: typeof earliest, day: number) => {
    const date = effectivePhotoDate(photo.metadata).date;
    return date < anchor || (input.pet.lifeStage === "memorial" && (!input.pet.memorialSince || date > photoLocalDate(input.pet.memorialSince))) ? "" : `第 ${day} 天`;
  };

  const panel = (photo: typeof earliest, x: number, day: number, label: string) => `
    <g>
      <clipPath id="gc${x}"><rect x="${x}" y="240" width="460" height="614" rx="14"/></clipPath>
      <image href="${embeddedImage(photo.object)}" x="${x}" y="240" width="460" height="614" preserveAspectRatio="xMidYMid slice" clip-path="url(#gc${x})"/>
      <text x="${x}" y="906" fill="#14251c" font-family="serif" font-size="34">${dayOf(photo, day)}</text>
      <text x="${x}" y="950" fill="#53645b" font-family="sans-serif" font-size="22">${escapeXml(label)}</text>
    </g>`;

  // 两张照片相隔 0 天（同一天拍的）时不说「相隔 0 天」，那句话没有信息量。
  const gapLine = gap > 0 ? `这中间过了 ${gap} 天` : "同一天的两张";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
    <rect width="1080" height="1080" fill="#edf8f2"/>
    <text x="70" y="120" fill="#14251c" font-family="serif" font-size="60">${escapeXml(input.pet.name)}的变化</text>
    <text x="70" y="178" fill="#53645b" font-family="sans-serif" font-size="26">${escapeXml(gapLine)}</text>
    ${panel(earliest, 70, earliestDay, dateOf(earliest))}
    ${panel(latest, 550, latestDay, dateOf(latest))}
    <text x="540" y="1030" text-anchor="middle" fill="#216844" font-family="sans-serif" font-size="20" letter-spacing="4">麻麻抱我 · 成长记录</text>
  </svg>`;
  const preview = await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer();
  const output = baseOutput(input, svg, `${input.pet.name}的变化`, gapLine);
  output.files.push({ suffix: "png", body: new Uint8Array(preview), contentType: "image/png" });
  return output;
}

export const generatorRegistry = {
  "id-card-v1": generateIdCard,
  "movie-poster-v1": generateMoviePoster,
  "time-album-v1": generateTimeAlbum,
  "growth-compare-v1": generateGrowthCompare,
};
