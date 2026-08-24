import { mkdir } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { animalJobs } from "./animal-expansion-catalog.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const REVIEW_ROOT = path.join(OUTPUT_ROOT, "review");
const require = createRequire(path.join(ROOT, "apps", "platform", "package.json"));
const sharp = require("sharp");
const CARD_WIDTH = 360;
const IMAGE_HEIGHT = 560;
const LABEL_HEIGHT = 54;
const CARD_HEIGHT = IMAGE_HEIGHT + LABEL_HEIGHT;
const GAP = 20;

function candidatePath(job, version) {
  const ratio = expansionOutputSpecs[job.orientation].ratio;
  return path.join(CANDIDATE_ROOT, `${job.templateId}_${job.identityId}_${ratio}_${version}.png`);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function labelSvg(title, detail) {
  return Buffer.from(`<svg width="${CARD_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#17212b"/>
    <text x="12" y="22" fill="#ffffff" font-size="14" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(title)}</text>
    <text x="12" y="42" fill="#aebdca" font-size="11" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(detail)}</text>
  </svg>`);
}

async function buildCard(file, title, detail) {
  const image = await sharp(file, { failOn: "error" })
    .resize(CARD_WIDTH - 20, IMAGE_HEIGHT - 20, {
      fit: "contain",
      background: { r: 243, g: 246, b: 248, alpha: 1 }
    })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 243, g: 246, b: 248, alpha: 1 } })
    .png()
    .toBuffer();
  return sharp({
    create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).composite([
    { input: image, top: 0, left: 0 },
    { input: labelSvg(title, detail), top: IMAGE_HEIGHT, left: 0 }
  ]).png().toBuffer();
}

const watercolorJob = animalJobs.find((job) => job.templateId === "animal-watercolor-cat-closeup");
const doubleExposureJob = animalJobs.find((job) => job.templateId === "animal-fantasy-double-exposure");
if (!watercolorJob || !doubleExposureJob) throw new Error("pending animal jobs missing");
const rows = [
  {
    title: watercolorJob.title,
    cards: [
      [watercolorJob.effectReferencePath, "效果图 / 位置唯一权威"],
      [watercolorJob.identity.path, "身份图 / 属性唯一权威"],
      [candidatePath(watercolorJob, "stylebridge-v03"), "已冻结 / stylebridge-v03"]
    ]
  },
  {
    title: doubleExposureJob.title,
    cards: [
      [candidatePath(doubleExposureJob, "eastern-myth-v01"), "初版 / 未采用"],
      [candidatePath(doubleExposureJob, "eastern-myth-v03"), "替代版 / 未采用"],
      [candidatePath(doubleExposureJob, "eastern-myth-v02"), "已冻结 / eastern-myth-v02"]
    ]
  }
];
const width = CARD_WIDTH * 3 + GAP * 4;
const height = CARD_HEIGHT * rows.length + GAP * (rows.length + 1);
const composites = [];
for (let row = 0; row < rows.length; row += 1) {
  const cards = await Promise.all(rows[row].cards.map(([file, detail]) => buildCard(file, rows[row].title, detail)));
  for (let column = 0; column < cards.length; column += 1) {
    composites.push({ input: cards[column], left: GAP + column * (CARD_WIDTH + GAP), top: GAP + row * (CARD_HEIGHT + GAP) });
  }
}

await mkdir(REVIEW_ROOT, { recursive: true });
const output = path.join(REVIEW_ROOT, "final-approved-round-06-comparison.png");
await sharp({
  create: { width, height, channels: 4, background: { r: 225, g: 231, b: 236, alpha: 1 } }
}).composite(composites).png().toFile(output);
console.log(path.relative(ROOT, output));
