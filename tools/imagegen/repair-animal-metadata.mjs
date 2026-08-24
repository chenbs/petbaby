/** Repair only animal candidate metadata files that are not valid JSON. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative, buildAnimalPrompt } from "./animal-expansion-catalog.mjs";
import { dimensions } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const ANIMAL_ROOT = path.join(OUTPUT_ROOT, "animal");
const METADATA_ROOT = path.join(ANIMAL_ROOT, "metadata");
const CANDIDATE_ROOT = path.join(ANIMAL_ROOT, "candidates");
const MASTER_INDEX_PATH = path.join(OUTPUT_ROOT, "masters", "index.json");
const DISCARDED_ROOT = path.join(import.meta.dirname, "out", ".discarded");

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

async function parseJson(file) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch {
    return null;
  }
}

const masterIndex = await parseJson(MASTER_INDEX_PATH);
const masterByTemplate = new Map((masterIndex?.templates || []).map((item) => [item.templateId, item]));
let repaired = 0;

for (const job of animalJobs) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const sourceBody = await readFile(metadataPath);
  try {
    JSON.parse(sourceBody.toString("utf8"));
    continue;
  } catch {
    await mkdir(DISCARDED_ROOT, { recursive: true });
    const backupPath = path.join(
      DISCARDED_ROOT,
      `${base}.corrupt-${sha256(sourceBody).slice(0, 12)}.json`
    );
    await writeFile(backupPath, sourceBody);

    const master = masterByTemplate.get(job.templateId);
    if (master?.metadata) {
      const masterMetadataPath = path.resolve(import.meta.dirname, "../..", master.metadata);
      if (await exists(masterMetadataPath)) {
        const masterMetadata = await readFile(masterMetadataPath);
        JSON.parse(masterMetadata.toString("utf8"));
        await writeFile(metadataPath, masterMetadata);
        repaired += 1;
        console.log(`Recovered ${job.templateId} from frozen metadata; backup: ${animalRelative(backupPath)}`);
        continue;
      }
    }

    const [candidateBody, effectBody, identityBody] = await Promise.all([
      readFile(candidatePath),
      readFile(job.effectReferencePath),
      readFile(job.identity.path)
    ]);
    const actual = await dimensions(candidateBody);
    const record = {
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
      outputSize: `${actual.width}x${actual.height}`,
      quality: "high",
      prompt: buildAnimalPrompt(job),
      revisedPrompt: null,
      output: { path: animalRelative(candidatePath), sha256: sha256(candidateBody) },
      review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
      generationAttempts: null,
      metadataRecovery: {
        corruptBackupPath: animalRelative(backupPath),
        recoveredAt: new Date().toISOString()
      }
    };
    await writeFile(metadataPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
    repaired += 1;
    console.log(`Rebuilt ${job.templateId} metadata; backup: ${animalRelative(backupPath)}`);
  }
}

console.log(`Animal metadata repair complete: ${repaired} repaired`);
