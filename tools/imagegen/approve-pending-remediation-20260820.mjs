/** Freeze the eight user-approved pending remediation candidates. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionJobs, expansionOutputSpecs, relativeToRoot } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const REMEDIATION_ROOT = path.join(REFERENCE_ROOT, "pending-remediation-20260820");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_METADATA_ROOT = path.join(MASTER_ROOT, "metadata");
const MASTER_INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const PUBLIC_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");
const DEPLOY_MANIFEST_PATH = path.join(REFERENCE_ROOT, "deploy-assets.tsv");
const APPROVED_AT = "2026-08-20T14:00:00+08:00";
const approvedIds = [
  "fun-chef-expression-grid",
  "fun-scream-reaction",
  "fun-comic-panels",
  "fun-beach-caption",
  "fun-bunny-reaction",
  "fun-fisheye-closeup",
  "travel-paris-dog-selfie",
  "archive-fish-anatomy",
];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const masterIndex = await readJson(MASTER_INDEX_PATH);
const publicIndex = await readJson(PUBLIC_INDEX_PATH);
if (masterIndex.status !== "approved-frozen-master-set" || masterIndex.templates.length !== 71) {
  throw new Error(`冻结索引基线错误: ${masterIndex.templates.length}`);
}
if (publicIndex.status !== "approved-public-preview-set" || publicIndex.templates.length !== 71) {
  throw new Error(`公开图索引基线错误: ${publicIndex.templates.length}`);
}

for (const templateId of approvedIds) {
  const job = expansionJobs.find((item) => item.templateId === templateId);
  if (!job) throw new Error(`缺少模板 ${templateId}`);
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const candidate = path.join(REMEDIATION_ROOT, "candidates", `${base}.png`);
  const sourceMetadataPath = path.join(REMEDIATION_ROOT, "metadata", `${base}.json`);
  const metadata = await readJson(sourceMetadataPath);
  const body = await readFile(candidate);
  const digest = sha256(body);
  const actual = await dimensions(body);
  if (metadata.templateId !== templateId || metadata.review?.finalApproval !== "pending-user") {
    throw new Error(`${templateId} 不是待审批候选`);
  }
  if (metadata.output?.sha256 !== digest || actual.width !== spec.width || actual.height !== spec.height) {
    throw new Error(`${templateId} 候选哈希或尺寸不一致`);
  }
  if (!await hasUsableVisualContent(body)) throw new Error(`${templateId} 候选无有效画面`);

  const masterPath = path.join(MASTER_ROOT, `${base}.png`);
  const masterMetadataPath = path.join(MASTER_METADATA_ROOT, `${base}.json`);
  await copyFile(candidate, masterPath);
  const frozen = {
    ...metadata,
    status: "approved-frozen-master",
    candidatePath: relativeToRoot(candidate),
    masterPath: relativeToRoot(masterPath),
    masterSha256: digest,
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户明确确认 pending-masters-comparison.png 全部审核通过并要求冻结母版。",
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: { role: "self-owned-frozen-master", path: relativeToRoot(masterPath), sha256: digest },
      image2: { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "previous-candidate", "unapproved-candidate"],
    },
    runtimeThirdPartyEffectReferenceIncluded: false,
    review: {
      ...metadata.review,
      state: "approved-by-user",
      finalApproval: "approved",
      approvedAt: APPROVED_AT,
      findings: [],
    },
  };
  await writeJson(sourceMetadataPath, frozen);
  await writeJson(masterMetadataPath, frozen);

  const masterEntry = {
    templateId,
    title: job.title,
    orientation: job.orientation,
    size: spec.size,
    subjectMode: "pet",
    path: relativeToRoot(masterPath),
    sha256: digest,
    metadata: relativeToRoot(masterMetadataPath),
    approvedAt: APPROVED_AT,
  };
  const masterAt = masterIndex.templates.findIndex((item) => item.templateId === templateId);
  if (masterAt >= 0) masterIndex.templates[masterAt] = masterEntry;
  else masterIndex.templates.push(masterEntry);

  const previewEntry = {
    templateId,
    title: job.title,
    orientation: job.orientation,
    size: spec.size,
    path: relativeToRoot(masterPath),
    sha256: digest,
    sampleStorageKey: `samples/image-template-previews/${templateId}-${digest.slice(0, 12)}.png`,
    sourceKind: "frozen-master-byte-fallback",
    publicVersion: "master-byte-fallback",
    masterSha256: digest,
  };
  const previewAt = publicIndex.templates.findIndex((item) => item.templateId === templateId);
  if (previewAt >= 0) publicIndex.templates[previewAt] = previewEntry;
  else publicIndex.templates.push(previewEntry);
  console.log(`已冻结 ${templateId}`);
}

masterIndex.updatedAt = APPROVED_AT;
masterIndex.approvedAt = APPROVED_AT;
publicIndex.updatedAt = APPROVED_AT;
if (masterIndex.templates.length !== 79 || publicIndex.templates.length !== 79) {
  throw new Error(`冻结/公开图数量错误: ${masterIndex.templates.length}/${publicIndex.templates.length}`);
}
await writeJson(MASTER_INDEX_PATH, masterIndex);
await writeJson(PUBLIC_INDEX_PATH, publicIndex);

const lines = ["# kind\tstorage_key\tsource_path\tsha256"];
for (const item of masterIndex.templates) {
  lines.push(["master", `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`, item.path, item.sha256].join("\t"));
}
for (const item of publicIndex.templates) {
  lines.push(["preview", item.sampleStorageKey, item.path, item.sha256].join("\t"));
}
await writeFile(DEPLOY_MANIFEST_PATH, `${lines.join("\n")}\n`, "utf8");
console.log("8 个 pending 候选已冻结，索引更新为 79 个模板");
