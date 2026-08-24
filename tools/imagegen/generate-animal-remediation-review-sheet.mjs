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

const TEMPLATE_IDS = new Set([
  "animal-ink-scratch-portrait",
  "animal-watercolor-cat-closeup",
  "animal-fantasy-double-exposure"
]);
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
    <text x="12" y="42" fill="#aebdca" font-size="11" font-family="Arial, sans-serif">${escapeXml(detail)}</text>
  </svg>`);
}

async function buildCard(file, title, detail) {
  const image = await sharp(file, { failOn: "error" })
    .resize(CARD_WIDTH - 20, IMAGE_HEIGHT - 20, {
      fit: "contain",
      background: { r: 243, g: 246, b: 248, alpha: 1 }
    })
    .extend({
      top: 10,
      bottom: 10,
      left: 10,
      right: 10,
      background: { r: 243, g: 246, b: 248, alpha: 1 }
    })
    .png()
    .toBuffer();
  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  }).composite([
    { input: image, top: 0, left: 0 },
    { input: labelSvg(title, detail), top: IMAGE_HEIGHT, left: 0 }
  ]).png().toBuffer();
}

const jobs = animalJobs.filter((job) => TEMPLATE_IDS.has(job.templateId));
const width = CARD_WIDTH * 3 + GAP * 4;
const height = CARD_HEIGHT * jobs.length + GAP * (jobs.length + 1);
const composites = [];

for (let row = 0; row < jobs.length; row += 1) {
  const job = jobs[row];
  const oldVersion = job.templateId === "animal-fantasy-double-exposure" ? "theme-reset-v01" : "stylebridge-v02";
  const newVersion = {
    "animal-ink-scratch-portrait": "stylebridge-v05",
    "animal-watercolor-cat-closeup": "stylebridge-v03",
    "animal-fantasy-double-exposure": "theme-reset-v02"
  }[job.templateId];
  const cards = await Promise.all([
    buildCard(job.effectReferencePath, job.title, "效果参考图"),
    buildCard(candidatePath(job, oldVersion), job.title, `上一版 ${oldVersion}`),
    buildCard(candidatePath(job, newVersion), job.title, newVersion)
  ]);
  for (let column = 0; column < cards.length; column += 1) {
    composites.push({
      input: cards[column],
      left: GAP + column * (CARD_WIDTH + GAP),
      top: GAP + row * (CARD_HEIGHT + GAP)
    });
  }
}

await mkdir(REVIEW_ROOT, { recursive: true });
const output = path.join(REVIEW_ROOT, "remediation-round-03-comparison.png");
await sharp({
  create: {
    width,
    height,
    channels: 4,
    background: { r: 225, g: 231, b: 236, alpha: 1 }
  }
}).composite(composites).png().toFile(output);
console.log(path.relative(ROOT, output));
