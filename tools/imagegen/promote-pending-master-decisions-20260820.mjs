/** Apply the user's 2026-08-20 decisions for the 38 pending expansion templates. */
import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionJobs, expansionOutputSpecs, relativeToRoot } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const EXPANSION_ROOT = path.join(REFERENCE_ROOT, "expansion");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_METADATA_ROOT = path.join(MASTER_ROOT, "metadata");
const MASTER_INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const PUBLIC_ROOT = path.join(REFERENCE_ROOT, "public-previews");
const PUBLIC_METADATA_ROOT = path.join(PUBLIC_ROOT, "metadata");
const PUBLIC_INDEX_PATH = path.join(PUBLIC_ROOT, "index.json");
const REMEDIATION_ROOT = path.join(REFERENCE_ROOT, "pending-remediation-20260820");
const DEPLOY_MANIFEST_PATH = path.join(REFERENCE_ROOT, "deploy-assets.tsv");
const DISCARDED_ROOT = path.join(import.meta.dirname, "out", ".discarded", "pending-master-decisions-20260820");
const DISCARDED_INDEX_PATH = path.join(DISCARDED_ROOT, "index.json");
const APPROVED_AT = "2026-08-20T12:00:00+08:00";

const revisionIds = new Set([
  "fun-chef-expression-grid",
  "fun-scream-reaction",
  "fun-comic-panels",
  "fun-beach-caption",
  "fun-bunny-reaction",
  "fun-fisheye-closeup",
  "travel-paris-dog-selfie",
  "archive-fish-anatomy",
]);

const discardedTemplateIds = new Set([
  "fun-nose-closeup",
  "fun-3d-anger",
  "travel-beach-selfie",
  "floral-painterly-portrait",
]);

const originalJobRows = [
  ["fun-nose-closeup", "fun", "墨刷半身头像"],
  ["fun-3d-anger", "fun", "蓝金花绘肖像"],
  ["travel-beach-selfie", "travel", "海滩广角自拍"],
  ["floral-painterly-portrait", "art", "粉彩萌系肖像"],
];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
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

async function assertImage(file, spec, digest) {
  const body = await readFile(file);
  if (sha256(body) !== digest) throw new Error(`${relativeToRoot(file)} hash mismatch`);
  if (!await hasUsableVisualContent(body)) throw new Error(`${relativeToRoot(file)} has no usable visual content`);
  const actual = await dimensions(body);
  if (actual.width !== spec.width || actual.height !== spec.height) {
    throw new Error(`${relativeToRoot(file)} is ${actual.width}x${actual.height}, expected ${spec.width}x${spec.height}`);
  }
  return body;
}

function sourcePaths(job) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  return {
    base,
    candidate: path.join(EXPANSION_ROOT, "candidates", `${base}.png`),
    metadata: path.join(EXPANSION_ROOT, "metadata", `${base}.json`),
  };
}

async function freezeApproved(masterIndex, job) {
  const spec = expansionOutputSpecs[job.orientation];
  const source = sourcePaths(job);
  const metadata = await readJson(source.metadata);
  if (metadata.templateId !== job.templateId || metadata.review?.finalApproval !== "pending-user") {
    throw new Error(`${job.templateId} is not an approvable pending candidate`);
  }
  const digest = metadata.output?.sha256;
  const body = await assertImage(source.candidate, spec, digest);
  const master = path.join(MASTER_ROOT, `${source.base}.png`);
  const masterMetadata = path.join(MASTER_METADATA_ROOT, `${source.base}.json`);
  await mkdir(MASTER_ROOT, { recursive: true });
  await copyFile(source.candidate, master);

  const frozen = {
    ...metadata,
    version: job.version,
    status: "approved-frozen-master",
    candidatePath: relativeToRoot(source.candidate),
    masterPath: relativeToRoot(master),
    masterSha256: digest,
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户审阅 pending-masters-comparison 后明确表示除指定重做和删除项外，其余模板可以冻结。",
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: { role: "self-owned-frozen-master", path: relativeToRoot(master), sha256: digest },
      image2: { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "previous-failed-candidate", "unapproved-candidate"],
    },
    runtimeThirdPartyEffectReferenceIncluded: false,
    qualityBaseline: {
      required: [job.guard, `exact ${spec.size} ${job.orientation} output`, "same approved composition, action, expression, lighting, palette, medium and text hierarchy"],
      reject: ["scene redesign or missing distinctive layout details", "juvenilized, malformed, duplicated or inconsistent pet anatomy", "logo, platform UI, account ID, watermark or signature"],
    },
    review: {
      ...metadata.review,
      state: "approved-by-user",
      finalApproval: "approved",
      approvedAt: APPROVED_AT,
      findings: [],
    },
  };
  await writeJson(source.metadata, frozen);
  await writeJson(masterMetadata, frozen);

  const entry = {
    templateId: job.templateId,
    title: job.title,
    orientation: job.orientation,
    size: spec.size,
    subjectMode: "pet",
    path: relativeToRoot(master),
    sha256: sha256(body),
    metadata: relativeToRoot(masterMetadata),
    approvedAt: APPROVED_AT,
  };
  const at = masterIndex.templates.findIndex((item) => item.templateId === job.templateId);
  if (at >= 0) masterIndex.templates[at] = entry;
  else masterIndex.templates.push(entry);
  console.log(`已冻结 ${job.templateId}`);
}

async function archiveDiscardedCandidates() {
  const archived = [];
  for (const [templateId, entryId, title] of originalJobRows) {
    for (const folder of ["candidates", "raw", "metadata"]) {
      const sourceFolder = path.join(EXPANSION_ROOT, folder);
      const names = (await readdir(sourceFolder)).filter((name) => name.startsWith(`${templateId}_`));
      for (const name of names) {
        const source = path.resolve(sourceFolder, name);
        const expectedRoot = `${path.resolve(EXPANSION_ROOT)}${path.sep}`;
        if (!source.startsWith(expectedRoot)) throw new Error(`Archive target escaped expansion root: ${source}`);
        const destination = path.join(DISCARDED_ROOT, "expansion", folder, name);
        await mkdir(path.dirname(destination), { recursive: true });
        if (!await exists(destination)) await rename(source, destination);
        archived.push({ templateId, kind: folder, path: relativeToRoot(destination) });
      }
    }
    archived.push({ templateId, entryId, title, removedAt: APPROVED_AT, removedBy: "user", reason: "用户明确判定效果不佳并要求直接删除；文件移入不可发布的可恢复审计归档。" });
    console.log(`已从产品候选目录移除 ${templateId}`);
  }
  await writeJson(DISCARDED_INDEX_PATH, {
    status: "discarded-recoverable-audit",
    publicUseAllowed: false,
    runtimeUseAllowed: false,
    updatedAt: APPROVED_AT,
    templates: originalJobRows.map(([templateId, entryId, title]) => ({ templateId, entryId, title })),
    archived,
  });
}

async function registerMilkTeaPreview(publicIndex, masterIndex) {
  const sourceMetadata = path.join(REMEDIATION_ROOT, "public-previews", "metadata", "pet-milk-tea-shopkeeper_public-v01.json");
  const metadata = await readJson(sourceMetadata);
  const source = path.resolve(ROOT, metadata.output.path);
  const spec = { width: 720, height: 1280 };
  const body = await assertImage(source, spec, metadata.output.sha256);
  const target = path.join(PUBLIC_ROOT, "pet-milk-tea-shopkeeper_public-v01.png");
  const targetMetadata = path.join(PUBLIC_METADATA_ROOT, "pet-milk-tea-shopkeeper_public-v01.json");
  await copyFile(source, target);
  const approvedMetadata = {
    ...metadata,
    status: "approved-public-preview",
    publicPath: relativeToRoot(target),
    publicSha256: sha256(body),
    publicUseAllowed: true,
    runtimeMasterUseAllowed: false,
    approvedAt: APPROVED_AT,
    approval: { state: "approved-for-mini-program-display", approvedBy: "user-request", approvedAt: APPROVED_AT },
    review: { state: "approved-by-user-request", finalApproval: "approved", findings: [], approvedAt: APPROVED_AT },
  };
  await writeJson(sourceMetadata, approvedMetadata);
  await writeJson(targetMetadata, approvedMetadata);

  const master = masterIndex.templates.find((item) => item.templateId === "pet-milk-tea-shopkeeper");
  if (!master) throw new Error("pet-milk-tea-shopkeeper master was not frozen");
  const entry = {
    templateId: master.templateId,
    title: master.title,
    orientation: master.orientation,
    size: master.size,
    path: relativeToRoot(target),
    sha256: sha256(body),
    sampleStorageKey: `samples/image-template-previews/pet-milk-tea-shopkeeper-${sha256(body).slice(0, 12)}.png`,
    sourceKind: "dedicated-public-preview",
    publicVersion: "public-v01",
    metadata: relativeToRoot(targetMetadata),
    masterSha256: master.sha256,
  };
  const at = publicIndex.templates.findIndex((item) => item.templateId === entry.templateId);
  if (at >= 0) publicIndex.templates[at] = entry;
  else publicIndex.templates.push(entry);
  console.log("已登记 pet-milk-tea-shopkeeper 独立公开展示图");
}

async function appendFallbackPreviews(publicIndex, masterIndex, approvedJobs) {
  const approvedIds = new Set(approvedJobs.map((job) => job.templateId));
  for (const master of masterIndex.templates) {
    if (!approvedIds.has(master.templateId) || master.templateId === "pet-milk-tea-shopkeeper") continue;
    const entry = {
      templateId: master.templateId,
      title: master.title,
      orientation: master.orientation,
      size: master.size,
      path: master.path,
      sha256: master.sha256,
      sampleStorageKey: `samples/image-template-previews/${master.templateId}-${master.sha256.slice(0, 12)}.png`,
      sourceKind: "frozen-master-byte-fallback",
      publicVersion: "master-byte-fallback",
      masterSha256: master.sha256,
    };
    const at = publicIndex.templates.findIndex((item) => item.templateId === entry.templateId);
    if (at >= 0) publicIndex.templates[at] = entry;
    else publicIndex.templates.push(entry);
  }
}

async function writeDeployManifest(masterIndex, publicIndex) {
  const lines = ["# kind\tstorage_key\tsource_path\tsha256"];
  for (const item of masterIndex.templates) {
    lines.push(["master", `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`, item.path, item.sha256].join("\t"));
  }
  for (const item of publicIndex.templates) {
    lines.push(["preview", item.sampleStorageKey, item.path, item.sha256].join("\t"));
  }
  await writeFile(DEPLOY_MANIFEST_PATH, `${lines.join("\n")}\n`, "utf8");
}

const masterIndex = await readJson(MASTER_INDEX_PATH);
const publicIndex = await readJson(PUBLIC_INDEX_PATH);
if (masterIndex.status !== "approved-frozen-master-set" || masterIndex.templates.length !== 45) {
  throw new Error("Expected the existing 45-template frozen master set");
}
if (publicIndex.status !== "approved-public-preview-set" || publicIndex.templates.length !== 45) {
  throw new Error("Expected the existing 45-template public preview set");
}

const approvedJobs = expansionJobs.filter((job) => !revisionIds.has(job.templateId));
if (approvedJobs.length !== 26) throw new Error(`Expected 26 directly approved jobs, got ${approvedJobs.length}`);
if (approvedJobs.some((job) => discardedTemplateIds.has(job.templateId))) throw new Error("Discarded template remained in expansion catalog");
for (const job of approvedJobs) await freezeApproved(masterIndex, job);
await archiveDiscardedCandidates();

masterIndex.approvedAt = APPROVED_AT;
masterIndex.updatedAt = APPROVED_AT;
if (masterIndex.templates.length !== 71) throw new Error(`Expected 71 frozen masters, got ${masterIndex.templates.length}`);
await writeJson(MASTER_INDEX_PATH, masterIndex);

await appendFallbackPreviews(publicIndex, masterIndex, approvedJobs);
await registerMilkTeaPreview(publicIndex, masterIndex);
publicIndex.updatedAt = APPROVED_AT;
if (publicIndex.templates.length !== 71) throw new Error(`Expected 71 public previews, got ${publicIndex.templates.length}`);
await writeJson(PUBLIC_INDEX_PATH, publicIndex);
await writeDeployManifest(masterIndex, publicIndex);
console.log("2026-08-20 审批决策已落盘：26 冻结 / 8 待复核 / 4 可恢复归档 / 1 独立公开展示图");
