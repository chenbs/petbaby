/** Build a compact contact sheet for the three second-pass master candidates. */
import { access, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const roundArgument = process.argv.find((item) => item.startsWith("--round="));
const ROUND = Number(roundArgument?.slice("--round=".length) || 9);
if (![2, 3, 4, 5, 6, 7, 8, 9, 10, 11].includes(ROUND)) throw new Error(`Unknown round ${ROUND}`);
const CANDIDATE_ROOT = path.join(import.meta.dirname, "out", "reference-v1", `remediation-20260819-round${ROUND}`, "master-candidates");
const OUTPUT = path.join(ROOT, ".tmp", "master-candidates-contact.png");
const require = createRequire(path.resolve(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");

const round2Items = [
  ["巨物法相海报", "animal-giant-law-poster_shepherd-dog_9x16_stylebridge-v04.png"],
  ["20 偷鱼大作战", "fish-chase_owner-f01_tuxedo-cat_9x16_v03.png"],
  ["14 同宠大小分身", "mini-companion_abyssinian-cat_9x16_v05.png"],
];
const round3Items = [
  ["20 偷鱼大作战", "fish-chase_owner-f01_tuxedo-cat_9x16_v04.png"],
  ["14 同宠大小分身", "mini-companion_abyssinian-cat_9x16_v06.png"],
];
const round4Items = [
  ["14 同宠大小分身", "mini-companion_abyssinian-cat_9x16_v07.png"],
];
const round5Items = [
  ["14 同宠大小分身 · 德牧", "mini-companion_german-shepherd-dog_9x16_v08.png"],
];
const round6Items = [
  ["14 同宠大小分身 · 豹猫", "mini-companion_bengal-cat_9x16_v09.png"],
];
const round7Items = [
  ["14 同宠大小分身 · 豹猫 · 微提亮", "mini-companion_bengal-cat_9x16_v10.png"],
];
const round8Items = [
  ["14 同宠大小分身 · 豹猫 · 柔和对比", "mini-companion_bengal-cat_9x16_v11.png"],
];
const round9Items = [
  ["14 同宠大小分身 · 缅因猫", "mini-companion_maine-coon-cat_9x16_v12.png"],
];
const round10Items = [
  ["14 同宠大小分身 · 缅因猫 · 原始效果图重建", "mini-companion_maine-coon-cat_9x16_v13.png"],
];
const round11Items = [
  ["流体珐琅猫神兽 · 原始效果图 + 布偶猫", "animal-enamel-cat-beast_ragdoll-cat_9x16_v03.png"],
  ["玻璃爪印特写 · 原始效果图 + 泰迪", "animal-glass-paw-portrait_toy-poodle-dog_9x16_v03.png"],
  ["古风剑客宠物二 · 原始效果图 + 阿比西尼亚猫", "animal-sword-cat-alt_silver-abyssinian-cat_9x16_v03.png"],
];
const itemsByRound = { 2: round2Items, 3: round3Items, 4: round4Items, 5: round5Items, 6: round6Items, 7: round7Items, 8: round8Items, 9: round9Items, 10: round10Items, 11: round11Items };
const items = itemsByRound[ROUND]
  .map(([title, filename]) => ({ title, path: path.join(CANDIDATE_ROOT, filename) }));

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

for (const item of items) await access(item.path);
await mkdir(path.dirname(OUTPUT), { recursive: true });

const cardWidth = 360;
const imageWidth = 330;
const imageHeight = 586;
const labelHeight = 56;
const gap = 18;
const top = 66;
const width = items.length * cardWidth + (items.length + 1) * gap;
const height = top + imageHeight + labelHeight + gap;
const composites = [];

const header = Buffer.from(`<svg width="${width}" height="${top}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#141a20"/><text x="18" y="28" fill="#ffffff" font-size="20" font-family="Arial, Microsoft YaHei, sans-serif">冻结母版第 ${ROUND} 轮微调候选</text><text x="18" y="50" fill="#aebac5" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">${items.length} 张待视觉确认，仅包含本轮需重做项目</text></svg>`);
composites.push({ input: header, left: 0, top: 0 });

for (const [index, item] of items.entries()) {
  const image = await sharp(item.path, { failOn: "error" })
    .resize(imageWidth, imageHeight, { fit: "contain", background: "#f4f6f7" })
    .png()
    .toBuffer();
  const label = Buffer.from(`<svg width="${cardWidth}" height="${labelHeight}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#202a33"/><text x="12" y="34" fill="#ffffff" font-size="16" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(item.title)}</text></svg>`);
  const left = gap + index * (cardWidth + gap);
  composites.push({ input: image, left: left + 15, top });
  composites.push({ input: label, left, top: top + imageHeight });
}

await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 224, g: 229, b: 233, alpha: 1 },
  },
}).composite(composites).png({ compressionLevel: 9 }).toFile(OUTPUT);

console.log(`Generated ${path.relative(ROOT, OUTPUT).replaceAll("\\", "/")}`);
