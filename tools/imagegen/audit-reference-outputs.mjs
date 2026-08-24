/**
 * 回读自有参考图库产物，补输出哈希、尺寸、有效画面闸门和人工预审结论。
 * 最终审批仍由用户完成，本脚本不会把预审状态写成 approved。
 */
import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { migrationJobs } from "./reference-template-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const VALIDATION = path.join(REFERENCE_ROOT, "validation");
const VALIDATION_META = path.join(VALIDATION, "metadata");
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata");

const attention = {
  "roller-coaster_dog_shiba-dog_9x16_v02": {
    findings: [],
    checks: {}
  }
};

async function audit(file, metadataPath, expectedSize, kind) {
  const body = await readFile(file);
  const actual = await dimensions(body);
  const usable = await hasUsableVisualContent(body);
  const actualSize = `${actual.width}x${actual.height}`;
  if (actualSize !== expectedSize) throw new Error(`${file} 尺寸 ${actualSize}，要求 ${expectedSize}`);
  if (!usable) throw new Error(`${file} 无有效视觉内容`);

  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const basename = path.parse(file).name;
  const attentionItem = attention[basename] || { findings: [], checks: {} };
  const findings = attentionItem.findings;
  const checks = Object.fromEntries(Object.keys(metadata.review?.checks || {}).map((key) => [key, "pass"]));
  Object.assign(checks, attentionItem.checks);
  const approved = metadata.status === "approved-frozen-master";
  metadata.output = {
    path: path.relative(path.resolve(import.meta.dirname, "../.."), file).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(body).digest("hex")
  };
  metadata.outputSize = actualSize;
  metadata.review = {
    ...metadata.review,
    state: approved ? "approved-by-user" : findings.length ? "pre-reviewed-needs-user-attention" : "pre-reviewed-pending-user-approval",
    checks,
    findings: approved ? [] : findings,
    preReviewedAt: new Date().toISOString(),
    finalApproval: approved ? "approved" : "pending-user"
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  return {
    id: basename,
    kind,
    path: metadata.output.path,
    sha256: metadata.output.sha256,
    size: actualSize,
    reviewState: metadata.review.state,
    findings: approved ? [] : findings
  };
}

const validationFiles = migrationJobs
  .map((job) => {
    const ratio = job.template.orientation === "landscape" ? "16x9" : "9x16";
    return `${job.template.id}_${job.variant}_${job.identityId}_${ratio}_${job.version}.png`;
  })
  .sort();
const validationResults = [];
for (const name of validationFiles) {
  const expectedSize = name.includes("_16x9_") ? "1280x720" : "720x1280";
  validationResults.push(await audit(
    path.join(VALIDATION, name),
    path.join(VALIDATION_META, `${path.parse(name).name}.json`),
    expectedSize,
    "migration-validation"
  ));
}

const expressionName = "pet-expression-grid_cream-cat_9x16_v01.png";
const expressionResult = await audit(
  path.join(REFERENCE_ROOT, "masters", expressionName),
  path.join(MASTER_META, `${path.parse(expressionName).name}.json`),
  "720x1280",
  "frozen-master"
);

const reviewIndex = {
  status: "pre-reviewed-pending-user-approval",
  provider: "lingsuan",
  runtimeThirdPartyEffectReferenceIncluded: false,
  migrations: validationResults,
  frozenMastersApprovedThisRound: [expressionResult],
  newMasterCandidates: [],
  auditedAt: new Date().toISOString()
};
await writeFile(path.join(REFERENCE_ROOT, "review-index.json"), `${JSON.stringify(reviewIndex, null, 2)}\n`, "utf8");
console.log(`预审完成：${validationResults.length} 张迁移图，1 张本轮已批准冻结母版`);
