/** Record the user's final approval for the ten active second-batch migrations. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { secondBatchValidationJobs } from "./reference-second-batch-validation-prompts.mjs";
import { relativeToRoot } from "./reference-template-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-second-batch");
const META_ROOT = path.join(OUTPUT_ROOT, "metadata");
const SHEET_META = path.join(REFERENCE_ROOT, "second-batch-migration-approval-sheet-v02.json");
const APPROVED_AT = "2026-08-14T17:57:02+08:00";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

for (const job of secondBatchValidationJobs) {
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_9x16_${job.version}`;
  const outputPath = path.join(OUTPUT_ROOT, `${basename}.png`);
  const metadataPath = path.join(META_ROOT, `${basename}.json`);
  const [body, metadata] = await Promise.all([
    readFile(outputPath),
    readFile(metadataPath, "utf8").then(JSON.parse),
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
    approvedAt: APPROVED_AT,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`已批准 ${basename}`);
}

for (const basename of [
  "landmark-adventure_cat_cream-longhair-cat_9x16_v01",
  "landmark-adventure_dog_husky-dog_9x16_v01",
]) {
  const metadataPath = path.join(META_ROOT, `${basename}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const approvedBasename = basename.replace("_v01", "_v02");
  metadata.status = "superseded-by-approved-revision";
  metadata.supersededBy = relativeToRoot(path.join(OUTPUT_ROOT, `${approvedBasename}.png`));
  metadata.review = {
    ...metadata.review,
    state: "superseded",
    findings: ["v01 墨镜镜片偏浅，已由用户批准的深色近黑镜片 v02 替代。"],
    finalApproval: "superseded",
    reviewedAt: APPROVED_AT,
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
}

const sheet = JSON.parse(await readFile(SHEET_META, "utf8"));
sheet.status = "approved-by-user";
sheet.approvedAt = APPROVED_AT;
sheet.review = "10/10 active runtime migrations approved; landmark-adventure uses dark-sunglasses v02; template 06 removed.";
await writeFile(SHEET_META, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");

console.log(`第二批运行时迁移已结案：${secondBatchValidationJobs.length}/10`);
