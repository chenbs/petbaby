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

/*
 * 宠物证件（id-card-v1，2026-10-26 重做）：纯 SVG 排版 + sharp 栅格化，零外部成本。
 * 版式：爪印底纹 → 色带标题（中英）→ 圆角大头照 → 字段区（姓名 / 种类 / 性别 / 生日 / 签发）→ 印章 → 机读码行。
 * 四种证件各有一套配色与一句趣味条款；全套证件把同一张卡缩到一半排成 2×2。
 * 字体写 Noto Sans CJK SC（镜像里装了 font-noto-cjk），缺字时由 fontconfig 回落。
 */
type IdCardTheme = { title: string; english: string; band: string; accent: string; card: string; ink: string; motto: string };

const ID_CARD_THEMES: Record<string, IdCardTheme> = {
  identity: { title: "宠物居民身份证", english: "PET IDENTITY CARD", band: "#1F6F5C", accent: "#E8A33D", card: "#FFFDF6", ink: "#1D2A26", motto: "允许在任何有阳光的地方长期居住" },
  passport: { title: "宠物护照", english: "PET PASSPORT", band: "#1E2C5A", accent: "#C9A24A", card: "#FBF8F0", ink: "#1B2340", motto: "可自由出入沙发、床铺与所有纸箱" },
  household: { title: "家庭户口页", english: "FAMILY REGISTER", band: "#8E2F25", accent: "#D9A441", card: "#FFF8EE", ink: "#3A1D18", motto: "户主：最爱我的人 · 关系：心肝宝贝" },
  vaccine: { title: "疫苗接种证", english: "VACCINATION RECORD", band: "#2F7D4F", accent: "#7AB85B", card: "#F7FBF4", ink: "#1D3324", motto: "打针不哭 · 已领取小零食奖励" },
};

const CJK = "Noto Sans CJK SC, Source Han Sans SC, PingFang SC, Microsoft YaHei, sans-serif";
const MONO = "DejaVu Sans Mono, Consolas, monospace";
const SPECIES_TEXT: Record<string, string> = { cat: "猫咪", dog: "狗狗", other: "小可爱" };
const GENDER_TEXT: Record<string, string> = { female: "女孩", male: "男孩", unknown: "保密" };

function idSerial(input: GeneratorInput) {
  return `${new Date().getFullYear()}-${input.pet.id.slice(0, 4).toUpperCase()}-PET`;
}

/** 照片先缩到 1000px 内再内嵌：原图可能好几 MB，全套证件还要嵌四次。 */
async function idCardPhoto(input: GeneratorInput) {
  const object = input.photos[0].object;
  try {
    const body = await sharp(Buffer.from(object.body)).rotate().resize(1000, 1000, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 86 }).toBuffer();
    return `data:image/jpeg;base64,${body.toString("base64")}`;
  } catch {
    return embeddedImage(object);
  }
}

/** 一张证件，坐标系固定 936×1200；全套证件用 scale 缩放复用。uid 区分同一 SVG 里多张卡的 defs id。 */
function idCardPanel(input: GeneratorInput, type: string, photo: string, uid: string) {
  const theme = ID_CARD_THEMES[type] || ID_CARD_THEMES.identity;
  const pet = input.pet;
  const authority = pet.species === "cat" ? "猫猫管理局" : "好朋友管理局";
  const name = escapeXml(pet.name);
  const nameSize = pet.name.length > 8 ? 46 : pet.name.length > 5 ? 56 : 68;
  const dateLabel = pet.dateType === "got_home" ? "到家" : "生日";
  const dateText = pet.birthday ? escapeXml(pet.birthday.replaceAll("-", ".")) : "保密";
  const serial = idSerial(input);
  const mrz = escapeXml(`PET<CN<<${serial.replaceAll("-", "<")}<<${(pet.species || "other").toUpperCase()}<<<<<<`);
  const field = (x: number, y: number, label: string, value: string) =>
    `<text x="${x}" y="${y}" fill="${theme.band}" font-family="${CJK}" font-size="22" font-weight="700" letter-spacing="2">${label}</text>`
    + `<text x="${x}" y="${y + 46}" fill="${theme.ink}" font-family="${CJK}" font-size="34" font-weight="700">${value}</text>`;
  return [
    `<defs>`,
    `<pattern id="wave-${uid}" width="72" height="36" patternUnits="userSpaceOnUse"><path d="M0 18 Q18 0 36 18 T72 18" fill="none" stroke="${theme.band}" stroke-opacity=".07" stroke-width="2"/></pattern>`,
    `<clipPath id="card-${uid}"><rect width="936" height="1200" rx="40"/></clipPath>`,
    `<clipPath id="photo-${uid}"><rect x="48" y="196" width="840" height="600" rx="28"/></clipPath>`,
    `</defs>`,
    `<g clip-path="url(#card-${uid})">`,
    `<rect width="936" height="1200" fill="${theme.card}"/>`,
    `<rect width="936" height="1200" fill="url(#wave-${uid})"/>`,
    `<rect width="936" height="156" fill="${theme.band}"/>`,
    `<rect y="156" width="936" height="8" fill="${theme.accent}"/>`,
    `<text x="48" y="80" fill="#FFFFFF" font-family="${CJK}" font-size="44" font-weight="900" letter-spacing="4">${theme.title}</text>`,
    `<text x="48" y="124" fill="#FFFFFF" fill-opacity=".72" font-family="${MONO}" font-size="22" letter-spacing="6">${theme.english}</text>`,
    `<g transform="translate(840 80)" fill="${theme.accent}"><ellipse cx="0" cy="18" rx="30" ry="24"/><circle cx="-28" cy="-16" r="11"/><circle cx="-9" cy="-30" r="11"/><circle cx="12" cy="-30" r="11"/><circle cx="30" cy="-16" r="11"/></g>`,
    `<rect x="40" y="188" width="856" height="616" rx="34" fill="${theme.accent}" fill-opacity=".35"/>`,
    `<image href="${photo}" x="48" y="196" width="840" height="600" preserveAspectRatio="xMidYMid slice" clip-path="url(#photo-${uid})"/>`,
    `<text x="48" y="868" fill="${theme.band}" font-family="${CJK}" font-size="22" font-weight="700" letter-spacing="2">姓名 NAME</text>`,
    `<text x="48" y="${878 + nameSize}" fill="${theme.ink}" font-family="${CJK}" font-size="${nameSize}" font-weight="900">${name}</text>`,
    field(48, 990, "种类", SPECIES_TEXT[pet.species] || "小可爱"),
    field(228, 990, "性别", GENDER_TEXT[pet.gender] || "保密"),
    field(408, 990, dateLabel, dateText),
    `<text x="48" y="1084" fill="${theme.ink}" fill-opacity=".72" font-family="${CJK}" font-size="24">签发：${authority} · 证号 ${serial}</text>`,
    `<text x="48" y="1118" fill="${theme.ink}" fill-opacity=".72" font-family="${CJK}" font-size="24">${escapeXml(theme.motto)}</text>`,
    `<g transform="translate(770 990) rotate(-14)">`,
    `<circle r="96" fill="none" stroke="#D2452E" stroke-opacity=".85" stroke-width="6"/><circle r="80" fill="none" stroke="#D2452E" stroke-opacity=".85" stroke-width="2"/>`,
    `<text y="-30" fill="#D2452E" fill-opacity=".85" font-family="${CJK}" font-size="24" font-weight="900" text-anchor="middle">${authority}</text>`,
    `<text y="22" fill="#D2452E" fill-opacity=".85" font-family="${CJK}" font-size="40" font-weight="900" text-anchor="middle">★认证★</text>`,
    `<text y="58" fill="#D2452E" fill-opacity=".85" font-family="${MONO}" font-size="18" text-anchor="middle">${new Date().getFullYear()} OFFICIAL</text>`,
    `</g>`,
    `<rect y="1140" width="936" height="60" fill="${theme.band}" fill-opacity=".08"/>`,
    `<text x="48" y="1180" fill="${theme.ink}" fill-opacity=".6" font-family="${MONO}" font-size="26" letter-spacing="3">${mrz}</text>`,
    `</g>`,
    `<rect width="936" height="1200" rx="40" fill="none" stroke="${theme.ink}" stroke-opacity=".18" stroke-width="3"/>`,
  ].join("");
}

function idCardBackdrop(width: number, height: number) {
  return `<defs><linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FDF6EC"/><stop offset="1" stop-color="#F1E6D6"/></linearGradient>`
    + `<pattern id="paws" width="180" height="180" patternUnits="userSpaceOnUse"><g fill="#C9A98A" fill-opacity=".14" transform="translate(60 70) rotate(-18)"><ellipse cx="0" cy="12" rx="20" ry="16"/><circle cx="-18" cy="-10" r="7"/><circle cx="-6" cy="-20" r="7"/><circle cx="8" cy="-20" r="7"/><circle cx="20" cy="-10" r="7"/></g></pattern></defs>`
    + `<rect width="${width}" height="${height}" fill="url(#bg)"/><rect width="${width}" height="${height}" fill="url(#paws)"/>`;
}

export async function generateIdCard(input: GeneratorInput) {
  const copy = localCopy(input.plugin.id, input.pet, input.task);
  const type = option(input, "documentType") || "identity";
  const photo = await idCardPhoto(input);
  const footer = (y: number) => `<text x="540" y="${y}" fill="#8A6E57" font-family="${CJK}" font-size="24" text-anchor="middle">麻麻抱我 · 宠物趣味写真</text>`;
  if (type === "bundle") {
    const panels = ["identity", "passport", "household", "vaccine"].map((item, index) =>
      `<g transform="translate(${48 + (index % 2) * 516} ${196 + Math.floor(index / 2) * 640}) scale(.5)">${idCardPanel(input, item, photo, item)}</g>`).join("");
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1640">${idCardBackdrop(1080, 1640)}`
      + `<text x="540" y="104" fill="#3A2A1E" font-family="${CJK}" font-size="58" font-weight="900" text-anchor="middle">${escapeXml(input.pet.name)} · 全套证件</text>`
      + `<text x="540" y="152" fill="#8A6E57" font-family="${CJK}" font-size="26" text-anchor="middle">身份证 · 护照 · 户口页 · 疫苗册</text>`
      + `${panels}${footer(1600)}</svg>`;
    return baseOutput(input, svg, `${input.pet.name}全套证件`, copy.subtitle);
  }
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440">${idCardBackdrop(1080, 1440)}<g transform="translate(72 100)">${idCardPanel(input, type, photo, "main")}</g>${footer(1388)}</svg>`;
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
