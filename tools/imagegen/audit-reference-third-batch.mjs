/** 校验第三批候选的输入角色、尺寸、哈希、审批隔离和场景锁定元数据。 */
import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { auditOutsideMaskLock } from "./masked-composite.mjs";
import {
  relativeToRoot,
  thirdBatchBasename,
  thirdBatchJobs,
  thirdBatchOutputSpecs
} from "./reference-third-batch-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const METADATA = path.join(REFERENCE_ROOT, "metadata");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const index = JSON.parse(await readFile(INDEX, "utf8"));
const frozenById = new Map(index.templates.map((item) => [item.templateId, item]));

for (const job of thirdBatchJobs) {
  const basename = thirdBatchBasename(job);
  const outputSpec = thirdBatchOutputSpecs[job.orientation];
  const outputPath = path.join(CANDIDATES, `${basename}.png`);
  const metadataPath = path.join(METADATA, `${basename}.json`);
  if (!await exists(outputPath) || !await exists(metadataPath)) {
    throw new Error(`${job.title}: 缺候选图或元数据`);
  }

  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const buffer = await readFile(outputPath);
  const actual = await dimensions(buffer);
  if (actual.width !== outputSpec.width || actual.height !== outputSpec.height) {
    throw new Error(`${job.title}: 尺寸为 ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(buffer)) throw new Error(`${job.title}: 画面无有效内容`);
  if (sha256(buffer) !== metadata.output.sha256) throw new Error(`${job.title}: 输出 SHA-256 不一致`);
  const frozenEntry = frozenById.get(job.id);
  const isFrozen = Boolean(frozenEntry);
  const expectedStatus = isFrozen ? "approved-frozen-master" : "master-candidate-pending-user-approval";
  const expectedApproval = isFrozen ? "approved" : "pending-user";
  const expectedReviewState = isFrozen ? "approved-by-user" : "prechecked-pending-user-approval";
  if (metadata.status !== expectedStatus) throw new Error(`${job.title}: 状态异常 ${metadata.status}`);
  if (metadata.review.finalApproval !== expectedApproval) throw new Error(`${job.title}: 用户审批状态异常 ${metadata.review.finalApproval}`);
  if (metadata.review.state !== expectedReviewState) throw new Error(`${job.title}: 视觉预检状态异常 ${metadata.review.state}`);
  if (Object.values(metadata.review.checks || {}).some((value) => value !== "pass")) {
    throw new Error(`${job.title}: 存在未通过的预检项`);
  }
  if (isFrozen) {
    const masterBody = await readFile(path.join(ROOT, frozenEntry.path));
    if (sha256(masterBody) !== frozenEntry.sha256 || metadata.masterSha256 !== frozenEntry.sha256) {
      throw new Error(`${job.title}: 冻结母版哈希不一致`);
    }
  }
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) {
    throw new Error(`${job.title}: 运行时第三方参考隔离标志异常`);
  }
  if (metadata.sceneChangeBudget !== "0%") throw new Error(`${job.title}: 场景变更预算异常`);
  if (metadata.endpoint !== "/v1/images/edits" || metadata.provider !== "lingsuan") {
    throw new Error(`${job.title}: 未登记为 lingsuan 图生图`);
  }
  const expectedInputs = job.editTarget
    ? [
        ["self-owned-candidate-edit-target", job.editTarget],
        ["third-party-effect-reference-style-only", job.effectReference],
        job.editGuide
          ? [job.editGuideRole, job.editGuide]
          : [job.identityReferenceRole || (job.identityReference ? "derived-pet-identity-reference-from-prior-candidate" : "pet-identity-reference"), job.identityReference || job.pet.path]
      ]
    : [
        ["third-party-effect-reference-internal-master-production-only", job.effectReference],
        [job.identityReferenceRole || (job.identityReference ? "derived-pet-identity-reference-from-prior-candidate" : "pet-identity-reference"), job.identityReference || job.pet.path]
      ];
  if (metadata.inputs?.length !== expectedInputs.length) throw new Error(`${job.title}: 输入数量异常`);
  for (let index = 0; index < expectedInputs.length; index += 1) {
    const [role, file] = expectedInputs[index];
    const actualInput = metadata.inputs[index];
    if (actualInput.role !== role || actualInput.path !== relativeToRoot(file)) throw new Error(`${job.title}: Image ${index + 1} 角色或路径异常`);
    if (sha256(await readFile(file)) !== actualInput.sha256) throw new Error(`${job.title}: Image ${index + 1} SHA-256 不一致`);
  }
  if (job.maskPath) {
    const expectedMaskRole = job.maskRole || "transparent-eye-and-brow-edit-mask";
    if (metadata.mask?.role !== expectedMaskRole || metadata.mask.path !== relativeToRoot(job.maskPath)) {
      throw new Error(`${job.title}: 遮罩角色或路径异常`);
    }
    if (sha256(await readFile(job.maskPath)) !== metadata.mask.sha256) throw new Error(`${job.title}: 遮罩 SHA-256 不一致`);
    const maskAudit = await auditOutsideMaskLock({
      basePath: job.editTarget,
      outputPath,
      maskPath: job.maskPath
    });
    if (maskAudit.outsideChanged !== 0) {
      throw new Error(`${job.title}: 遮罩外有 ${maskAudit.outsideChanged} 个像素被改动`);
    }
    if (maskAudit.insideChanged === 0) throw new Error(`${job.title}: 遮罩内没有产生有效修改`);
    if (JSON.stringify(maskAudit) !== JSON.stringify(metadata.maskedComposite?.pixelAudit)) {
      throw new Error(`${job.title}: 遮罩像素审计记录不一致`);
    }
  } else if (metadata.mask) {
    throw new Error(`${job.title}: 不应登记遮罩`);
  }
  if (relativeToRoot(outputPath) !== metadata.output.path) throw new Error(`${job.title}: 输出路径登记异常`);
  console.log(`通过 ${job.title}: ${outputSpec.size} / ${expectedInputs.length} 图输入 / 哈希一致 / ${isFrozen ? "已冻结" : "待用户审批"}`);
}

console.log(`第三批技术校验通过：${thirdBatchJobs.length}/7`);
