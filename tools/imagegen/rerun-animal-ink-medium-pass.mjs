/** Redraw the complete ink portrait subject without reintroducing the raw pet photo. */
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
const MAX_RETRIES = 3;
const SOURCE_VERSION = "stylebridge-v04";
const VERSION = "stylebridge-v05";
const job = animalJobs.find((item) => item.templateId === "animal-ink-scratch-portrait");
if (!job) throw new Error("animal-ink-scratch-portrait missing");
const spec = expansionOutputSpecs[job.orientation];
const sourceBase = `${job.templateId}_${job.identityId}_${spec.ratio}_${SOURCE_VERSION}`;
const outputBase = `${job.templateId}_${job.identityId}_${spec.ratio}_${VERSION}`;
const sourceCandidatePath = path.join(CANDIDATE_ROOT, `${sourceBase}.png`);
const candidatePath = path.join(CANDIDATE_ROOT, `${outputBase}.png`);
const rawPath = path.join(RAW_ROOT, `${outputBase}.png`);
const metadataPath = path.join(METADATA_ROOT, `${outputBase}.json`);

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const prompt = [
  "Use case: whole-subject medium unification for an identity-preserving ink portrait edit.",
  `Return the exact same ${spec.ratio} composition at ${spec.size} pixels.`,
  "Image 1 is the sole authority for traditional brush-ink medium, head pose, gaze, facial abstraction, eye-shape design, muzzle simplification, line economy, dry-brush texture, ink diffusion, paper-white gaps, edge disappearance and airy negative space.",
  "Image 2 is the sole authority for the already-correct adult black Labrador breed, black coat, floppy ears, healthy body mass, body silhouette, crop and placement. Preserve those identity and layout facts, but do not preserve Image 2's current head construction, round gentle gaze, realistic eyes, nose, muzzle volume or rendering material.",
  "Redraw the entire Labrador, including the complete head, forehead, ears, eyes, nose, muzzle, cheeks, neck, body, legs and tail, through one continuous Chinese brush-ink language. The head must visibly consist of variable-pressure calligraphic strokes, broad dry-brush marks, feathered ink edges, layered diluted washes, broken pigment and intentional paper-white gaps inside the facial planes.",
  "Copy Image 1's sharp, graphic and confident gaze: construct the Labrador eyes as narrow expressive almond-shaped ink outlines and dark brush masses with paper-white negative space, not round brown eyeballs and not glossy irises. Construct the broad Labrador nose and muzzle as simplified flat calligraphic shapes, a few broken contour strokes and dry-brush tonal blocks, never as a wet three-dimensional nose or smoothly modeled snout.",
  "Use fewer marks and stronger decisions on the head. Large white-paper gaps must visibly interrupt the forehead, cheeks and muzzle just as they do in Image 1. Remove glassy eyeballs, catchlights, wet nose reflections, smooth grayscale volume, photographic fur strands, realistic skin folds and polished digital-paint shading.",
  "The face must look hand-painted with the same brush and ink as the body, not like a realistic dog head pasted onto an ink silhouette. Keep the mature Labrador recognizable and handsome without changing its expression or anatomy.",
  "Preserve the white paper background, flowing tail stroke, airy smudges and all existing subject boundaries. No text, logo, signature, watermark, extra anatomy, duplicate subject or scene redesign. Return only the finished image."
].join(" ");

await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true })
]);
const config = await loadEnv();
let generated;
let lastError;
for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
  try {
    console.log(`Start ${job.templateId}:ink-medium attempt ${attempt}/${MAX_RETRIES + 1}`);
    const result = await edit(config, {
      imagePaths: [job.effectReferencePath, sourceCandidatePath],
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
    generated = { result, final, actual, attempt };
    break;
  } catch (error) {
    lastError = error;
    if (attempt <= MAX_RETRIES) await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
  }
}
if (!generated) throw lastError;

await Promise.all([
  writeFile(rawPath, generated.result.buffer),
  writeFile(candidatePath, generated.final)
]);
const [effectBody, sourceCandidateBody] = await Promise.all([
  readFile(job.effectReferencePath),
  readFile(sourceCandidatePath)
]);
await writeFile(metadataPath, `${JSON.stringify({
  templateId: job.templateId,
  entryId: job.entryId,
  title: job.title,
  version: VERSION,
  status: "generated-pending-user-approval",
  remediation: "whole-subject-ink-medium-unification",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [
    { role: "one-time-third-party-effect-reference", path: animalRelative(job.effectReferencePath), sha256: sha256(effectBody) },
    { role: "self-owned-generated-candidate-with-correct-identity", path: animalRelative(sourceCandidatePath), sha256: sha256(sourceCandidateBody) }
  ],
  rawPetIdentityIncluded: false,
  runtimeThirdPartyEffectReferenceIncluded: false,
  sceneChangeBudget: "0%",
  maskIncluded: false,
  coordinatePatchIncluded: false,
  prompt,
  revisedPrompt: generated.result.revisedPrompt || null,
  orientation: job.orientation,
  requestedSize: spec.size,
  outputSize: `${generated.actual.width}x${generated.actual.height}`,
  queue: {
    configuredConcurrency: config.concurrency,
    maxRetriesPerTask: MAX_RETRIES,
    maxAttemptsPerTask: MAX_RETRIES + 1
  },
  output: { path: animalRelative(candidatePath), sha256: sha256(generated.final) },
  review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
  generationAttempts: generated.attempt,
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(`Done ${job.templateId}: ${animalRelative(candidatePath)}`);
