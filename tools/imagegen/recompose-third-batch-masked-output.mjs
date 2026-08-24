/** Rebuild an existing masked candidate without issuing another provider request. */
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { auditOutsideMaskLock, lockOutsideMask } from "./masked-composite.mjs";
import { relativeToRoot, thirdBatchBasename, thirdBatchJobs, thirdBatchOutputSpecs } from "./reference-third-batch-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const target = process.argv[2];
const job = thirdBatchJobs.find((item) => item.id === target);
if (!job?.editTarget || !job.maskPath) throw new Error(`未知或非遮罩精修任务: ${target || "<empty>"}`);

const basename = thirdBatchBasename(job);
const rawPath = path.join(REFERENCE_ROOT, "candidates", "raw", `${basename}.png`);
const finalPath = path.join(REFERENCE_ROOT, "candidates", `${basename}.png`);
const metadataPath = path.join(REFERENCE_ROOT, "metadata", `${basename}.json`);
const raw = await readFile(rawPath);
const fitted = await fit(raw, job.orientation, { anchor: job.anchor, format: "png" });
const final = await lockOutsideMask({ basePath: job.editTarget, edited: fitted, maskPath: job.maskPath });
const output = thirdBatchOutputSpecs[job.orientation];
const actual = await dimensions(final);
if (actual.width !== output.width || actual.height !== output.height) throw new Error(`输出尺寸错误 ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(final)) throw new Error("输出画面无有效内容");

const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
const pixelAudit = await auditOutsideMaskLock({
  basePath: job.editTarget,
  outputPath: final,
  maskPath: job.maskPath
});
if (pixelAudit.outsideChanged !== 0 || pixelAudit.insideChanged === 0) {
  throw new Error(`遮罩像素锁定失败: ${JSON.stringify(pixelAudit)}`);
}
metadata.status = "master-candidate-pending-user-approval";
metadata.maskedComposite = {
  outsideMaskLockedToEditTarget: true,
  editTarget: relativeToRoot(job.editTarget),
  method: "local-rgba-composite-after-lingsuan-edit",
  pixelAudit
};
metadata.output.sha256 = createHash("sha256").update(final).digest("hex");
metadata.review.state = "pending-visual-precheck";
metadata.review.finalApproval = "pending-user";
for (const key of Object.keys(metadata.review.checks || {})) {
  metadata.review.checks[key] = key === "dimensions" ? "pass" : "pending";
}
metadata.review.findings = [];
delete metadata.review.precheckedAt;

await writeFile(finalPath, final);
await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
console.log(relativeToRoot(finalPath));
