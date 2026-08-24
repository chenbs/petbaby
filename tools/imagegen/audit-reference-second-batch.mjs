/** 校验第二批最终候选的尺寸、哈希、审批状态及冻结隔离。 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const METADATA = path.join(REFERENCE_ROOT, "metadata");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const items = [
  { basename: "exaggerated-expression_ragdoll-cat_9x16_v02", frozen: true },
  { basename: "landmark-adventure_abyssinian-cat_9x16_v01", frozen: true },
  { basename: "dessert-shopkeeper_toy-poodle_9x16_v02", frozen: true },
  { basename: "pet-runway_maine-coon-cat_9x16_v04", frozen: true },
  {
    basename: "leaping-cover_border-collie_9x16_reset-v02",
    frozen: true,
    metadataDir: "reset/metadata",
  }
];

const index = JSON.parse(await readFile(INDEX, "utf8"));
const frozenEntries = new Map(index.templates.map((item) => [item.templateId, item]));

for (const item of items) {
  const { basename } = item;
  const metadataPath = path.join(REFERENCE_ROOT, item.metadataDir || "metadata", `${basename}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const outputPath = path.join(ROOT, metadata.output?.path || metadata.candidatePath);
  const buffer = await readFile(outputPath);
  const actual = await dimensions(buffer);
  const hash = createHash("sha256").update(buffer).digest("hex");
  if (actual.width !== 720 || actual.height !== 1280) {
    throw new Error(`${basename}: 尺寸为 ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(buffer)) throw new Error(`${basename}: 画面无有效内容`);
  const recordedHash = metadata.output?.sha256 || metadata.masterSha256;
  if (hash !== recordedHash) throw new Error(`${basename}: SHA-256 与元数据不一致`);
  const expectedStatus = item.frozen ? "approved-frozen-master" : "master-candidate-pending-user-approval";
  if (metadata.status !== expectedStatus) throw new Error(`${basename}: 状态异常 ${metadata.status}`);
  const expectedReview = item.frozen ? "approved-by-user" : "prechecked-pending-user-approval";
  if (metadata.review.state !== expectedReview) throw new Error(`${basename}: 人工审核状态异常 ${metadata.review.state}`);
  if (Object.values(metadata.review.checks || {}).some((value) => value !== "pass")) {
    throw new Error(`${basename}: 存在未通过的预审项`);
  }
  if (item.styleChecks) {
    for (const check of item.styleChecks) {
      if (metadata.review.checks[check] !== "pass") throw new Error(`${basename}: ${check} 未通过`);
    }
  }
  const frozenEntry = frozenEntries.get(metadata.templateId);
  if (item.frozen) {
    if (metadata.review.finalApproval !== "approved") throw new Error(`${basename}: 用户审批状态异常`);
    if (!frozenEntry) throw new Error(`${basename}: 已批准但冻结索引缺失`);
    if (frozenEntry.sha256 !== hash) throw new Error(`${basename}: 冻结索引哈希不一致`);
    const masterBuffer = await readFile(path.join(ROOT, frozenEntry.path));
    if (createHash("sha256").update(masterBuffer).digest("hex") !== hash) throw new Error(`${basename}: 冻结母版哈希不一致`);
    console.log(`通过 ${metadata.title}: 720x1280 / 哈希一致 / 用户已批准 / 已冻结`);
  } else {
    if (metadata.review.finalApproval !== "pending-user") throw new Error(`${basename}: 用户审批状态异常`);
    if (frozenEntry) throw new Error(`${basename}: 未经用户审批已进入冻结索引`);
    console.log(`通过 ${metadata.title}: 720x1280 / 哈希一致 / 待用户审批 / 未冻结`);
  }
}

console.log(`第二批技术校验通过：${items.length}/5`);
