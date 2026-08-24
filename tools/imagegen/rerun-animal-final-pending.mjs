/** Generate the two remaining animal candidates from explicit user review notes. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative } from "./animal-expansion-catalog.mjs";
import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const EASTERN_BACKGROUND_PATH = path.join(OUTPUT_ROOT, "user-references", "eastern-dark-myth-background.png");
const MAX_RETRIES = 3;
const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
const workerConcurrency = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || process.env.LINGSUAN_IMAGE_CONCURRENCY || 20)));

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function runWithRetries(label, run) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      console.log(`Start ${label} attempt ${attempt}/${MAX_RETRIES + 1}`);
      return { ...(await run()), attempt };
    } catch (error) {
      lastError = error;
      if (attempt <= MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
    }
  }
  throw lastError;
}

function watercolorPrompt(spec) {
  return [
    "Use case: position-locked identity attribute replacement in an existing watercolor portrait.",
    `Return the exact same ${spec.ratio} composition at ${spec.size} pixels.`,
    "Image 1 is the edit target and absolute authority for every spatial fact. Keep its canvas, crop, close-up scale, head position, head angle, face outline, eye positions, eye spacing, ear positions, ear bases, ear tips, crown position, nose position, muzzle position, negative space, watercolor background, gold accents, paper texture, lighting and all surrounding details unchanged.",
    "Image 2 supplies only the adult Ragdoll identity attributes. Change only these properties on Image 1's existing subject: facial breed features and markings; nose color; eye shape and eye color; ear shape and ear color; coat and fur color.",
    "This is not a new portrait and not a recomposition. Do not move, rotate, resize, recrop, recenter, zoom out or zoom in any eye, ear, nose, head or body region. New eye and ear shapes must remain anchored to the exact original eye and ear locations and occupy the same visual bounds.",
    "The ears, complete crown, forehead, cheeks and muzzle are part of the original subject, never background. Replace their identity attributes in place while preserving their positions and the original watercolor edge treatment. Do not erase, dissolve, reconstruct or relocate them.",
    "Keep Image 1's watercolor and gold-leaf medium exactly. Do not alter the background washes, add a new body, reveal more of the pet, remove existing crop boundaries, or change the amount of visible face and fur.",
    "No text, logo, watermark, signature, extra subject or anatomy change. Return only the finished position-locked edit."
  ].join(" ");
}

function easternMythPrompt(spec) {
  return [
    "Use case: three-reference Eastern dark-mythology double-exposure composition.",
    `Return an exact ${spec.ratio} composition at ${spec.size} pixels.`,
    "Image 1 is the authority for the double-exposure design: preserve its large side-profile pet silhouette, profile orientation, mask boundaries, layered scene-inside-subject effect, tiny human scale cues, cinematic depth, crop, visual hierarchy and painterly integration.",
    "Image 2 is the actual background and mythology setting authority. Use its mist-filled Chinese mountain temple city, dark tiled roofs, cliff bridges, river path, deep ravines, storm clouds, colossal multi-armed black-stone guardian deity, restrained charcoal palette and red eye accents as the full environmental foundation and as the detailed landscape embedded inside the pet silhouette.",
    "Image 3 is the sole pet identity authority. Replace the original profile subject with this exact healthy adult black Labrador, recognizable through its black coat, floppy ears, broad mature muzzle and adult proportions, while rendering it in Image 1's dark painterly double-exposure language.",
    "Create an original Eastern traditional dark-mythology setting: an ancient mountain sanctuary awakened beneath storm clouds, with the many-armed guardian looming over layered cliff temples and bridge networks while tiny pilgrims cross the river town below. Keep the mood ominous, sacred, monumental and mysterious rather than gory.",
    "The mythology must be unmistakably East Asian and specifically rooted in traditional Chinese mountain-temple visual language. No Western gothic cathedral, European castle, hellhound, demon gate, medieval armor, lava underworld, Western occult symbols or generic dark-fantasy citadel.",
    "Remove the 'AI生成' label and every watermark, account name, caption and logo from Image 2. Render no text anywhere. Do not reproduce Journey to the West, Monkey King, a known copyrighted character or a named artist style.",
    "Keep the scene dense and layered with foreground roofs, middle-ground bridges and river settlement, distant misty peaks and the colossal guardian. Preserve clear double-exposure blending rather than producing a plain pet portrait or merely placing a dog in front of the background. Return only the finished image."
  ].join(" ");
}

async function generateCandidate(config, { job, version, remediation, imagePaths, prompt, extraMetadata }) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${version}`;
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const rawPath = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  const generated = await runWithRetries(`${job.templateId}:${version}`, async () => {
    const result = await edit(config, {
      imagePaths,
      prompt,
      size: spec.size,
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      maxRetries: 0
    });
    if (!await hasUsableVisualContent(result.buffer)) throw new Error("output has no usable visual content");
    const final = await fit(result.buffer, job.orientation, { anchor: 0.38, format: "png" });
    const actual = await dimensions(final);
    if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`output size ${actual.width}x${actual.height}`);
    return { result, final, actual };
  });
  await Promise.all([
    writeFile(rawPath, generated.result.buffer),
    writeFile(candidatePath, generated.final)
  ]);
  const inputBodies = await Promise.all(imagePaths.map((file) => readFile(file)));
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    version,
    status: "generated-pending-user-approval",
    remediation,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: imagePaths.map((file, index) => ({
      ...extraMetadata.inputs[index],
      path: animalRelative(file),
      sha256: sha256(inputBodies[index])
    })),
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: extraMetadata.sceneChangeBudget,
    maskIncluded: false,
    coordinatePatchIncluded: false,
    inputFidelity: "high",
    prompt,
    revisedPrompt: generated.result.revisedPrompt || null,
    orientation: job.orientation,
    requestedSize: spec.size,
    outputSize: `${generated.actual.width}x${generated.actual.height}`,
    queue: {
      configuredConcurrency: config.concurrency,
      localWorkerConcurrency: workerConcurrency,
      maxRetriesPerTask: MAX_RETRIES,
      maxAttemptsPerTask: MAX_RETRIES + 1
    },
    ...extraMetadata.contract,
    output: { path: animalRelative(candidatePath), sha256: sha256(generated.final) },
    review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
    generationAttempts: generated.attempt,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`Done ${job.templateId}: ${animalRelative(candidatePath)}`);
}

await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true })
]);
const config = await loadEnv();
if (config.concurrency !== workerConcurrency) throw new Error(`Shared queue concurrency ${config.concurrency} does not match worker pool ${workerConcurrency}`);
const watercolorJob = animalJobs.find((job) => job.templateId === "animal-watercolor-cat-closeup");
const doubleExposureJob = animalJobs.find((job) => job.templateId === "animal-fantasy-double-exposure");
if (!watercolorJob || !doubleExposureJob) throw new Error("pending animal jobs missing");

const tasks = [
  {
    job: watercolorJob,
    version: "position-lock-v01",
    remediation: "position-locked-identity-attribute-replacement",
    imagePaths: [watercolorJob.effectReferencePath, watercolorJob.identity.path],
    prompt: watercolorPrompt(expansionOutputSpecs[watercolorJob.orientation]),
    extraMetadata: {
      inputs: [
        { role: "one-time-third-party-effect-edit-target-and-position-authority" },
        { role: "self-owned-pet-identity-attributes-only" }
      ],
      sceneChangeBudget: "0%",
      contract: {
        positionLock: ["crop", "head", "eyes", "ears", "crown", "nose", "background"],
        allowedChanges: ["facial-features", "nose-color", "eye-shape-and-color", "ear-shape-and-color", "fur-color"]
      }
    }
  },
  {
    job: doubleExposureJob,
    version: "eastern-myth-v01",
    remediation: "user-background-eastern-dark-myth-double-exposure",
    imagePaths: [doubleExposureJob.effectReferencePath, EASTERN_BACKGROUND_PATH, doubleExposureJob.identity.path],
    prompt: easternMythPrompt(expansionOutputSpecs[doubleExposureJob.orientation]),
    extraMetadata: {
      inputs: [
        { role: "one-time-third-party-double-exposure-layout-reference" },
        { role: "user-supplied-eastern-dark-myth-background-reference" },
        { role: "self-owned-pet-identity-reference" }
      ],
      sceneChangeBudget: "double-exposure-content-replaced-by-user-background",
      contract: {
        userBackgroundIncluded: true,
        theme: "original-eastern-traditional-dark-mythology",
        textPolicy: "no-text-or-watermark"
      }
    }
  }
];

let cursor = 0;
const failures = [];
const workers = Array.from({ length: Math.min(workerConcurrency, tasks.length) }, async () => {
  while (cursor < tasks.length) {
    const task = tasks[cursor++];
    try {
      await generateCandidate(config, task);
    } catch (error) {
      failures.push({ templateId: task.job.templateId, message: error instanceof Error ? error.message : String(error) });
    }
  }
});
await Promise.all(workers);
for (const failure of failures) console.error(`Failed ${failure.templateId}: ${failure.message}`);
console.log(`Final pending animal generation complete: ${tasks.length - failures.length}/${tasks.length}`);
if (failures.length) process.exitCode = 1;
