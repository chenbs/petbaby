import { mkdir, access } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { expansionJobs, expansionOutputSpecs, relativeToRoot } from "./reference-expansion-catalog.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../..", "apps/platform/package.json"));
const sharp = require("sharp");
const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "expansion");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const REVIEW_ROOT = path.join(OUTPUT_ROOT, "review");
const CARD_WIDTH = 240;
const IMAGE_HEIGHT = 330;
const LABEL_HEIGHT = 72;
const CARD_HEIGHT = IMAGE_HEIGHT + LABEL_HEIGHT;
const GAP = 20;
const COLUMNS = 4;
const COMPARISON_CARD_WIDTH = 500;
const COMPARISON_IMAGE_WIDTH = 230;
const COMPARISON_IMAGE_HEIGHT = 292;
const COMPARISON_HEADER_HEIGHT = 28;
const COMPARISON_CARD_HEIGHT = COMPARISON_HEADER_HEIGHT + COMPARISON_IMAGE_HEIGHT + LABEL_HEIGHT;
const COMPARISON_COLUMNS = 2;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function candidatePath(job) {
  const ratio = expansionOutputSpecs[job.orientation].ratio;
  return path.join(CANDIDATE_ROOT, `${job.templateId}_${job.identityId}_${ratio}_${job.version}.png`);
}

function labelSvg(job, width = CARD_WIDTH) {
  return Buffer.from(`<svg width="${width}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16202a"/><text x="12" y="24" fill="#ffffff" font-size="15" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(job.title)}</text><text x="12" y="47" fill="#b9c6d2" font-size="11" font-family="Arial, sans-serif">${escapeXml(job.templateId)} · 待用户审批</text><text x="12" y="64" fill="#8fa5b5" font-size="10" font-family="Arial, sans-serif">${escapeXml(job.entryId)} · ${job.orientation}</text></svg>`);
}

function comparisonHeaderSvg() {
  return Buffer.from(`<svg width="${COMPARISON_CARD_WIDTH}" height="${COMPARISON_HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#dfe5e9"/><text x="10" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">效果参考图</text><text x="260" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">自有候选母版</text></svg>`);
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

async function buildCard(job) {
  const source = candidatePath(job);
  const image = await sharp(source, { failOn: "error" })
    .resize(CARD_WIDTH - 20, IMAGE_HEIGHT - 20, { fit: "contain", background: { r: 246, g: 248, b: 250, alpha: 1 } })
    .extend({ top: 10, bottom: 10, left: 10, right: 10, background: { r: 246, g: 248, b: 250, alpha: 1 } })
    .png()
    .toBuffer();
  return sharp({ create: { width: CARD_WIDTH, height: CARD_HEIGHT, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } } })
    .composite([{ input: image, top: 0, left: 0 }, { input: labelSvg(job), top: IMAGE_HEIGHT, left: 0 }])
    .png()
    .toBuffer();
}

async function comparisonImage(source) {
  return sharp(source, { failOn: "error" })
    .resize(COMPARISON_IMAGE_WIDTH, COMPARISON_IMAGE_HEIGHT, {
      fit: "contain",
      background: { r: 246, g: 248, b: 250, alpha: 1 }
    })
    .png()
    .toBuffer();
}

async function buildComparisonCard(job) {
  const [effectReference, candidate] = await Promise.all([
    comparisonImage(job.effectReferencePath),
    comparisonImage(candidatePath(job))
  ]);
  return sharp({
    create: {
      width: COMPARISON_CARD_WIDTH,
      height: COMPARISON_CARD_HEIGHT,
      channels: 4,
      background: { r: 246, g: 248, b: 250, alpha: 1 }
    }
  }).composite([
    { input: comparisonHeaderSvg(), top: 0, left: 0 },
    { input: effectReference, top: COMPARISON_HEADER_HEIGHT, left: 10 },
    { input: candidate, top: COMPARISON_HEADER_HEIGHT, left: 260 },
    { input: labelSvg(job, COMPARISON_CARD_WIDTH), top: COMPARISON_HEADER_HEIGHT + COMPARISON_IMAGE_HEIGHT, left: 0 }
  ]).png().toBuffer();
}

async function buildSheet(name, jobs) {
  const available = [];
  for (const job of jobs) if (await exists(candidatePath(job))) available.push(job);
  if (!available.length) return null;
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
  console.log(`生成审核总览 ${relativeToRoot(output)}：${available.length}/${jobs.length}`);
  return output;
}

async function buildComparisonSheet(name, jobs) {
  const available = [];
  for (const job of jobs) {
    if (await exists(job.effectReferencePath) && await exists(candidatePath(job))) available.push(job);
  }
  if (!available.length) return null;
  const rows = Math.ceil(available.length / COMPARISON_COLUMNS);
  const width = COMPARISON_COLUMNS * COMPARISON_CARD_WIDTH + (COMPARISON_COLUMNS + 1) * GAP;
  const height = rows * COMPARISON_CARD_HEIGHT + (rows + 1) * GAP;
  const composites = [];
  for (let index = 0; index < available.length; index += 1) {
    const card = await buildComparisonCard(available[index]);
    composites.push({
      input: card,
      left: GAP + (index % COMPARISON_COLUMNS) * (COMPARISON_CARD_WIDTH + GAP),
      top: GAP + Math.floor(index / COMPARISON_COLUMNS) * (COMPARISON_CARD_HEIGHT + GAP)
    });
  }
  const output = path.join(REVIEW_ROOT, `${name}-comparison.png`);
  await sharp({ create: { width, height, channels: 4, background: { r: 232, g: 237, b: 241, alpha: 1 } } }).composite(composites).png().toFile(output);
  console.log(`生成对照审核图 ${relativeToRoot(output)}：${available.length}/${jobs.length}`);
  return output;
}

await mkdir(REVIEW_ROOT, { recursive: true });
const entryIds = [...new Set(expansionJobs.map((job) => job.entryId))];
for (const entryId of entryIds) {
  const jobs = expansionJobs.filter((job) => job.entryId === entryId);
  await buildSheet(entryId, jobs);
  await buildComparisonSheet(entryId, jobs);
}
await buildSheet("all", expansionJobs);
await buildComparisonSheet("all", expansionJobs);
