/**
 * Promote the user-requested 2026-08-19 remediation set into the frozen library.
 *
 * This script is intentionally idempotent: promoted versions are never overwritten,
 * removed templates are moved into the recoverable .discarded audit area, and a
 * separate public-preview index is rebuilt from the resulting frozen set.
 */
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_METADATA_ROOT = path.join(MASTER_ROOT, "metadata");
const MASTER_INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const REMEDIATION_ROOT = path.join(REFERENCE_ROOT, "remediation-20260819");
const REMEDIATION_METADATA_ROOT = path.join(REMEDIATION_ROOT, "metadata");
const PUBLIC_ROOT = path.join(REFERENCE_ROOT, "public-previews");
const PUBLIC_METADATA_ROOT = path.join(PUBLIC_ROOT, "metadata");
const PUBLIC_INDEX_PATH = path.join(PUBLIC_ROOT, "index.json");
const DEPLOY_MANIFEST_PATH = path.join(REFERENCE_ROOT, "deploy-assets.tsv");
const RETIRED_STORAGE_KEYS_PATH = path.join(REFERENCE_ROOT, "retired-storage-keys.txt");
const DISCARDED_ROOT = path.join(import.meta.dirname, "out", ".discarded", "frozen-master-remediation-20260819");
const DISCARDED_INDEX_PATH = path.join(DISCARDED_ROOT, "index.json");
const LOCAL_OBJECT_ROOT = path.join(ROOT, "apps", "platform", ".data", "objects");
const APPROVED_AT = "2026-08-19T14:10:00+08:00";

const promotions = [
  ["mini-companion", "master-mini-companion.json", "strong heroic low-angle view, large cat's left foreleg set farther left, and identical adult duplicates with correctly worn goggles"],
  ["epic-ruins", "master-epic-ruins.json", "true 16:9 cinematic ruin panorama with the armoured adult German Shepherd in the left third and monumental ruins across the middle and right"],
  ["fish-chase", "master-fish-chase.json", "strong fisheye close-up, very large startled cat eyes, and an urgent angry owner shouting behind the cat"],
  ["animal-headphone-streetwear", "master-animal-headphone-streetwear.json", "clearly Q-version cartoon face and proportions while retaining the headphones and streetwear layout"],
  ["animal-sunglasses-rabbit", "master-animal-sunglasses-rabbit.json", "face and ears as fully fluffy and painterly as the body"],
  ["animal-capybara-snapshot", "master-animal-capybara-snapshot.json", "serious unsmiling candid expression"],
  ["animal-enamel-cat-beast", "master-animal-enamel-cat-beast.json", "unmistakable majestic adult seal-bicolour Ragdoll identity in the fluid enamel divine-beast scene"],
  ["animal-glass-paw-portrait", "master-animal-glass-paw-portrait.json", "cute adult toy poodle identity with the face-crossing caustic light preserved through the water surface"],
  ["animal-warrior-cat", "master-animal-warrior-cat.json", "brighter readable ancient-warrior scene without changing the subject, pose or costume"],
  ["animal-sunglasses-rabbit-alt", "master-animal-sunglasses-rabbit-alt.json", "loose intentionally rough face-and-ear brushwork matching the effect reference"],
  ["animal-sword-cat-alt", "master-animal-sword-cat-alt.json", "light-grey Abyssinian-like adult cat matching the effect reference while retaining the independent sword pose and costume"],
  ["animal-giant-law-poster", "master-animal-giant-law-poster.json", "smaller face, much more monumental humanoid body and imposing upright divine-form silhouette"],
  ["animal-rabbit-yokai", "master-animal-rabbit-yokai.json", "refined face, ears, costume, ornament and fantasy-lighting detail"],
].map(([templateId, metadataFile, acceptance]) => ({ templateId, metadataFile, acceptance }));

const subjectOverrides = {
  "animal-enamel-cat-beast": { subject: "ragdoll-cat", breed: "成年海豹双色布偶猫" },
  "animal-glass-paw-portrait": { subject: "poodle-dog", breed: "成年玩具贵宾犬（泰迪）" },
  "animal-sword-cat-alt": { subject: "abyssinian-cat", breed: "成年浅灰色阿比西尼亚猫" },
};

const discardedTemplateIds = new Set([
  "animal-gold-ink-fox",
  "animal-robot-poster",
]);

const publicPreviewMetadataFiles = [
  "public-leaping-cover.json",
  "public-exaggerated-expression.json",
  "public-dessert-shopkeeper.json",
  "public-original-magic-academy.json",
  "public-animal-giant-city-companion.json",
  "public-animal-doodle-fisheye-chicken.json",
  "public-animal-car-window-westie.json",
  "public-animal-ink-scratch-portrait.json",
];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function resolveWorkspacePath(file) {
  return path.isAbsolute(file) ? file : path.resolve(ROOT, file);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function assertImage(file, expectedSize, expectedSha256) {
  const body = await readFile(file);
  const digest = sha256(body);
  if (digest !== expectedSha256) throw new Error(`${relativeToRoot(file)} SHA-256 不一致`);
  if (!await hasUsableVisualContent(body)) throw new Error(`${relativeToRoot(file)} 没有可用图像内容`);
  const actual = await dimensions(body);
  const [width, height] = expectedSize.split("x").map(Number);
  if (actual.width !== width || actual.height !== height) {
    throw new Error(`${relativeToRoot(file)} 尺寸错误：预期 ${expectedSize}，实际 ${actual.width}x${actual.height}`);
  }
  return body;
}

async function promoteMaster(index, promotion) {
  const remediationPath = path.join(REMEDIATION_METADATA_ROOT, promotion.metadataFile);
  const remediation = await readJson(remediationPath);
  if (remediation.templateId !== promotion.templateId || remediation.kind !== "master") {
    throw new Error(`${promotion.metadataFile} 与晋升任务 ${promotion.templateId} 不匹配`);
  }

  const source = resolveWorkspacePath(remediation.output.finalPath);
  const body = await assertImage(source, remediation.requestedSize, remediation.output.sha256);
  const master = path.join(MASTER_ROOT, path.basename(source));
  const masterMetadata = path.join(MASTER_METADATA_ROOT, `${path.parse(master).name}.json`);
  const currentIndex = index.templates.findIndex((item) => item.templateId === promotion.templateId);
  if (currentIndex < 0) throw new Error(`冻结索引缺少待晋升模板 ${promotion.templateId}`);
  const previous = index.templates[currentIndex];

  if (previous.path === relativeToRoot(master) && previous.sha256 === remediation.output.sha256) {
    if (!await exists(master) || !await exists(masterMetadata)) {
      throw new Error(`${promotion.templateId} 已登记新版本但母版或元数据缺失`);
    }
    return;
  }

  const previousMetadata = await readJson(resolveWorkspacePath(previous.metadata));
  await mkdir(MASTER_ROOT, { recursive: true });
  await copyFile(source, master);

  const frozen = {
    ...previousMetadata,
    ...subjectOverrides[promotion.templateId],
    templateId: promotion.templateId,
    status: "approved-frozen-master",
    version: remediation.version,
    provider: remediation.provider,
    model: remediation.model,
    endpoint: remediation.endpoint,
    orientation: remediation.orientation,
    requestedSize: remediation.requestedSize,
    outputSize: remediation.requestedSize,
    inputFidelity: remediation.inputFidelity,
    prompt: remediation.prompt,
    revisedPrompt: remediation.revisedPrompt,
    generatedAt: remediation.generatedAt,
    output: {
      path: remediation.output.finalPath,
      rawPath: remediation.output.rawPath,
      sha256: remediation.output.sha256,
    },
    candidatePath: remediation.output.finalPath,
    masterPath: relativeToRoot(master),
    masterSha256: remediation.output.sha256,
    supersedes: {
      version: previousMetadata.version,
      path: previous.path,
      sha256: previous.sha256,
      metadata: previous.metadata,
    },
    remediationRequest: {
      ...remediation,
      status: "approved-and-promoted",
      approvedAt: APPROVED_AT,
    },
    review: {
      state: "approved-by-user-request",
      finalApproval: "approved",
      findings: [],
      approvedAt: APPROVED_AT,
    },
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户于 2026-08-19 明确要求按逐项意见返工并完成；候选已逐张目视复核后冻结为新版本。",
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: {
        role: "self-owned-frozen-master",
        path: relativeToRoot(master),
        sha256: remediation.output.sha256,
      },
      image2: previousMetadata.runtimeReferenceContract?.image2 || { role: "user-pet-identity-only" },
      ...(previousMetadata.runtimeReferenceContract?.image3
        ? { image3: previousMetadata.runtimeReferenceContract.image3 }
        : {}),
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "previous-failed-candidate", "unapproved-candidate"],
    },
    qualityBaseline: {
      required: [
        promotion.acceptance,
        `exact ${remediation.requestedSize} ${remediation.orientation} output`,
        "clean finished image without platform UI, account IDs, logos, watermarks or signatures",
      ],
      reject: [
        "regression of the composition, expression, gaze, identity, texture or anatomy corrected by this remediation",
        "extra subjects, duplicate or malformed anatomy, broken costume contacts, logo, watermark or signature",
      ],
    },
  };
  await writeJson(masterMetadata, frozen);

  index.templates[currentIndex] = {
    ...previous,
    orientation: remediation.orientation,
    size: remediation.requestedSize,
    path: relativeToRoot(master),
    sha256: sha256(body),
    metadata: relativeToRoot(masterMetadata),
    approvedAt: APPROVED_AT,
  };
  console.log(`已晋升 ${promotion.templateId} ${remediation.version}`);
}

async function archiveDiscarded(index) {
  const previousManifest = await readJson(DISCARDED_INDEX_PATH).catch(() => ({ templates: [] }));
  const archived = new Map(previousManifest.templates.map((item) => [item.templateId, item]));

  for (const templateId of discardedTemplateIds) {
    const item = index.templates.find((entry) => entry.templateId === templateId);
    if (!item) {
      if (!archived.has(templateId)) throw new Error(`下架模板 ${templateId} 既不在冻结索引，也不在审计归档`);
      continue;
    }

    const sourceMaster = resolveWorkspacePath(item.path);
    const sourceMetadata = resolveWorkspacePath(item.metadata);
    const archivedMaster = path.join(DISCARDED_ROOT, "masters", path.basename(sourceMaster));
    const archivedMetadata = path.join(DISCARDED_ROOT, "metadata", path.basename(sourceMetadata));
    await mkdir(path.dirname(archivedMaster), { recursive: true });
    await mkdir(path.dirname(archivedMetadata), { recursive: true });
    if (await exists(sourceMaster)) await rename(sourceMaster, archivedMaster);
    if (await exists(sourceMetadata)) await rename(sourceMetadata, archivedMetadata);
    archived.set(templateId, {
      ...item,
      removedAt: APPROVED_AT,
      removedBy: "user",
      reason: "用户明确判定效果不佳并要求直接下架",
      archivedMasterPath: relativeToRoot(archivedMaster),
      archivedMetadataPath: relativeToRoot(archivedMetadata),
    });
    console.log(`已下架并归档 ${templateId}`);
  }

  index.templates = index.templates.filter((item) => !discardedTemplateIds.has(item.templateId));
  await writeJson(DISCARDED_INDEX_PATH, {
    status: "discarded-recoverable-audit",
    updatedAt: APPROVED_AT,
    templates: [...archived.values()].sort((a, b) => a.templateId.localeCompare(b.templateId)),
  });

  for (const item of archived.values()) {
    const storageKey = `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`;
    const sourceObject = path.join(LOCAL_OBJECT_ROOT, storageKey);
    const archivedObject = path.join(DISCARDED_ROOT, "local-object-storage", storageKey);
    await mkdir(path.dirname(archivedObject), { recursive: true });
    if (await exists(sourceObject)) await rename(sourceObject, archivedObject);
    if (await exists(`${sourceObject}.meta`)) await rename(`${sourceObject}.meta`, `${archivedObject}.meta`);
  }
  return [...archived.values()];
}

async function buildPublicPreviewIndex(masterIndex) {
  const custom = new Map();
  await mkdir(PUBLIC_METADATA_ROOT, { recursive: true });
  for (const metadataFile of publicPreviewMetadataFiles) {
    const remediation = await readJson(path.join(REMEDIATION_METADATA_ROOT, metadataFile));
    if (remediation.kind !== "public") throw new Error(`${metadataFile} 不是公开样图任务`);
    const source = resolveWorkspacePath(remediation.output.finalPath);
    const body = await assertImage(source, remediation.requestedSize, remediation.output.sha256);
    const target = path.join(PUBLIC_ROOT, path.basename(source));
    const targetMetadata = path.join(PUBLIC_METADATA_ROOT, `${path.parse(target).name}.json`);
    await copyFile(source, target);
    await writeJson(targetMetadata, {
      ...remediation,
      status: "approved-public-preview",
      approvedAt: APPROVED_AT,
      publicPath: relativeToRoot(target),
      publicSha256: sha256(body),
      publicUseAllowed: true,
      approval: {
        state: "approved-for-mini-program-display",
        approvedBy: "user-request",
        approvedAt: APPROVED_AT,
      },
    });
    custom.set(remediation.templateId, {
      path: relativeToRoot(target),
      sha256: sha256(body),
      metadata: relativeToRoot(targetMetadata),
      publicVersion: remediation.version,
      sourceKind: "dedicated-public-preview",
    });
  }

  const templates = [];
  for (const item of masterIndex.templates) {
    const customPreview = custom.get(item.templateId);
    const source = resolveWorkspacePath(customPreview?.path || item.path);
    const body = await readFile(source);
    const digest = sha256(body);
    if (customPreview && digest !== customPreview.sha256) throw new Error(`${item.templateId} 公开样图哈希不一致`);
    if (!customPreview && digest !== item.sha256) throw new Error(`${item.templateId} 母版回退样图哈希不一致`);
    templates.push({
      templateId: item.templateId,
      title: item.title,
      orientation: item.orientation,
      size: item.size,
      path: relativeToRoot(source),
      sha256: digest,
      sampleStorageKey: `samples/image-template-previews/${item.templateId}-${digest.slice(0, 12)}.png`,
      sourceKind: customPreview?.sourceKind || "frozen-master-byte-fallback",
      publicVersion: customPreview?.publicVersion || "master-byte-fallback",
      ...(customPreview?.metadata ? { metadata: customPreview.metadata } : {}),
      masterSha256: item.sha256,
    });
  }

  if (templates.length !== 45) throw new Error(`公开样图数量错误：预期 45，实际 ${templates.length}`);
  if (custom.size !== publicPreviewMetadataFiles.length) throw new Error("公开样图任务存在重复 templateId");
  for (const templateId of custom.keys()) {
    if (!templates.some((item) => item.templateId === templateId)) throw new Error(`公开样图 ${templateId} 没有对应 live 模板`);
  }

  await writeJson(PUBLIC_INDEX_PATH, {
    status: "approved-public-preview-set",
    updatedAt: APPROVED_AT,
    publicUseAllowed: true,
    runtimeMasterUseAllowed: false,
    templates,
  });
  console.log(`已生成 ${relativeToRoot(PUBLIC_INDEX_PATH)}：${templates.length} 张公开样图`);
  return templates;
}

async function writeDeployManifests(masterIndex, publicPreviews, discarded) {
  const lines = ["# kind\tstorage_key\tsource_path\tsha256"];
  for (const item of masterIndex.templates) {
    lines.push([
      "master",
      `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`,
      item.path,
      item.sha256,
    ].join("\t"));
  }
  for (const item of publicPreviews) {
    lines.push(["preview", item.sampleStorageKey, item.path, item.sha256].join("\t"));
  }
  await writeFile(DEPLOY_MANIFEST_PATH, `${lines.join("\n")}\n`, "utf8");

  const retiredKeys = new Set();
  for (const item of discarded) {
    const suffix = `${item.templateId}-${item.sha256.slice(0, 12)}.png`;
    retiredKeys.add(`samples/image-templates/${suffix}`);
    retiredKeys.add(`samples/image-template-previews/${suffix}`);
  }
  await writeFile(RETIRED_STORAGE_KEYS_PATH, `${[...retiredKeys].sort().join("\n")}\n`, "utf8");
  console.log(`已生成部署资产清单：${masterIndex.templates.length} 张母版 / ${publicPreviews.length} 张公开样图 / ${retiredKeys.size} 个退役键`);
}

const index = await readJson(MASTER_INDEX_PATH);
if (index.status !== "approved-frozen-master-set" || !Array.isArray(index.templates)) {
  throw new Error(`${MASTER_INDEX_PATH} 不是已批准冻结母版索引`);
}
for (const promotion of promotions) await promoteMaster(index, promotion);
const discarded = await archiveDiscarded(index);
if (index.templates.length !== 45) throw new Error(`冻结母版数量错误：预期 45，实际 ${index.templates.length}`);
index.updatedAt = APPROVED_AT;
await writeJson(MASTER_INDEX_PATH, index);
const publicPreviews = await buildPublicPreviewIndex(index);
await writeDeployManifests(index, publicPreviews, discarded);
console.log("2026-08-19 母版返工晋升完成：13 张新版本、2 个模板下架、45 张公开样图已登记。");
