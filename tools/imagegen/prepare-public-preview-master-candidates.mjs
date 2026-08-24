/** Prepare byte-identical master candidates and compressed two-image API inputs. */
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import {
  candidateBasename,
  PROMOTION_ROOT,
  promotionJobs,
  REFERENCE_ROOT,
  relativeToRoot,
  ROOT,
  stabilityIdentities,
} from "./public-preview-master-promotion-catalog.mjs";

const require = createRequire(path.join(ROOT, "apps", "platform", "package.json"));
const sharp = require("sharp");
const MASTER_INDEX_PATH = path.join(REFERENCE_ROOT, "masters", "index.json");
const PUBLIC_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");
const CANDIDATE_ROOT = path.join(PROMOTION_ROOT, "candidates");
const METADATA_ROOT = path.join(PROMOTION_ROOT, "metadata");
const API_INPUT_ROOT = path.join(PROMOTION_ROOT, "api-inputs");
const MAX_API_INPUT_BYTES = 460_000;

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function compressForApi(sourcePath, outputPath) {
  const source = await readFile(sourcePath);
  for (const edge of [1200, 1080, 960]) {
    for (const quality of [82, 76, 70, 64]) {
      const body = await sharp(source)
        .rotate()
        .resize({ width: edge, height: edge, fit: "inside", withoutEnlargement: true })
        .jpeg({ quality, chromaSubsampling: "4:2:0", mozjpeg: true })
        .toBuffer();
      if (body.byteLength <= MAX_API_INPUT_BYTES) {
        await writeFile(outputPath, body);
        const actual = await dimensions(body);
        return { path: outputPath, body, width: actual.width, height: actual.height, quality, maxEdge: edge };
      }
    }
  }
  throw new Error(`${relativeToRoot(sourcePath)} 无法压缩到 ${MAX_API_INPUT_BYTES} 字节以内`);
}

await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true }),
  mkdir(API_INPUT_ROOT, { recursive: true }),
]);

const masterIndex = JSON.parse(await readFile(MASTER_INDEX_PATH, "utf8"));
const publicIndex = JSON.parse(await readFile(PUBLIC_INDEX_PATH, "utf8"));
const masterById = new Map(masterIndex.templates.map((item) => [item.templateId, item]));
const publicById = new Map(publicIndex.templates.map((item) => [item.templateId, item]));
const preparedIdentities = new Map();

for (const identity of stabilityIdentities) {
  if (!await exists(identity.path)) throw new Error(`缺少稳定性身份图：${relativeToRoot(identity.path)}`);
  const outputPath = path.join(API_INPUT_ROOT, `${identity.id}.jpg`);
  preparedIdentities.set(identity.id, await compressForApi(identity.path, outputPath));
}

const records = [];
for (const job of promotionJobs) {
  const currentMaster = masterById.get(job.templateId);
  const preview = publicById.get(job.templateId);
  if (!currentMaster) throw new Error(`${job.templateId} 缺少当前冻结母版`);
  if (!preview || preview.sourceKind !== "dedicated-public-preview") {
    throw new Error(`${job.templateId} 不是独立公开展示图`);
  }
  const previewPath = path.join(ROOT, preview.path);
  const previewMetadataPath = path.join(ROOT, preview.metadata);
  const previewMetadata = JSON.parse(await readFile(previewMetadataPath, "utf8"));
  const previewInputs = Array.isArray(previewMetadata.inputs) ? previewMetadata.inputs : [];
  const effectInputs = previewInputs.filter((input) => String(input.role || "").includes("effect"));
  const frozenMasterInputs = previewInputs.filter((input) => String(input.role || "").includes("frozen-master"));
  if (effectInputs.length !== 1 || frozenMasterInputs.length) {
    throw new Error(`${job.templateId} 公开展示图来源不满足“原始效果参考图生成、未使用冻结母版”`);
  }
  const previewBody = await readFile(previewPath);
  const previewHash = sha256(previewBody);
  if (previewHash !== preview.sha256) throw new Error(`${job.templateId} 公开展示图哈希不匹配`);
  const actual = await dimensions(previewBody);
  if (`${actual.width}x${actual.height}` !== preview.size || !await hasUsableVisualContent(previewBody)) {
    throw new Error(`${job.templateId} 公开展示图尺寸或画面无效`);
  }

  const basename = candidateBasename(job, preview.publicVersion);
  const candidatePath = path.join(CANDIDATE_ROOT, `${basename}.png`);
  const candidateApiPath = path.join(API_INPUT_ROOT, `${basename}.jpg`);
  await copyFile(previewPath, candidatePath);
  const candidateBody = await readFile(candidatePath);
  if (!candidateBody.equals(previewBody)) throw new Error(`${job.templateId} 候选母版没有保持原字节`);
  const compressed = await compressForApi(candidatePath, candidateApiPath);
  for (const identity of stabilityIdentities) {
    const identityInput = preparedIdentities.get(identity.id);
    if (compressed.body.byteLength + identityInput.body.byteLength >= 1_000_000) {
      throw new Error(`${job.templateId}/${identity.id} 两张 API 输入合计超过 1MB`);
    }
  }

  const metadataPath = path.join(METADATA_ROOT, `${basename}.json`);
  const metadata = {
    kind: "master-candidate",
    templateId: job.templateId,
    title: job.title,
    status: "candidate-pending-stability-review",
    runtimeMasterUseAllowed: false,
    source: {
      role: "approved-dedicated-public-preview",
      path: preview.path,
      sha256: preview.sha256,
      publicVersion: preview.publicVersion,
      metadataPath: preview.metadata,
      generationInputRole: effectInputs[0].role,
    },
    currentFrozenMaster: {
      path: currentMaster.path,
      sha256: currentMaster.sha256,
      approvedAt: currentMaster.approvedAt,
    },
    candidate: {
      path: relativeToRoot(candidatePath),
      sha256: previewHash,
      byteIdenticalToPublicPreview: true,
      orientation: preview.orientation,
      size: preview.size,
    },
    apiInputDerivative: {
      path: relativeToRoot(candidateApiPath),
      sha256: sha256(compressed.body),
      format: "jpeg",
      quality: compressed.quality,
      width: compressed.width,
      height: compressed.height,
      bytes: compressed.body.byteLength,
      maxEdgeLimit: 1200,
      perFileByteLimit: MAX_API_INPUT_BYTES,
    },
    provenance: {
      originalEffectReferenceUsedForPublicPreview: true,
      frozenMasterUsedToGeneratePublicPreview: false,
      thirdPartyEffectReferenceAllowedAtRuntime: false,
    },
    productionPromptExtensionOnPromotion: job.constraint,
    review: {
      stabilityIdentities: stabilityIdentities.map((identity) => identity.id),
      expectedOutputs: stabilityIdentities.length,
      state: "pending-generation",
      finalApproval: "pending-user",
    },
    preparedAt: new Date().toISOString(),
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  records.push({
    sequence: job.sequence,
    templateId: job.templateId,
    title: job.title,
    orientation: preview.orientation,
    size: preview.size,
    publicVersion: preview.publicVersion,
    candidatePath: relativeToRoot(candidatePath),
    candidateSha256: previewHash,
    candidateApiInputPath: relativeToRoot(candidateApiPath),
    metadataPath: relativeToRoot(metadataPath),
    productionPromptExtensionOnPromotion: job.constraint,
    currentFrozenMasterPath: currentMaster.path,
    currentFrozenMasterSha256: currentMaster.sha256,
    status: "candidate-pending-stability-review",
  });
  console.log(`已准备 ${job.sequence}. ${job.title}`);
}

const identityInputs = [];
for (const identity of stabilityIdentities) {
  const prepared = preparedIdentities.get(identity.id);
  identityInputs.push({
    id: identity.id,
    label: identity.label,
    sourcePath: relativeToRoot(identity.path),
    apiInputPath: relativeToRoot(prepared.path),
    sha256: sha256(prepared.body),
    bytes: prepared.body.byteLength,
    width: prepared.width,
    height: prepared.height,
    quality: prepared.quality,
  });
}

await writeFile(path.join(PROMOTION_ROOT, "index.json"), `${JSON.stringify({
  status: "candidate-pending-stability-review",
  runtimeMasterUseAllowed: false,
  currentFrozenMastersUnchanged: true,
  requestPolicy: {
    provider: "lingsuan",
    endpoint: "/v1/images/edits",
    concurrency: 1,
    outputsPerRequest: 1,
    inputsPerRequest: 2,
    inputFormat: "jpeg",
    maxInputEdge: 1200,
    maxCombinedInputBytesExclusive: 1_000_000,
    comparisonSheetAsInput: false,
  },
  identities: identityInputs,
  templates: records,
  preparedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");

console.log(`候选母版准备完成：${records.length} 项；当前冻结索引未修改`);
