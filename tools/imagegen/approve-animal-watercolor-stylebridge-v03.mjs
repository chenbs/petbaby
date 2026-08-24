/** Freeze the user-selected stylebridge-v03 watercolor cat candidate. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative } from "./animal-expansion-catalog.mjs";
import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const ANIMAL_ROOT = path.join(REFERENCE_ROOT, "animal");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_META_ROOT = path.join(MASTER_ROOT, "metadata");
const INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const STORAGE_ROOT = path.join(ROOT, "apps", "platform", ".data", "objects");
const PREVIOUS_APPROVAL_PATH = path.join(ANIMAL_ROOT, "approved-v03.json");
const APPROVAL_PATH = path.join(ANIMAL_ROOT, "approved-v04.json");
const APPROVED_AT = "2026-08-18T11:48:29+08:00";
const TEMPLATE_ID = "animal-watercolor-cat-closeup";
const VERSION = "stylebridge-v03";
const PENDING_IDS = ["animal-fantasy-double-exposure"];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const job = animalJobs.find((item) => item.templateId === TEMPLATE_ID);
if (!job) throw new Error(`${TEMPLATE_ID} missing`);
const spec = expansionOutputSpecs[job.orientation];
const basename = `${job.templateId}_${job.identityId}_${spec.ratio}_${VERSION}`;
const filename = `${basename}.png`;
const candidatePath = path.join(ANIMAL_ROOT, "candidates", filename);
const sourceMetadataPath = path.join(ANIMAL_ROOT, "metadata", `${basename}.json`);
const masterPath = path.join(MASTER_ROOT, filename);
const masterMetadataPath = path.join(MASTER_META_ROOT, `${basename}.json`);
const [body, metadataText, indexText, previousApprovalText] = await Promise.all([
  readFile(candidatePath),
  readFile(sourceMetadataPath, "utf8"),
  readFile(INDEX_PATH, "utf8"),
  readFile(PREVIOUS_APPROVAL_PATH, "utf8")
]);
const metadata = JSON.parse(metadataText);
const index = JSON.parse(indexText);
const previousApproval = JSON.parse(previousApprovalText);
const actual = await dimensions(body);
const digest = sha256(body);
if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`${TEMPLATE_ID} size mismatch`);
if (!await hasUsableVisualContent(body)) throw new Error(`${TEMPLATE_ID} has no usable visual content`);
if (metadata.templateId !== TEMPLATE_ID || metadata.version !== VERSION) throw new Error(`${TEMPLATE_ID} metadata mismatch`);
if (metadata.output?.sha256 !== digest) throw new Error(`${TEMPLATE_ID} hash mismatch`);
if (metadata.remediation !== "shared-two-stage-style-bridge") throw new Error(`${TEMPLATE_ID} remediation mismatch`);
if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error(`${TEMPLATE_ID} runtime contract mismatch`);

await Promise.all([
  mkdir(MASTER_ROOT, { recursive: true }),
  mkdir(MASTER_META_ROOT, { recursive: true })
]);
await copyFile(candidatePath, masterPath);
const frozen = {
  ...metadata,
  status: "approved-frozen-master",
  candidatePath: animalRelative(candidatePath),
  masterPath: animalRelative(masterPath),
  masterSha256: digest,
  approval: {
    state: "approved-and-frozen",
    approvedBy: "user",
    approvedAt: APPROVED_AT,
    note: "用户明确选择金箔水彩猫咪 stylebridge-v03，并保存为母版。"
  },
  runtimeReferenceContract: {
    endpoint: "/v1/images/edits",
    provider: "lingsuan",
    image1: { role: "self-owned-frozen-master", path: animalRelative(masterPath), sha256: digest },
    image2: { role: "user-pet-identity-only" },
    inputFidelity: "high",
    sceneChangeBudget: "0%",
    excludes: ["third-party-effect-reference", "pre-stylized-production-guide", "unapproved-candidate"]
  },
  review: {
    ...metadata.review,
    state: "approved-by-user",
    finalApproval: "approved",
    approvedAt: APPROVED_AT,
    findings: []
  }
};
await Promise.all([
  writeFile(sourceMetadataPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8"),
  writeFile(masterMetadataPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8")
]);

const storageKey = `samples/image-templates/${job.templateId}-${digest.slice(0, 12)}.png`;
const storagePath = path.join(STORAGE_ROOT, storageKey);
await mkdir(path.dirname(storagePath), { recursive: true });
await Promise.all([
  writeFile(storagePath, body),
  writeFile(`${storagePath}.meta`, JSON.stringify({ contentType: "image/png" }), "utf8")
]);

const entry = {
  templateId: job.templateId,
  title: job.title,
  orientation: job.orientation,
  size: spec.size,
  path: animalRelative(masterPath),
  sha256: digest,
  metadata: animalRelative(masterMetadataPath),
  approvedAt: APPROVED_AT
};
const indexAt = index.templates.findIndex((item) => item.templateId === TEMPLATE_ID);
if (indexAt >= 0) index.templates[indexAt] = entry;
else index.templates.push(entry);
index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");

const approvedByTemplate = new Map((previousApproval.templates || []).map((item) => [item.templateId, item]));
approvedByTemplate.set(TEMPLATE_ID, { ...entry, storageKey });
const templates = [...approvedByTemplate.values()].sort((a, b) => a.templateId.localeCompare(b.templateId));
await writeFile(APPROVAL_PATH, `${JSON.stringify({
  status: "partially-approved",
  approvedAt: APPROVED_AT,
  approvedCount: templates.length,
  pendingRerun: PENDING_IDS,
  templates
}, null, 2)}\n`, "utf8");

console.log(`Frozen ${TEMPLATE_ID}: ${entry.path}`);
console.log(`Updated ${animalRelative(INDEX_PATH)}: ${index.templates.length} templates`);
console.log(`Updated ${animalRelative(APPROVAL_PATH)}: ${templates.length} approved, ${PENDING_IDS.length} pending`);
