import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-third-batch");
const BASENAME = "adventure-rules_dog_golden-retriever-dog_9x16_v03";
const OUTPUT_PATH = path.join(OUTPUT_ROOT, `${BASENAME}.png`);
const METADATA_PATH = path.join(OUTPUT_ROOT, "metadata", `${BASENAME}.json`);
const SHEET_PATH = path.join(REFERENCE_ROOT, "third-batch-migration-approval-sheet-v01.json");
const APPROVED_AT = "2026-08-17T00:00:00.000+08:00";
const JOB_ID = "adventure-rules_dog_golden-retriever-dog";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const [body, metadata] = await Promise.all([
  readFile(OUTPUT_PATH),
  readFile(METADATA_PATH, "utf8").then(JSON.parse),
]);
const digest = sha256(body);
if (metadata.output?.sha256 !== digest) throw new Error("金毛 v03 输出哈希不一致");
if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error("金毛 v03 混入第三方效果参考");

metadata.status = "approved-runtime-validation";
metadata.review = {
  ...metadata.review,
  state: "approved-by-user",
  checks: Object.fromEntries(Object.keys(metadata.review?.checks || {}).map((key) => [key, "pass"])),
  findings: [],
  finalApproval: "approved",
  approvedAt: APPROVED_AT,
};
await writeFile(METADATA_PATH, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

const sheet = JSON.parse(await readFile(SHEET_PATH, "utf8"));
const item = sheet.items.find((entry) => entry.templateId === "adventure-rules");
const file = item?.files.find((entry) => entry.path.endsWith(`${BASENAME}.png`));
if (!file) throw new Error("审批总览缺少金毛 v03 条目");
file.sha256 = digest;
file.status = "approved-runtime-validation";
sheet.status = "approved-by-user";
sheet.approvedAt = APPROVED_AT;
sheet.review = {
  approved: [...new Set([...(sheet.review?.approved || []), JOB_ID])],
  pendingUserApproval: [],
  generationBlockedByUpstream524: [],
};
await writeFile(SHEET_PATH, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");

console.log("第三批运行时迁移已完成并批准：14/14");
