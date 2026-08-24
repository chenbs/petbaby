import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import {
  expansionJobs,
  expansionOutputSpecs,
  relativeToRoot,
} from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const REMEDIATION_ROOT = path.join(REFERENCE_ROOT, "pending-remediation-20260820");
const REVIEW_ROOT = path.join(REFERENCE_ROOT, "library-review");
const MASTER_INDEX_PATH = path.join(REFERENCE_ROOT, "masters", "index.json");
const PUBLIC_PREVIEW_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");
const require = createRequire(path.resolve(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");

const CARD_WIDTH = 500;
const FROZEN_CARD_WIDTH = 750;
const IMAGE_WIDTH = 230;
const IMAGE_HEIGHT = 292;
const HEADER_HEIGHT = 28;
const LABEL_HEIGHT = 82;
const CARD_HEIGHT = HEADER_HEIGHT + IMAGE_HEIGHT + LABEL_HEIGHT;
const GAP = 20;
const COLUMNS = 2;
const SHEET_HEADER_HEIGHT = 64;

const frozenEffectFallbacks = new Map();

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function resolveWorkspacePath(file) {
  if (!file) return null;
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

function escapeXml(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function versionFromMaster(item, metadata) {
  if (metadata.version) return metadata.version;
  if (metadata.revision?.version) return metadata.revision.version;
  const basename = path.parse(item.path).name;
  const match = basename.match(/_(reset-v\d+(?:-[a-z0-9-]+)?|stylebridge-v\d+|eastern-myth-v\d+|v\d+)$/i);
  return match?.[1] || "已登记版本";
}

function resolveFrozenEffectReference(item, metadata) {
  const direct = [
    metadata.derivedEffectReference?.source,
    metadata.upstreamEffectReference?.path,
    metadata.sourceEffectFile,
  ].find(Boolean);
  if (direct) return resolveWorkspacePath(direct);

  const effectInput = (metadata.inputs || []).find((input) => {
    const role = String(input.role || "").toLowerCase();
    return role.includes("third-party") && (
      role.includes("effect") ||
      role.includes("double-exposure") ||
      role.includes("reference")
    );
  });
  if (effectInput?.path) return resolveWorkspacePath(effectInput.path);
  return frozenEffectFallbacks.get(item.templateId) || null;
}

const pendingReviewSequences = new Map();

function pendingCandidatePath(job) {
  const ratio = expansionOutputSpecs[job.orientation].ratio;
  return path.join(
    REMEDIATION_ROOT,
    "candidates",
    `${job.templateId}_${job.identityId}_${ratio}_${job.version}.png`,
  );
}

function headerSvg(masterLabel) {
  return Buffer.from(`<svg width="${CARD_WIDTH}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#dfe5e9"/><text x="10" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">原始效果参考图</text><text x="260" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(masterLabel)}</text></svg>`);
}

function frozenHeaderSvg() {
  return Buffer.from(`<svg width="${FROZEN_CARD_WIDTH}" height="${HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#dfe5e9"/><text x="10" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">原始效果参考图</text><text x="260" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">最新小程序展示图</text><text x="510" y="19" fill="#34424d" font-size="12" font-family="Arial, Microsoft YaHei, sans-serif">运行时冻结母版</text></svg>`);
}

function labelSvg(item, width = CARD_WIDTH) {
  const previewNote = item.previewSourceKind ? ` · 展示图 ${escapeXml(item.previewSourceKind)}` : "";
  return Buffer.from(`<svg width="${width}" height="${LABEL_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16202a"/><text x="12" y="24" fill="#ffffff" font-size="15" font-family="Arial, Microsoft YaHei, sans-serif">${String(item.sequence).padStart(2, "0")}. ${escapeXml(item.title)}</text><text x="12" y="47" fill="#b9c6d2" font-size="11" font-family="Arial, sans-serif">${escapeXml(item.templateId)} · ${escapeXml(item.statusLabel)}${previewNote}</text><text x="12" y="67" fill="#8fa5b5" font-size="10" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(item.orientation)} · 母版 ${escapeXml(item.version)}${item.previewVersion ? ` · 展示 ${escapeXml(item.previewVersion)}` : ""}</text></svg>`);
}

function sheetHeaderSvg(title, count, width) {
  return Buffer.from(`<svg width="${width}" height="${SHEET_HEADER_HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#101820"/><text x="20" y="28" fill="#ffffff" font-size="20" font-family="Arial, Microsoft YaHei, sans-serif">${escapeXml(title)}</text><text x="20" y="50" fill="#9fb0bf" font-size="11" font-family="Arial, Microsoft YaHei, sans-serif">${count} 个模板 · 内部审核资料，原始效果参考图禁止对外发布</text></svg>`);
}

async function comparisonImage(source) {
  return sharp(source, { failOn: "error" })
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT, {
      fit: "contain",
      background: { r: 246, g: 248, b: 250, alpha: 1 },
    })
    .png()
    .toBuffer();
}

async function buildCard(item, masterLabel) {
  const [effectReference, master] = await Promise.all([
    comparisonImage(item.effectReferencePath),
    comparisonImage(item.masterPath),
  ]);
  return sharp({
    create: {
      width: CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: { r: 246, g: 248, b: 250, alpha: 1 },
    },
  }).composite([
    { input: headerSvg(masterLabel), top: 0, left: 0 },
    { input: effectReference, top: HEADER_HEIGHT, left: 10 },
    { input: master, top: HEADER_HEIGHT, left: 260 },
    { input: labelSvg(item), top: HEADER_HEIGHT + IMAGE_HEIGHT, left: 0 },
  ]).png().toBuffer();
}

async function buildFrozenCard(item) {
  const [effectReference, publicPreview, master] = await Promise.all([
    comparisonImage(item.effectReferencePath),
    comparisonImage(item.publicPreviewPath),
    comparisonImage(item.masterPath),
  ]);
  return sharp({
    create: {
      width: FROZEN_CARD_WIDTH,
      height: CARD_HEIGHT,
      channels: 4,
      background: { r: 246, g: 248, b: 250, alpha: 1 },
    },
  }).composite([
    { input: frozenHeaderSvg(), top: 0, left: 0 },
    { input: effectReference, top: HEADER_HEIGHT, left: 10 },
    { input: publicPreview, top: HEADER_HEIGHT, left: 260 },
    { input: master, top: HEADER_HEIGHT, left: 510 },
    { input: labelSvg(item, FROZEN_CARD_WIDTH), top: HEADER_HEIGHT + IMAGE_HEIGHT, left: 0 },
  ]).png().toBuffer();
}

async function assertItems(items, expectedCount, statusLabel) {
  if (items.length !== expectedCount) {
    throw new Error(`${statusLabel}数量错误：预期 ${expectedCount}，实际 ${items.length}`);
  }
  const templateIds = new Set();
  for (const item of items) {
    if (templateIds.has(item.templateId)) throw new Error(`${statusLabel}模板重复：${item.templateId}`);
    templateIds.add(item.templateId);
    if (!item.effectReferencePath || !await exists(item.effectReferencePath)) {
      throw new Error(`${item.templateId} 缺少效果参考图：${item.effectReferencePath || "未登记"}`);
    }
    if (!await exists(item.masterPath)) {
      throw new Error(`${item.templateId} 缺少母版：${item.masterPath}`);
    }
    if (item.publicPreviewPath && !await exists(item.publicPreviewPath)) {
      throw new Error(`${item.templateId} 缺少最新小程序展示图：${item.publicPreviewPath}`);
    }
  }
}

async function buildSheet(filename, title, items, masterLabel, options = {}) {
  const cardWidth = options.cardWidth || CARD_WIDTH;
  const cardBuilder = options.cardBuilder || ((item) => buildCard(item, masterLabel));
  const rows = Math.ceil(items.length / COLUMNS);
  const width = COLUMNS * cardWidth + (COLUMNS + 1) * GAP;
  const height = SHEET_HEADER_HEIGHT + rows * CARD_HEIGHT + (rows + 1) * GAP;
  const composites = [{ input: sheetHeaderSvg(title, items.length, width), top: 0, left: 0 }];
  for (let index = 0; index < items.length; index += 1) {
    const card = await cardBuilder(items[index]);
    composites.push({
      input: card,
      left: GAP + (index % COLUMNS) * (cardWidth + GAP),
      top: SHEET_HEADER_HEIGHT + GAP + Math.floor(index / COLUMNS) * (CARD_HEIGHT + GAP),
    });
  }
  const output = path.join(REVIEW_ROOT, filename);
  await sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 232, g: 237, b: 241, alpha: 1 },
    },
  }).composite(composites).png().toFile(output);
  console.log(`生成 ${relativeToRoot(output)}：${items.length}/${items.length}`);
  return output;
}

const pendingItems = expansionJobs
  .filter((job) => pendingReviewSequences.has(job.templateId))
  .map((job) => ({
  sequence: pendingReviewSequences.get(job.templateId),
  templateId: job.templateId,
  title: job.title,
  orientation: job.orientation === "portrait" ? "竖版 720x1280" : "横版 1280x720",
  version: job.version,
  status: "pending-review",
  statusLabel: "待审核",
  effectReferencePath: job.effectReferencePath,
  masterPath: pendingCandidatePath(job),
}));

const masterIndex = JSON.parse(await readFile(MASTER_INDEX_PATH, "utf8"));
const publicPreviewIndex = JSON.parse(await readFile(PUBLIC_PREVIEW_INDEX_PATH, "utf8"));
const publicPreviewByTemplate = new Map(publicPreviewIndex.templates.map((item) => [item.templateId, item]));
const frozenItems = [];
for (const [index, item] of masterIndex.templates.entries()) {
  const metadataPath = resolveWorkspacePath(item.metadata);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const publicPreview = publicPreviewByTemplate.get(item.templateId);
  if (!publicPreview) throw new Error(`${item.templateId} 未登记小程序展示图`);
  frozenItems.push({
    sequence: index + 1,
    templateId: item.templateId,
    title: item.title,
    orientation: item.orientation === "portrait" ? "竖版 720x1280" : "横版 1280x720",
    version: versionFromMaster(item, metadata),
    status: "live",
    statusLabel: "已冻结",
    effectReferencePath: resolveFrozenEffectReference(item, metadata),
    publicPreviewPath: resolveWorkspacePath(publicPreview.path),
    previewVersion: publicPreview.publicVersion,
    previewSourceKind: publicPreview.sourceKind,
    masterPath: resolveWorkspacePath(item.path),
    metadataPath,
  });
}

const milkTeaJob = expansionJobs.find((job) => job.templateId === "pet-milk-tea-shopkeeper");
const milkTeaPreview = publicPreviewIndex.templates.find((item) => item.templateId === "pet-milk-tea-shopkeeper");
if (!milkTeaJob || !milkTeaPreview) throw new Error("奶茶店主理人公开展示图未登记");
const publicPreviewItems = [{
  sequence: 19,
  templateId: milkTeaJob.templateId,
  title: milkTeaJob.title,
  orientation: "竖版 720x1280",
  version: milkTeaPreview.publicVersion,
  status: "approved-public-preview",
  statusLabel: "公开展示图",
  effectReferencePath: milkTeaJob.effectReferencePath,
  masterPath: resolveWorkspacePath(milkTeaPreview.path),
}];

await assertItems(pendingItems, 0, "待审核");
await assertItems(frozenItems, 76, "已冻结");
await assertItems(publicPreviewItems, 1, "公开展示图");
await mkdir(REVIEW_ROOT, { recursive: true });

const pendingOutput = await buildSheet(
  "pending-masters-comparison.png",
  "待审核母版对照总览",
  pendingItems,
  "自有候选母版",
);
const frozenOutput = await buildSheet(
  "frozen-masters-comparison.png",
  "已冻结母版对照总览",
  frozenItems,
  "自有冻结母版",
  { cardWidth: FROZEN_CARD_WIDTH, cardBuilder: buildFrozenCard },
);
const dedicatedPublicPreviewItems = frozenItems.filter((item) => item.previewSourceKind === "dedicated-public-preview");
const dedicatedPublicPreviewOutput = await buildSheet(
  "dedicated-public-previews-comparison.png",
  "独立公开展示图最新版核对",
  dedicatedPublicPreviewItems,
  "",
  { cardWidth: FROZEN_CARD_WIDTH, cardBuilder: buildFrozenCard },
);
const publicPreviewOutput = await buildSheet(
  "pending-public-preview-comparison.png",
  "本轮公开展示图对照",
  publicPreviewItems,
  "小程序公开展示图",
);

const manifest = {
  generatedAt: new Date().toISOString(),
  purpose: "internal-effect-reference-to-owned-master-review",
  publicUseAllowed: false,
  counts: {
    pendingReview: pendingItems.length,
    frozen: frozenItems.length,
    publicPreviewReview: publicPreviewItems.length,
  },
  sheets: {
    pendingReview: relativeToRoot(pendingOutput),
    frozen: relativeToRoot(frozenOutput),
    publicPreviewReview: relativeToRoot(publicPreviewOutput),
    dedicatedPublicPreviews: relativeToRoot(dedicatedPublicPreviewOutput),
  },
  pendingReview: pendingItems.map((item) => ({
    sequence: item.sequence,
    templateId: item.templateId,
    title: item.title,
    version: item.version,
    orientation: item.orientation,
    effectReferencePath: relativeToRoot(item.effectReferencePath),
    candidateMasterPath: relativeToRoot(item.masterPath),
  })),
  frozen: frozenItems.map((item) => ({
    sequence: item.sequence,
    templateId: item.templateId,
    title: item.title,
    version: item.version,
    orientation: item.orientation,
    effectReferencePath: relativeToRoot(item.effectReferencePath),
    publicPreviewPath: relativeToRoot(item.publicPreviewPath),
    publicPreviewVersion: item.previewVersion,
    publicPreviewSourceKind: item.previewSourceKind,
    frozenMasterPath: relativeToRoot(item.masterPath),
    metadataPath: relativeToRoot(item.metadataPath),
  })),
  publicPreviewReview: publicPreviewItems.map((item) => ({
    sequence: item.sequence,
    templateId: item.templateId,
    title: item.title,
    version: item.version,
    orientation: item.orientation,
    effectReferencePath: relativeToRoot(item.effectReferencePath),
    publicPreviewPath: relativeToRoot(item.masterPath),
  })),
};
const manifestPath = path.join(REVIEW_ROOT, "index.json");
await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
console.log(`生成 ${relativeToRoot(manifestPath)}：0 待审核 / 76 已冻结 / 1 张已批准公开展示图`);
