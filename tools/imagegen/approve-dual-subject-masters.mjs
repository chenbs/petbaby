import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const DUAL_ROOT = path.join(REFERENCE_ROOT, "dual-subject");
const CANDIDATES = path.join(DUAL_ROOT, "candidates");
const CANDIDATE_META = path.join(DUAL_ROOT, "metadata");
const MASTERS = path.join(REFERENCE_ROOT, "masters");
const MASTER_META = path.join(MASTERS, "metadata");
const INDEX_PATH = path.join(MASTERS, "index.json");
const OWNER_INDEX_PATH = path.join(REFERENCE_ROOT, "owners", "index.json");
const APPROVED_AT = "2026-08-17T00:00:00.000+08:00";

const approved = [
  {
    templateId: "fish-chase",
    title: "偷鱼大作战",
    orientation: "portrait",
    size: "720x1280",
    filename: "fish-chase_owner-f01_tuxedo-cat_9x16_v01.png",
  },
  {
    templateId: "garden-together",
    title: "和你在花园",
    orientation: "portrait",
    size: "720x1280",
    filename: "garden-together_owner-f02_cream-cat_9x16_v01.png",
  },
  {
    templateId: "street-comic-together",
    title: "潮流漫画合照",
    orientation: "portrait",
    size: "720x1280",
    filename: "street-comic-together_owner-m01_shiba-dog_9x16_v01.png",
  },
  {
    templateId: "night-together",
    title: "夜间宠物合影",
    orientation: "portrait",
    size: "720x1280",
    filename: "night-together_owner-m02_husky-dog_9x16_v01.png",
  },
];

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

await mkdir(MASTERS, { recursive: true });
await mkdir(MASTER_META, { recursive: true });

const current = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const approvedIds = new Set(approved.map((item) => item.templateId));
const frozenEntries = [];

for (const item of approved) {
  const candidatePath = path.join(CANDIDATES, item.filename);
  const masterPath = path.join(MASTERS, item.filename);
  const metadataFilename = `${path.parse(item.filename).name}.json`;
  const sourceMetadataPath = path.join(CANDIDATE_META, metadataFilename);
  const masterMetadataPath = path.join(MASTER_META, metadataFilename);
  const body = await readFile(candidatePath);
  const sourceMetadata = JSON.parse(await readFile(sourceMetadataPath, "utf8"));
  const frozenMetadata = {
    ...sourceMetadata,
    status: "approved-frozen-master",
    candidatePath: relativeToRoot(candidatePath),
    masterPath: relativeToRoot(masterPath),
    masterSha256: sha256(body),
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "四张双主体母版已由用户逐组查看并明确审批通过。",
    },
    ownerSourcePhotoPublicSampleAllowed: false,
    approvedDerivedMasterPublicSampleAllowed: true,
    visualReview: {
      ...sourceMetadata.visualReview,
      state: "approved-by-user",
      approvedAt: APPROVED_AT,
    },
  };

  await copyFile(candidatePath, masterPath);
  await writeFile(sourceMetadataPath, `${JSON.stringify(frozenMetadata, null, 2)}\n`, "utf8");
  await writeFile(masterMetadataPath, `${JSON.stringify(frozenMetadata, null, 2)}\n`, "utf8");
  frozenEntries.push({
    templateId: item.templateId,
    title: item.title,
    orientation: item.orientation,
    size: item.size,
    subjectMode: "owner-pet",
    path: relativeToRoot(masterPath),
    sha256: frozenMetadata.masterSha256,
    metadata: relativeToRoot(masterMetadataPath),
    approvedAt: APPROVED_AT,
  });
  console.log(`已冻结 ${item.templateId}: ${relativeToRoot(masterPath)}`);
}

const templates = [
  ...current.templates.filter((item) => !approvedIds.has(item.templateId)),
  ...frozenEntries,
];

await writeFile(INDEX_PATH, `${JSON.stringify({
  ...current,
  approvedAt: APPROVED_AT,
  runtimeInputs: [
    "self-owned-frozen-master",
    "authorized-user-owner-identity-reference-when-required",
    "user-pet-identity-reference",
  ],
  runtimeInputOrderBySubjectMode: {
    pet: ["self-owned-frozen-master", "user-pet-identity-reference"],
    "owner-pet": ["self-owned-frozen-master", "authorized-user-owner-identity-reference", "user-pet-identity-reference"],
  },
  excludesAtRuntime: ["third-party-effect-reference"],
  templates,
  updatedAt: APPROVED_AT,
}, null, 2)}\n`, "utf8");

const ownerIndex = JSON.parse(await readFile(OWNER_INDEX_PATH, "utf8"));
await writeFile(OWNER_INDEX_PATH, `${JSON.stringify({
  ...ownerIndex,
  derivedMasterPolicy: {
    sourcePhotosRemainPrivate: true,
    stabilityOutputsRemainInternal: true,
    approvedDerivedMastersMayBePublishedAsTemplateSamples: true,
    approvalBasis: "user-reviewed-and-approved-all-four-derived-masters",
    approvedAt: APPROVED_AT,
    templateIds: approved.map((item) => item.templateId),
  },
}, null, 2)}\n`, "utf8");

console.log(`冻结索引已更新：${templates.length} 个模板`);
