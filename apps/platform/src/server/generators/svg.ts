import sharp from "sharp";

import { localCopy } from "@/server/generators/copy";
import type { GeneratorInput, GeneratorOutput } from "@/server/generators/types";
import { anchorOf, dayIndexOf } from "@/domain/companion";

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
  return `<g transform="translate(${x} ${y})"><rect width="${width}" height="${height}" rx="32" fill="#fff1b7" stroke="#14251c" stroke-width="5"/><rect width="${width}" height="100" rx="32" fill="#14251c"/><text x="36" y="65" fill="#fff" font-family="sans-serif" font-size="28" font-weight="700">PETBABY · ${title}</text><image href="${photo}" x="36" y="135" width="${width - 72}" height="${height - 310}" preserveAspectRatio="xMidYMid slice"/><text x="36" y="${height - 115}" fill="#216844" font-family="serif" font-size="44" font-weight="900">${escapeXml(input.pet.name)}</text><text x="36" y="${height - 65}" fill="#14251c" font-family="sans-serif" font-size="20">签发：${input.pet.species === "cat" ? "猫猫管理局" : "好朋友管理局"}</text></g>`;
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

export async function generateMoviePoster(input: GeneratorInput) {
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const style = option(input, "style") || "classic";
  const composition = option(input, "composition") || "portrait";
  const review = option(input, "review") || "一部关于零食、午睡和无条件陪伴的诚意之作";
  const palette = style === "hongkong" ? ["#e63d25", "#f4c941"] : style === "arthouse" ? ["#d8e8df", "#203b31"] : ["#101820", "#f56643"];
  const photos = input.photos.slice(0, 3).map((photo, index) => {
    if (composition === "closeup") return `<image href="${embeddedImage(photo.object)}" x="0" y="0" width="1080" height="1440" preserveAspectRatio="xMidYMid slice" opacity="${index ? 0 : 1}"/>`;
    const width = composition === "ensemble" ? 360 : index ? 300 : 780;
    const x = composition === "ensemble" ? index * 360 : index ? 780 : 0;
    return `<image href="${embeddedImage(photo.object)}" x="${x}" y="0" width="${width}" height="1440" preserveAspectRatio="xMidYMid slice" opacity="${index ? 0.78 : 1}"/>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect width="1080" height="1440" fill="${palette[0]}"/>${photos}<defs><linearGradient id="g" x2="0" y2="1"><stop offset="20%" stop-color="${palette[0]}" stop-opacity="0"/><stop offset="100%" stop-color="${palette[0]}" stop-opacity=".98"/></linearGradient></defs><rect width="1080" height="1440" fill="url(#g)"/><text x="64" y="1030" fill="${palette[1]}" font-family="serif" font-size="88" font-weight="900">${escapeXml(copy.title)}</text><text x="68" y="1100" fill="#fff" font-family="sans-serif" font-size="30">${escapeXml(copy.subtitle)}</text><text x="68" y="1190" fill="#fff" font-family="sans-serif" font-size="24">“${escapeXml(review)}”</text><text x="68" y="1320" fill="#fff" font-family="sans-serif" font-size="24" letter-spacing="8">NOW SHOWING · PETBABY PICTURES</text></svg>`;
  return baseOutput(input, svg, copy.title, copy.subtitle);
}

export async function generateTimeAlbum(input: GeneratorInput) {
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const theme = option(input, "theme") || "growth";
  const background = ({ growth: "#edf8f2", birthday: "#fff1b7", healing: "#e8f1ff", holiday: "#fff0ec" } as Record<string, string>)[theme] || "#edf8f2";
  const captions = stringArray(input, "pageCaptions");
  const width = 1080;
  const height = 520 + input.photos.length * 520;
  const photos = input.photos.map((photo, index) => {
    const x = index % 2 ? 420 : 70;
    const rotation = index % 2 ? 2 : -2;
    const caption = captions[index] || (index % 2 ? "一起发呆也很好" : "普通的一天，也在闪闪发光");
    return `<g transform="translate(${x} ${400 + index * 500}) rotate(${rotation})"><rect x="-15" y="-15" width="675" height="455" rx="22" fill="#fffef9"/><image href="${embeddedImage(photo.object)}" width="645" height="400" preserveAspectRatio="xMidYMid slice"/><text x="20" y="430" fill="#53645b" font-family="sans-serif" font-size="20">DAY ${String(index + 1).padStart(2, "0")} · ${escapeXml(caption)}</text></g>`;
  }).join("");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${background}"/><text x="70" y="130" fill="#14251c" font-family="serif" font-size="76" font-weight="900">${escapeXml(copy.title)}</text><text x="72" y="195" fill="#53645b" font-family="sans-serif" font-size="28">${escapeXml(copy.subtitle)}</text><path d="M70 245h940" stroke="#216844" stroke-width="4"/>${photos}<text x="540" y="${height - 70}" text-anchor="middle" fill="#216844" font-family="sans-serif" font-size="22">PETBABY · TIME ALBUM</text></svg>`;
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
  const sorted = [...input.photos].sort((left, right) => new Date(left.metadata.shotAt).getTime() - new Date(right.metadata.shotAt).getTime());
  const earliest = sorted[0];
  const latest = sorted[sorted.length - 1];
  const anchor = anchorOf({ birthday: input.pet.birthday, createdAt: input.pet.createdAt });
  const earliestDay = dayIndexOf(anchor, earliest.metadata.shotAt);
  const latestDay = dayIndexOf(anchor, latest.metadata.shotAt);
  const gap = Math.max(0, latestDay - earliestDay);
  const dateOf = (value: string) => new Date(value).toLocaleDateString("zh-CN");

  const panel = (photo: typeof earliest, x: number, day: number, label: string) => `
    <g>
      <clipPath id="gc${x}"><rect x="${x}" y="240" width="460" height="614" rx="14"/></clipPath>
      <image href="${embeddedImage(photo.object)}" x="${x}" y="240" width="460" height="614" preserveAspectRatio="xMidYMid slice" clip-path="url(#gc${x})"/>
      <text x="${x}" y="906" fill="#14251c" font-family="serif" font-size="34">第 ${day} 天</text>
      <text x="${x}" y="950" fill="#53645b" font-family="sans-serif" font-size="22">${escapeXml(label)}</text>
    </g>`;

  // 两张照片相隔 0 天（同一天拍的）时不说「相隔 0 天」，那句话没有信息量。
  const gapLine = gap > 0 ? `这中间过了 ${gap} 天` : "同一天的两张";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1080">
    <rect width="1080" height="1080" fill="#edf8f2"/>
    <text x="70" y="120" fill="#14251c" font-family="serif" font-size="60">${escapeXml(input.pet.name)}的变化</text>
    <text x="70" y="178" fill="#53645b" font-family="sans-serif" font-size="26">${escapeXml(gapLine)}</text>
    ${panel(earliest, 70, earliestDay, dateOf(earliest.metadata.shotAt))}
    ${panel(latest, 550, latestDay, dateOf(latest.metadata.shotAt))}
    <text x="540" y="1030" text-anchor="middle" fill="#216844" font-family="sans-serif" font-size="20" letter-spacing="4">PETBABY · GROWTH</text>
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
