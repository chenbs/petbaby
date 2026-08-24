/** Promote the six user-approved public previews to versioned frozen masters. */
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import {
  PROMOTION_ROOT,
  promotionJobs,
  REFERENCE_ROOT,
  relativeToRoot,
  ROOT,
  stabilityIdentities,
} from "./public-preview-master-promotion-catalog.mjs";

const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_METADATA_ROOT = path.join(MASTER_ROOT, "metadata");
const MASTER_INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const PUBLIC_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");
const DEPLOY_MANIFEST_PATH = path.join(REFERENCE_ROOT, "deploy-assets.tsv");
const PROMOTION_INDEX_PATH = path.join(PROMOTION_ROOT, "index.json");
const STABILITY_INDEX_PATH = path.join(PROMOTION_ROOT, "stability", "index.json");
const LIBRARY_REVIEW_INDEX_PATH = path.join(REFERENCE_ROOT, "library-review", "index.json");
const LOCAL_OBJECT_ROOT = path.join(ROOT, "apps", "platform", ".data", "objects");
const REJECTED_IDS = ["leaping-cover", "exaggerated-expression", "animal-ink-scratch-portrait"];
const APPROVED_IDS = new Set(promotionJobs.map((job) => job.templateId));
const APPROVED_AT = new Date().toISOString();

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function assertInside(root, target) {
  const resolvedRoot = path.resolve(root);
  const resolvedTarget = path.resolve(target);
  if (resolvedTarget === resolvedRoot || !resolvedTarget.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new Error(`删除目标越界：${resolvedTarget}`);
  }
  return resolvedTarget;
}

async function deleteRejectedArtifacts() {
  const deleted = [];
  for (const templateId of REJECTED_IDS) {
    const targets = [
      path.join(PROMOTION_ROOT, "candidates", `${templateId}_`),
      path.join(PROMOTION_ROOT, "api-inputs", `${templateId}_`),
      path.join(PROMOTION_ROOT, "metadata", `${templateId}_`),
    ];
    for (const [folder, prefix] of targets.map((target) => [path.dirname(target), path.basename(target)])) {
      const names = await readdir(folder).catch(() => []);
      for (const name of names.filter((item) => item.startsWith(prefix))) {
        const target = assertInside(PROMOTION_ROOT, path.join(folder, name));
        await rm(target, { force: true });
        deleted.push(relativeToRoot(target));
      }
    }
    const stabilityFolder = assertInside(PROMOTION_ROOT, path.join(PROMOTION_ROOT, "stability", templateId));
    if (await exists(stabilityFolder)) {
      await rm(stabilityFolder, { recursive: true, force: true });
      deleted.push(relativeToRoot(stabilityFolder));
    }
    console.log(`已删除未通过候选产物 ${templateId}`);
  }
  return deleted;
}

async function validateImage(file, size, expectedHash) {
  const body = await readFile(file);
  if (sha256(body) !== expectedHash) throw new Error(`${relativeToRoot(file)} 哈希不匹配`);
  if (!await hasUsableVisualContent(body)) throw new Error(`${relativeToRoot(file)} 无有效画面`);
  const actual = await dimensions(body);
  if (`${actual.width}x${actual.height}` !== size) throw new Error(`${relativeToRoot(file)} 尺寸错误`);
  return body;
}

async function writeLocalObject(key, body) {
  if (!key.startsWith("samples/image-templates/")) throw new Error(`母版对象键越界：${key}`);
  const target = assertInside(LOCAL_OBJECT_ROOT, path.join(LOCAL_OBJECT_ROOT, ...key.split("/")));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  await writeFile(`${target}.meta`, JSON.stringify({ contentType: "image/png" }), "utf8");
}

function versionFor(publicVersion) {
  return `${publicVersion}-master-v01`;
}

function masterBasename(templateId, publicVersion) {
  return `${templateId}_${versionFor(publicVersion)}`;
}

function rebuildDeployManifest(masterIndex, publicIndex) {
  const lines = ["# kind\tstorage_key\tsource_path\tsha256"];
  for (const item of masterIndex.templates) {
    lines.push(["master", `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`, item.path, item.sha256].join("\t"));
  }
  for (const item of publicIndex.templates) {
    lines.push(["preview", item.sampleStorageKey, item.path, item.sha256].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

const masterIndex = await readJson(MASTER_INDEX_PATH);
const publicIndex = await readJson(PUBLIC_INDEX_PATH);
const promotionIndex = await readJson(PROMOTION_INDEX_PATH);
const stabilityIndex = await readJson(STABILITY_INDEX_PATH);
const libraryReviewIndex = await readJson(LIBRARY_REVIEW_INDEX_PATH);
const effectReferenceById = new Map(libraryReviewIndex.frozen.map((item) => [item.templateId, item.effectReferencePath]));
if (masterIndex.templates.length !== 79 || publicIndex.templates.length !== 79) {
  throw new Error(`正式索引数量异常：${masterIndex.templates.length}/${publicIndex.templates.length}`);
}
if (promotionJobs.length !== 6 || !promotionJobs.every((job) => APPROVED_IDS.has(job.templateId))) {
  throw new Error("本次审批集合必须严格为 6 项");
}

const promotionById = new Map(promotionIndex.templates.filter((item) => APPROVED_IDS.has(item.templateId)).map((item) => [item.templateId, item]));
const approvedResults = stabilityIndex.results.filter((item) => APPROVED_IDS.has(item.templateId));
if (promotionById.size !== 6 || approvedResults.length !== 18) {
  throw new Error(`审批输入不完整：${promotionById.size} 个候选 / ${approvedResults.length} 张稳定性结果`);
}

for (const job of promotionJobs) {
  const promotion = promotionById.get(job.templateId);
  const preview = publicIndex.templates.find((item) => item.templateId === job.templateId);
  const current = masterIndex.templates.find((item) => item.templateId === job.templateId);
  if (!promotion || !preview || !current) throw new Error(`${job.templateId} 索引记录缺失`);
  const candidatePath = path.join(ROOT, promotion.candidatePath);
  const effectReferencePath = effectReferenceById.get(job.templateId);
  if (!effectReferencePath || !await exists(path.join(ROOT, effectReferencePath))) {
    throw new Error(`${job.templateId} 缺少原始效果参考图来源`);
  }
  const candidate = await validateImage(candidatePath, promotion.size, promotion.candidateSha256);
  const publicBody = await readFile(path.join(ROOT, preview.path));
  if (!candidate.equals(publicBody) || preview.sha256 !== promotion.candidateSha256) {
    throw new Error(`${job.templateId} 候选母版不再与公开展示图一致`);
  }

  const results = approvedResults.filter((item) => item.templateId === job.templateId);
  if (results.length !== stabilityIdentities.length) throw new Error(`${job.templateId} 稳定性矩阵不完整`);
  const stabilityEvidence = [];
  for (const identity of stabilityIdentities) {
    const result = results.find((item) => item.identityId === identity.id);
    if (!result) throw new Error(`${job.templateId}/${identity.id} 稳定性结果缺失`);
    const metadata = await readJson(path.join(ROOT, result.metadataPath));
    await validateImage(path.join(ROOT, result.outputPath), promotion.size, metadata.output.sha256);
    stabilityEvidence.push({ identityId: identity.id, outputPath: result.outputPath, outputSha256: metadata.output.sha256, metadataPath: result.metadataPath });
  }

  const version = versionFor(promotion.publicVersion);
  const basename = masterBasename(job.templateId, promotion.publicVersion);
  const masterPath = path.join(MASTER_ROOT, `${basename}.png`);
  const masterMetadataPath = path.join(MASTER_METADATA_ROOT, `${basename}.json`);
  await copyFile(candidatePath, masterPath);
  const masterMetadata = {
    kind: "frozen-master",
    templateId: job.templateId,
    title: job.title,
    status: "approved-frozen-master",
    subjectMode: "pet",
    version,
    orientation: promotion.orientation,
    size: promotion.size,
    sourcePublicPreview: {
      path: preview.path,
      sha256: preview.sha256,
      publicVersion: promotion.publicVersion,
      metadata: preview.metadata,
      byteIdentical: true,
      generatedFromOriginalEffectReference: true,
      generatedFromPreviousFrozenMaster: false,
    },
    derivedEffectReference: {
      role: "original-effect-reference-internal-audit-only",
      source: effectReferencePath,
      excludedAtRuntime: true,
      publicUseAllowed: false,
    },
    previousFrozenMaster: {
      path: current.path,
      sha256: current.sha256,
      metadata: current.metadata,
      retainedForRollback: true,
    },
    masterPath: relativeToRoot(masterPath),
    masterSha256: promotion.candidateSha256,
    provider: "lingsuan",
    endpoint: "/v1/images/edits",
    runtimeReferenceContract: {
      image1: { role: "self-owned-frozen-master", path: relativeToRoot(masterPath), sha256: promotion.candidateSha256 },
      image2: { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "public-preview-storage-key", "rejected-promotion-candidate"],
    },
    runtimePromptExtension: promotion.productionPromptExtensionOnPromotion,
    stabilityReview: {
      state: "approved-by-user",
      identities: stabilityEvidence,
      approvedAt: APPROVED_AT,
    },
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户审核公开展示图升母版稳定性总览后明确批准。",
    },
    publicUseAllowed: false,
    runtimeMasterUseAllowed: true,
    runtimeThirdPartyEffectReferenceIncluded: false,
  };
  await writeJson(masterMetadataPath, masterMetadata);

  const nextMaster = {
    templateId: job.templateId,
    title: job.title,
    orientation: promotion.orientation,
    size: promotion.size,
    subjectMode: "pet",
    version,
    path: relativeToRoot(masterPath),
    sha256: promotion.candidateSha256,
    metadata: relativeToRoot(masterMetadataPath),
    approvedAt: APPROVED_AT,
  };
  const masterAt = masterIndex.templates.findIndex((item) => item.templateId === job.templateId);
  masterIndex.templates[masterAt] = nextMaster;
  preview.masterSha256 = promotion.candidateSha256;
  if (preview.metadata) {
    const previewMetadataPath = path.join(ROOT, preview.metadata);
    const previewMetadata = await readJson(previewMetadataPath);
    previewMetadata.masterSha256 = promotion.candidateSha256;
    previewMetadata.currentFrozenMasterPath = relativeToRoot(masterPath);
    previewMetadata.currentFrozenMasterVersion = version;
    previewMetadata.runtimeMasterUseAllowed = false;
    await writeJson(previewMetadataPath, previewMetadata);
  }
  const storageKey = `samples/image-templates/${job.templateId}-${promotion.candidateSha256.slice(0, 12)}.png`;
  await writeLocalObject(storageKey, candidate);
  console.log(`已冻结 ${job.sequence}. ${job.title} -> ${storageKey}`);
}

masterIndex.approvedAt = APPROVED_AT;
masterIndex.updatedAt = APPROVED_AT;
publicIndex.updatedAt = APPROVED_AT;
await writeJson(MASTER_INDEX_PATH, masterIndex);
await writeJson(PUBLIC_INDEX_PATH, publicIndex);
await writeFile(DEPLOY_MANIFEST_PATH, rebuildDeployManifest(masterIndex, publicIndex), "utf8");

const deletedArtifacts = await deleteRejectedArtifacts();
const approvedTemplates = promotionIndex.templates.filter((item) => APPROVED_IDS.has(item.templateId)).map((item) => ({
  ...item,
  status: "approved-and-frozen",
  approvedAt: APPROVED_AT,
  frozenMasterPath: masterIndex.templates.find((master) => master.templateId === item.templateId)?.path,
  frozenMasterSha256: item.candidateSha256,
}));
await writeJson(PROMOTION_INDEX_PATH, {
  ...promotionIndex,
  status: "approved-and-frozen",
  runtimeMasterUseAllowed: true,
  currentFrozenMastersUnchanged: false,
  approvedTemplateIds: [...APPROVED_IDS],
  rejectedTemplateIds: REJECTED_IDS,
  rejectedArtifactsDeleted: true,
  deletedArtifactCount: deletedArtifacts.length,
  templates: approvedTemplates,
  approvedAt: APPROVED_AT,
});
await writeJson(STABILITY_INDEX_PATH, {
  ...stabilityIndex,
  status: "approved-by-user",
  expectedTotal: 18,
  generatedTotal: 18,
  results: approvedResults,
  approvedAt: APPROVED_AT,
});

console.log(`正式晋升完成：6 项通过；3 项未通过产物已删除（${deletedArtifacts.length} 个文件或目录）`);
