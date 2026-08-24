/** Freeze the 17 animal candidates explicitly approved by the user. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative, buildAnimalPrompt } from "./animal-expansion-catalog.mjs";
import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const ANIMAL_ROOT = path.join(REFERENCE_ROOT, "animal");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_META_ROOT = path.join(MASTER_ROOT, "metadata");
const INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const DISCARDED_ROOT = path.join(import.meta.dirname, "out", ".discarded");
const STORAGE_ROOT = path.join(ROOT, "apps", "platform", ".data", "objects");
const APPROVED_AT = "2026-08-18T01:00:00+08:00";

const heldForRerun = new Set([
  "animal-enamel-dragon",
  "animal-ink-scratch-portrait",
  "animal-watercolor-cat-closeup",
  "animal-giant-law-poster",
  "animal-tiger-storm",
  "animal-rabbit-yokai",
  "animal-fantasy-double-exposure"
]);
const approvals = animalJobs.filter((job) => !heldForRerun.has(job.templateId));
if (approvals.length !== 17) throw new Error(`Expected 17 approved animal templates, got ${approvals.length}`);

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function loadOrRecoverMetadata(job, spec, sourceMetaPath, candidatePath, candidateBody, candidateDigest) {
  const sourceBody = await readFile(sourceMetaPath);
  try {
    return JSON.parse(sourceBody.toString("utf8"));
  } catch (error) {
    await mkdir(DISCARDED_ROOT, { recursive: true });
    const backupName = `${path.basename(sourceMetaPath, ".json")}.corrupt-${sha256(sourceBody).slice(0, 12)}.json`;
    const backupPath = path.join(DISCARDED_ROOT, backupName);
    await writeFile(backupPath, sourceBody);

    const [effectBody, identityBody] = await Promise.all([
      readFile(job.effectReferencePath),
      readFile(job.identity.path)
    ]);
    console.warn(`Recovered corrupt metadata for ${job.templateId}; backup: ${animalRelative(backupPath)}`);
    return {
      templateId: job.templateId,
      entryId: job.entryId,
      title: job.title,
      sourceEffectFile: animalRelative(job.effectReferencePath),
      status: "generated-pending-user-approval",
      provider: "lingsuan",
      model: "gpt-image-2",
      endpoint: "/v1/images/edits",
      inputs: [
        {
          role: "one-time-third-party-effect-reference",
          path: animalRelative(job.effectReferencePath),
          sha256: sha256(effectBody)
        },
        {
          role: "self-owned-pet-identity-reference",
          identityId: job.identityId,
          species: job.identity.species,
          breed: job.identity.breed,
          path: animalRelative(job.identity.path),
          sha256: sha256(identityBody)
        }
      ],
      runtimeThirdPartyEffectReferenceIncluded: false,
      sceneChangeBudget: "0%",
      queue: {
        configuredConcurrency: 20,
        localWorkerConcurrency: 20,
        maxRetriesPerTask: 3,
        maxAttemptsPerTask: 4
      },
      maskIncluded: false,
      coordinatePatchIncluded: false,
      inputFidelity: "high",
      orientation: job.orientation,
      requestedSize: spec.size,
      outputSize: spec.size,
      quality: "high",
      prompt: buildAnimalPrompt(job),
      revisedPrompt: null,
      output: { path: animalRelative(candidatePath), sha256: candidateDigest },
      review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
      generationAttempts: null,
      metadataRecovery: {
        reason: error instanceof Error ? error.message : String(error),
        corruptBackupPath: animalRelative(backupPath),
        recoveredAt: new Date().toISOString()
      }
    };
  }
}

const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
if (!Array.isArray(index.templates)) throw new Error("masters/index.json templates must be an array");

const frozenEntries = [];
for (const job of approvals) {
  const spec = expansionOutputSpecs[job.orientation];
  const basename = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const filename = `${basename}.png`;
  const candidate = path.join(ANIMAL_ROOT, "candidates", filename);
  const sourceMetaPath = path.join(ANIMAL_ROOT, "metadata", `${basename}.json`);
  const master = path.join(MASTER_ROOT, filename);
  const masterMeta = path.join(MASTER_META_ROOT, `${basename}.json`);
  const body = await readFile(candidate);
  const actual = await dimensions(body);
  if (actual.width !== spec.width || actual.height !== spec.height) {
    throw new Error(`${job.templateId} must be ${spec.size}, got ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(body)) throw new Error(`${job.templateId} has no usable visual content`);

  const digest = sha256(body);
  const metadata = await loadOrRecoverMetadata(job, spec, sourceMetaPath, candidate, body, digest);
  if (metadata.templateId !== job.templateId) throw new Error(`${job.templateId} metadata mismatch`);
  if (metadata.output?.sha256 !== digest) throw new Error(`${job.templateId} candidate hash mismatch`);
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error(`${job.templateId} runtime reference contract mismatch`);

  await mkdir(MASTER_ROOT, { recursive: true });
  await mkdir(MASTER_META_ROOT, { recursive: true });
  await copyFile(candidate, master);
  const frozen = {
    ...metadata,
    status: "approved-frozen-master",
    candidatePath: animalRelative(candidate),
    masterPath: animalRelative(master),
    masterSha256: digest,
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户确认本批次除七个待重做模板外，其余动物效果候选均通过并保存为母版。"
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: { role: "self-owned-frozen-master", path: animalRelative(master), sha256: digest },
      image2: { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "unapproved-candidate"]
    },
    review: {
      ...metadata.review,
      state: "approved-by-user",
      finalApproval: "approved",
      approvedAt: APPROVED_AT,
      findings: []
    }
  };
  await writeFile(sourceMetaPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  await writeFile(masterMeta, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");

  const storageKey = `samples/image-templates/${job.templateId}-${digest.slice(0, 12)}.png`;
  const storagePath = path.join(STORAGE_ROOT, storageKey);
  await mkdir(path.dirname(storagePath), { recursive: true });
  await writeFile(storagePath, body);
  await writeFile(`${storagePath}.meta`, JSON.stringify({ contentType: "image/png" }), "utf8");

  const entry = {
    templateId: job.templateId,
    title: job.title,
    orientation: job.orientation,
    size: spec.size,
    path: animalRelative(master),
    sha256: digest,
    metadata: animalRelative(masterMeta),
    approvedAt: APPROVED_AT
  };
  const at = index.templates.findIndex((item) => item.templateId === entry.templateId);
  if (at >= 0) index.templates[at] = entry;
  else index.templates.push(entry);
  frozenEntries.push({ ...entry, storageKey });
  console.log(`Frozen ${job.templateId}: ${entry.path}`);
}

index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
index.runtimeInputs = ["self-owned-frozen-master", "authorized-user-owner-identity-reference-when-required", "user-pet-identity-reference"];
index.excludesAtRuntime = ["third-party-effect-reference"];
await writeFile(INDEX_PATH, `${JSON.stringify(index, null, 2)}\n`, "utf8");
await writeFile(path.join(ANIMAL_ROOT, "approved-v01.json"), `${JSON.stringify({
  status: "partially-approved",
  approvedAt: APPROVED_AT,
  approvedCount: frozenEntries.length,
  pendingRerun: [...heldForRerun],
  templates: frozenEntries
}, null, 2)}\n`, "utf8");
console.log(`Updated ${animalRelative(INDEX_PATH)}: ${index.templates.length} templates`);
