/** 将已通过技术核验的偷鱼三参考探针无损晋升为母版候选；不调用图片模型。 */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dualMasterBasename, dualSubjectJobs, relativeToRoot, REFERENCE_ROOT } from "./dual-subject-prompts.mjs";

const job = dualSubjectJobs.find((item) => item.id === "fish-chase");
if (!job) throw new Error("fish-chase 配置不存在");
const basename = dualMasterBasename(job);
const DUAL_ROOT = path.join(REFERENCE_ROOT, "dual-subject");
const probePath = path.join(DUAL_ROOT, "probe", `${basename}-probe.png`);
const probeRawPath = path.join(DUAL_ROOT, "probe", "raw", `${basename}-probe.png`);
const probeMetadataPath = path.join(DUAL_ROOT, "probe", `${basename}-probe.json`);
const candidatePath = path.join(DUAL_ROOT, "candidates", `${basename}.png`);
const candidateRawPath = path.join(DUAL_ROOT, "candidates", "raw", `${basename}.png`);
const candidateMetadataPath = path.join(DUAL_ROOT, "metadata", `${basename}.json`);

const [body, raw, metadataBody] = await Promise.all([
  readFile(probePath),
  readFile(probeRawPath),
  readFile(probeMetadataPath, "utf8")
]);
const metadata = JSON.parse(metadataBody);
metadata.status = "dual-subject-master-candidate-pending-user-approval";
metadata.promotedFromTechnicalProbe = relativeToRoot(probePath);
metadata.promotedWithoutModelCall = true;
metadata.visualReview = { ...metadata.visualReview, state: "pending-user" };
metadata.output = {
  path: relativeToRoot(candidatePath),
  rawPath: relativeToRoot(candidateRawPath),
  sha256: createHash("sha256").update(body).digest("hex")
};
metadata.promotedAt = new Date().toISOString();

await Promise.all([
  mkdir(path.dirname(candidatePath), { recursive: true }),
  mkdir(path.dirname(candidateRawPath), { recursive: true }),
  mkdir(path.dirname(candidateMetadataPath), { recursive: true })
]);
await Promise.all([
  writeFile(candidatePath, body),
  writeFile(candidateRawPath, raw),
  writeFile(candidateMetadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8")
]);
console.log(relativeToRoot(candidatePath));
