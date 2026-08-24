/** Record the user's approval for the ten accepted third-batch runtime migrations. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { relativeToRoot } from "./reference-template-prompts.mjs";
import { thirdBatchValidationJobs } from "./reference-third-batch-validation-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-third-batch");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const SHEET_META = path.join(REFERENCE_ROOT, "third-batch-migration-approval-sheet-v01.json");
const APPROVED_AT = "2026-08-17T13:33:28+08:00";
const approvedIds = new Set([
  "original-magic-academy_cat_devon-rex-cat",
  "original-magic-academy_dog_shiba-dog",
  "epic-ruins_cat_maine-coon-cat",
  "epic-ruins_dog_husky-dog",
  "mini-companion_cat_ragdoll-cat",
  "mini-companion_dog_black-labrador-dog",
  "adventure-rules_cat_british-shorthair-cat",
  "pet-life-journal_cat_tuxedo-cat",
  "pet-life-journal_dog_corgi-dog",
  "ink-portrait_cat_black-cat",
  "ink-portrait_dog_german-shepherd-dog",
  "decorative-art-portrait_cat_abyssinian-cat",
  "decorative-art-portrait_dog_toy-poodle-dog"
]);

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const approvedJobs = thirdBatchValidationJobs.filter((job) => approvedIds.has(job.id));
if (approvedJobs.length !== approvedIds.size) throw new Error("批准矩阵与当前任务定义不一致");

for (const job of approvedJobs) {
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_9x16_${job.version}`;
  const outputPath = path.join(OUTPUT_ROOT, `${basename}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${basename}.json`);
  const [body, metadata] = await Promise.all([
    readFile(outputPath),
    readFile(metadataPath, "utf8").then(JSON.parse)
  ]);
  if (metadata.output?.path !== relativeToRoot(outputPath)) throw new Error(`${basename}: 输出路径不一致`);
  if (metadata.output?.sha256 !== sha256(body)) throw new Error(`${basename}: 输出哈希不一致`);
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error(`${basename}: 混入第三方效果参考`);

  metadata.status = "approved-runtime-validation";
  metadata.review = {
    ...metadata.review,
    state: "approved-by-user",
    checks: Object.fromEntries(Object.keys(metadata.review?.checks || {}).map((key) => [key, "pass"])),
    findings: [],
    finalApproval: "approved",
    approvedAt: metadata.review?.approvedAt || APPROVED_AT
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`已批准 ${basename}`);
}

const superseded = [
  ["pet-life-journal_cat_tuxedo-cat_9x16_v01", "pet-life-journal_cat_tuxedo-cat_9x16_v02", "v01 未采用母版低头专注视线。"],
  ["pet-life-journal_dog_corgi-dog_9x16_v01", "pet-life-journal_dog_corgi-dog_9x16_v02", "v01 未采用母版低头专注视线。"],
  ["ink-portrait_cat_black-cat_9x16_v01", "ink-portrait_cat_black-cat_9x16_v03", "v01 面部画法偏写实。"],
  ["ink-portrait_cat_black-cat_9x16_v02", "ink-portrait_cat_black-cat_9x16_v03", "v02 面部画法仍偏写实。"],
  ["ink-portrait_dog_german-shepherd-dog_9x16_v01", "ink-portrait_dog_german-shepherd-dog_9x16_v03", "v01 面部画法偏写实。"],
  ["ink-portrait_dog_german-shepherd-dog_9x16_v02", "ink-portrait_dog_german-shepherd-dog_9x16_v03", "v02 面部画法仍偏写实。"],
  ["decorative-art-portrait_cat_abyssinian-cat_9x16_v01", "decorative-art-portrait_cat_abyssinian-cat_9x16_v03", "v01 色彩和面部过于写实。"],
  ["decorative-art-portrait_cat_abyssinian-cat_9x16_v02", "decorative-art-portrait_cat_abyssinian-cat_9x16_v03", "v02 面部抽象程度不足。"],
  ["decorative-art-portrait_dog_toy-poodle-dog_9x16_v01", "decorative-art-portrait_dog_toy-poodle-dog_9x16_v03", "v01 色彩和面部过于写实。"],
  ["decorative-art-portrait_dog_toy-poodle-dog_9x16_v02", "decorative-art-portrait_dog_toy-poodle-dog_9x16_v03", "v02 面部抽象程度不足。"]
];

for (const [oldBasename, approvedBasename, finding] of superseded) {
  const metadataPath = path.join(METADATA_ROOT, `${oldBasename}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.status = "superseded-by-approved-revision";
  metadata.supersededBy = relativeToRoot(path.join(OUTPUT_ROOT, `${approvedBasename}.png`));
  metadata.review = {
    ...metadata.review,
    state: "superseded",
    findings: [finding],
    finalApproval: "superseded",
    reviewedAt: APPROVED_AT
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

const pendingRevisions = [
  ["original-magic-academy_cat_devon-rex-cat_9x16_v01", "original-magic-academy_cat_devon-rex-cat_9x16_v02", "用户认为 v01 坐姿呆板且略显驼背，已生成挺拔坐姿 v02 待审批。"],
  ["original-magic-academy_dog_shiba-dog_9x16_v01", "original-magic-academy_dog_shiba-dog_9x16_v02", "用户认为 v01 坐姿呆板且略显驼背，已生成挺拔坐姿 v02 待审批。"],
  ["adventure-rules_cat_british-shorthair-cat_9x16_v01", "adventure-rules_cat_british-shorthair-cat_9x16_v02", "v01 视线偏正，已生成采用母版视线与闭嘴表情的 v02 待审批。"]
];

for (const [oldBasename, pendingBasename, finding] of pendingRevisions) {
  const metadataPath = path.join(METADATA_ROOT, `${oldBasename}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.status = "superseded-by-pending-revision";
  metadata.supersededBy = relativeToRoot(path.join(OUTPUT_ROOT, `${pendingBasename}.png`));
  metadata.review = {
    ...metadata.review,
    state: "superseded",
    findings: [finding],
    finalApproval: "superseded",
    reviewedAt: APPROVED_AT
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

const rejectedDogV01Path = path.join(METADATA_ROOT, "adventure-rules_dog_golden-retriever-dog_9x16_v01.json");
const rejectedDogV01 = JSON.parse(await readFile(rejectedDogV01Path, "utf8"));
rejectedDogV01.status = "rejected-runtime-validation";
rejectedDogV01.review = {
  ...rejectedDogV01.review,
  state: "rejected-internal-review",
  findings: ["v01 张嘴微笑并露舌，与冻结母版的闭嘴沉静表情不一致；闭嘴修正版因上游 524 尚未生成。"],
  finalApproval: "rejected",
  reviewedAt: APPROVED_AT
};
await writeFile(rejectedDogV01Path, `${JSON.stringify(rejectedDogV01, null, 2)}\n`, "utf8");

const sheet = JSON.parse(await readFile(SHEET_META, "utf8"));
const approvedPaths = new Set(approvedJobs.map((job) => {
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_9x16_${job.version}`;
  return relativeToRoot(path.join(OUTPUT_ROOT, `${basename}.png`));
}));
for (const item of sheet.items || []) {
  for (const file of item.files || []) {
    if (approvedPaths.has(file.path)) file.status = "approved-runtime-validation";
  }
}
sheet.status = "partially-approved-by-user";
sheet.approvedAt = APPROVED_AT;
sheet.review = {
  approved: [...approvedIds],
  pendingUserApproval: [],
  generationBlockedByUpstream524: [
    "adventure-rules_dog_golden-retriever-dog"
  ]
};
await writeFile(SHEET_META, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");

console.log(`第三批运行时迁移已部分批准：${approvedJobs.length}/14`);
