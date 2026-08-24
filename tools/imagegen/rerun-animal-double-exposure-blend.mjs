/** Soften only the internal face-to-scene transition of the Eastern double exposure candidate. */
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
const SOURCE_VERSION = "eastern-myth-v02";
const VERSION = "eastern-myth-v03";
const MAX_RETRIES = 3;
const job = animalJobs.find((item) => item.templateId === "animal-fantasy-double-exposure");
if (!job) throw new Error("animal-fantasy-double-exposure missing");
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
  "Use case: transition-only refinement of an existing Eastern dark-mythology double-exposure artwork.",
  `Return the exact same ${spec.ratio} composition at ${spec.size} pixels.`,
  "Image 1 is the only input and the absolute authority for all finished content: keep the exact adult black Labrador identity, side-profile direction, head and body silhouette, eye, nose, mouth, muzzle proportions, Chinese mountain-temple city, bridges, river, many-armed black-stone guardian, people, storm clouds, charcoal palette, crop, scale, lighting and visual hierarchy unchanged.",
  "Change only Image 1's internal transition between the Labrador face and the embedded mythology scene. The current image still reads as a landscape confined to the left half and an intact dog photograph on the right half. Remove that two-part split and the cutout-like boundary across the forehead, eye region, cheek, jaw and neck. There must be no clean mask edge, no straight or continuous dividing contour, and no separate photographic face pasted over the scene.",
  "Extend the double exposure gently across the entire visible face instead of stopping beside it. Carry translucent mountain mist and charcoal smoke across the crown, around and partially in front of the eye, across the cheek, jaw, bridge of the muzzle and outer muzzle at low opacity. Let a few very faint mountain ridges, temple-roof fragments and cloudy tonal shapes remain visible through those facial regions, with the overlay strongest near the former boundary and progressively lighter toward the nose and mouth.",
  "At the same time, carry short black fur strokes and soft facial shadows leftward into the guardian, mountains and clouds so both layers interpenetrate. Use feathered opacity, irregular broken brush edges, smoky veils, lost-and-found contours, fine fur filaments crossing both directions and tonal overlap. The transition must occupy a broad uneven band, not a narrow blurred seam.",
  "Keep the Labrador face recognizable, mature, handsome and anatomically unchanged. Preserve the existing eye shape and gaze, nose, mouth and broad muzzle; do not hide the face, close the eye, create extra eyes, distort anatomy, change expression or turn the dog into a statue. The eye and muzzle may remain the clearest anchors, but their surrounding values must belong to the same painterly atmospheric field as the background.",
  "Do not redesign or regenerate the scene. Do not move, add or remove buildings, bridges, deity, figures or mountains. Do not change the external silhouette or crop. No text, logo, caption, watermark, Western architecture, Western occult symbols, lava, gore or new subject. Return only the finished seamless double-exposure edit."
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
    console.log(`Start ${job.templateId}:${VERSION} attempt ${attempt}/${MAX_RETRIES + 1}`);
    const result = await edit(config, {
      imagePaths: [sourceCandidatePath],
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
const sourceBody = await readFile(sourceCandidatePath);
await writeFile(metadataPath, `${JSON.stringify({
  templateId: job.templateId,
  entryId: job.entryId,
  title: job.title,
  version: VERSION,
  status: "generated-pending-user-approval",
  remediation: "double-exposure-face-background-transition-refinement",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [
    { role: "self-owned-eastern-myth-v02-edit-target", path: animalRelative(sourceCandidatePath), sha256: sha256(sourceBody) }
  ],
  sourceCandidateVersion: SOURCE_VERSION,
  rawPetIdentityIncluded: false,
  userBackgroundInheritedFromSource: true,
  runtimeThirdPartyEffectReferenceIncluded: false,
  sceneChangeBudget: "0%-transition-only",
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
    localWorkerConcurrency: 1,
    maxRetriesPerTask: MAX_RETRIES,
    maxAttemptsPerTask: MAX_RETRIES + 1
  },
  allowedChange: "internal-face-to-scene-transition-only",
  blendContract: {
    preserve: ["pet-identity", "pose", "expression", "external-silhouette", "eastern-myth-scene", "composition", "palette"],
    remove: ["hard-internal-mask-edge", "cutout-face-appearance", "continuous-dividing-contour"],
    method: ["full-face-low-opacity-overlap", "mist-interpenetration", "broken-brush-edges", "lost-and-found-contours", "tonal-overlap"]
  },
  output: { path: animalRelative(candidatePath), sha256: sha256(generated.final) },
  review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
  generationAttempts: generated.attempt,
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(`Done ${job.templateId}: ${animalRelative(candidatePath)}`);
