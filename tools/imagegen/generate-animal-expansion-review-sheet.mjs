import { mkdir, access } from "node:fs/promises";
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
const CARD_WIDTH = 240;
const IMAGE_HEIGHT = 330;
const LABEL_HEIGHT = 74;
const CARD_HEIGHT = IMAGE_HEIGHT + LABEL_HEIGHT;
const GAP = 20;
const COLUMNS = 4;

async function exists(file) { try { await access(file); return true; } catch { return false; } }
function candidatePath(job) {
  const ratio = expansionOutputSpecs[job.orientation].ratio;
  return path.join(CANDIDATE_ROOT, `${job.templateId}_${job.identityId}_${ratio}_${job.version}.png`);
}
function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}
function labelSvg(job) {
  return Buffer.from(`<svg width="${CARD_WIDTH}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16202a"/><text x="12" y="24" fill="#ffffff" font-size="14" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(job.title)}</text><text x="12" y="46" fill="#b9c6d2" font-size="10" font-family="Arial, sans-serif">${escapeXml(job.templateId)} · 待审核</text><text x="12" y="64" fill="#8fa5b5" font-size="10" font-family="Arial, sans-serif">${escapeXml(job.entryId)} · ${job.orientation}</text></svg>`);
}
async function buildCard(job) {
  const image = await sharp(candidatePath(job), { failOn: "error" })
    .resize(CARD_WIDTH - 20, IMAGE_HEIGHT - 20, { fit: "contain", background: { r: 246, g: 248, b: 250, alpha: 1 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 246, g: 248, b: 250, alpha: 1 } })
    .png().toBuffer();
  return sharp({ create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: image, top: 0, left: 0 }, { input: labelSvg(job), top: IMAGE_HEIGHT, left: 0 }]).png().toBuffer();
}
async function buildSheet(name, jobs) {
  const available = [];
  for (const job of jobs) if (await exists(candidatePath(job))) available.push(job);
  if (!available.length) return;
  const rows = Math.ceil(available.length / COLUMNS);
  const width = COLUMNS * CARD_WIDTH + (COLUMNS + 1) * GAP;
  const height = rows * CARD_HEIGHT + (rows + 1) * GAP;
  const composites = [];
  for (let index = 0; index < available.length; index += 1) {
    const card = await buildCard(available[index]);
    composites.push({ input: card, left: GAP + (index % COLUMNS) * (CARD_WIDTH + GAP), top: GAP + Math.floor(index / COLUMNS) * (CARD_HEIGHT + GAP) });
  }
  const output = path.join(REVIEW_ROOT, `${name}-review.png`);
  await sharp({ create: { width, height, channels: 4, background: { r: 232, g: 237, b: 241, alpha: 1 } } }).composite(composites).png().toFile(output);
  console.log(`生成动物审核总览 ${path.relative(ROOT, output)}：${available.length}/${jobs.length}`);
}

await mkdir(REVIEW_ROOT, { recursive: true });
for (const entryId of [...new Set(animalJobs.map((job) => job.entryId))]) await buildSheet(entryId, animalJobs.filter((job) => job.entryId === entryId));
await buildSheet("all", animalJobs);
