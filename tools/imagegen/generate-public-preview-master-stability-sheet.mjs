/** Build one review sheet: proposed master plus three pet-identity runtime simulations. */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import {
  PROMOTION_ROOT,
  promotionJobs,
  relativeToRoot,
  ROOT,
  stabilityIdentities,
} from "./public-preview-master-promotion-catalog.mjs";

const require = createRequire(path.join(ROOT, "apps", "platform", "package.json"));
const sharp = require("sharp");
const INDEX_PATH = path.join(PROMOTION_ROOT, "index.json");
const STABILITY_INDEX_PATH = path.join(PROMOTION_ROOT, "stability", "index.json");
const REVIEW_ROOT = path.join(PROMOTION_ROOT, "review");
const CARD_WIDTH = 248;
const CARD_HEIGHT = 370;
const LABEL_HEIGHT = 44;
const IMAGE_WIDTH = 224;
const IMAGE_HEIGHT = 314;
const GAP = 12;
const ROW_TITLE_WIDTH = 220;
const HEADER_HEIGHT = 88;
const ROW_HEIGHT = CARD_HEIGHT + GAP;
const SHEET_WIDTH = GAP * 6 + ROW_TITLE_WIDTH + CARD_WIDTH * 4;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function textSvg(width, height, lines, options = {}) {
  const fontSize = options.fontSize || 18;
  const fill = options.fill || "#17212b";
  const weight = options.weight || 500;
  const startY = options.startY || fontSize + 8;
  const lineHeight = options.lineHeight || fontSize + 8;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="${options.background || "transparent"}"/>${lines.map((line, index) => `<text x="${options.x || 10}" y="${startY + index * lineHeight}" font-family="Microsoft YaHei,Segoe UI,sans-serif" font-size="${fontSize}" font-weight="${weight}" fill="${fill}">${escapeXml(line)}</text>`).join("")}</svg>`);
}

async function framedImage(file) {
  return sharp(file)
    .resize(IMAGE_WIDTH, IMAGE_HEIGHT, { fit: "contain", background: { r: 248, g: 249, b: 250, alpha: 1 } })
    .extend({ top: LABEL_HEIGHT, bottom: 6, left: 12, right: 12, background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toBuffer();
}

const promotionIndex = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const stabilityIndex = JSON.parse(await readFile(STABILITY_INDEX_PATH, "utf8"));
if (stabilityIndex.generatedTotal !== stabilityIndex.expectedTotal) {
  throw new Error(`稳定性结果不完整：${stabilityIndex.generatedTotal}/${stabilityIndex.expectedTotal}`);
}
const promotionById = new Map(promotionIndex.templates.map((item) => [item.templateId, item]));
const resultByKey = new Map(stabilityIndex.results.map((item) => [`${item.templateId}:${item.identityId}`, item]));
const identityInputById = new Map(promotionIndex.identities.map((item) => [item.id, item]));
const approved = promotionIndex.status === "approved-and-frozen";
const sheetHeight = HEADER_HEIGHT + GAP + promotionJobs.length * ROW_HEIGHT + GAP;
const composites = [
  { input: textSvg(SHEET_WIDTH, HEADER_HEIGHT, [approved ? "公开展示图升冻结母版 · 已通过" : "公开展示图升冻结母版 · 稳定性审核", "每行：候选母版 → 短毛猫 → 犬 → 长毛猫；均为灵算 API 双图串行验证"], { background: "#101820", fill: "#ffffff", fontSize: 22, weight: 700, startY: 32, lineHeight: 30, x: 22 }), top: 0, left: 0 },
];

for (let row = 0; row < promotionJobs.length; row += 1) {
  const job = promotionJobs[row];
  const record = promotionById.get(job.templateId);
  if (!record) throw new Error(`${job.templateId} 缺少候选记录`);
  const top = HEADER_HEIGHT + GAP + row * ROW_HEIGHT;
  composites.push({
    input: textSvg(ROW_TITLE_WIDTH, CARD_HEIGHT, [`${String(job.sequence).padStart(2, "0")} ${job.title}`, job.templateId, record.size, approved ? "审核通过" : "待用户审核"], { background: "#e8edf1", fill: "#17212b", fontSize: 16, weight: 700, startY: 34, lineHeight: 29, x: 14 }),
    top,
    left: GAP,
  });

  const candidateFile = path.join(ROOT, record.candidatePath);
  const candidateCard = await framedImage(candidateFile);
  const firstLeft = GAP * 2 + ROW_TITLE_WIDTH;
  composites.push({ input: candidateCard, top, left: firstLeft });
  composites.push({ input: textSvg(CARD_WIDTH, LABEL_HEIGHT, ["候选母版（等同展示图）"], { fontSize: 15, weight: 700, startY: 28, x: 12 }), top, left: firstLeft });

  for (let column = 0; column < stabilityIdentities.length; column += 1) {
    const identity = stabilityIdentities[column];
    const result = resultByKey.get(`${job.templateId}:${identity.id}`);
    if (!result) throw new Error(`${job.templateId}/${identity.id} 缺少稳定性结果`);
    const outputFile = path.join(ROOT, result.outputPath);
    const identityInput = identityInputById.get(identity.id);
    const identityFile = path.join(ROOT, identityInput.apiInputPath);
    if (!await exists(outputFile) || !await exists(identityFile)) throw new Error(`${job.templateId}/${identity.id} 文件缺失`);
    const card = await framedImage(outputFile);
    const left = firstLeft + (column + 1) * (CARD_WIDTH + GAP);
    const identityThumb = await sharp(identityFile).resize(34, 34, { fit: "cover" }).png().toBuffer();
    composites.push({ input: card, top, left });
    composites.push({ input: identityThumb, top: top + 5, left: left + 10 });
    composites.push({ input: textSvg(CARD_WIDTH - 54, LABEL_HEIGHT, [`${identity.label}运行结果`], { fontSize: 15, weight: 700, startY: 28, x: 4 }), top, left: left + 48 });
  }
}

await mkdir(REVIEW_ROOT, { recursive: true });
const outputPath = path.join(REVIEW_ROOT, "public-preview-master-stability-comparison.png");
await sharp({ create: { width: SHEET_WIDTH, height: sheetHeight, channels: 4, background: { r: 238, g: 242, b: 245, alpha: 1 } } })
  .composite(composites)
  .png()
  .toFile(outputPath);
await writeFile(path.join(REVIEW_ROOT, "index.json"), `${JSON.stringify({
  status: approved ? "approved-by-user" : "pending-user-review",
  purpose: "public-preview-to-frozen-master-stability-review",
  runtimeMasterUseAllowed: approved,
  sheet: relativeToRoot(outputPath),
  templates: promotionJobs.map((job) => ({ sequence: job.sequence, templateId: job.templateId, title: job.title })),
  generatedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");
console.log(`已生成 ${relativeToRoot(outputPath)}`);
