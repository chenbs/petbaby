/**
 * Shared two-stage remediation for animal candidates whose photographic identity
 * reference overpowered the effect reference's illustration language.
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative } from "./animal-expansion-catalog.mjs";
import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const GUIDE_ROOT = path.join(OUTPUT_ROOT, "style-guides");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const MAX_RETRIES = 3;
const STYLE_BRIDGE_VERSION = "stylebridge-v03";
const STYLE_GUIDE_VERSION = "guide-v03";
const THEME_RESET_VERSION = "theme-reset-v02";
const STYLE_BRIDGE_IDS = new Set([
  "animal-enamel-dragon",
  "animal-ink-scratch-portrait",
  "animal-watercolor-cat-closeup",
  "animal-giant-law-poster",
  "animal-tiger-storm",
  "animal-rabbit-yokai"
]);
const THEME_RESET_ID = "animal-fantasy-double-exposure";
const args = process.argv.slice(2);
const target = args.find((item) => !item.startsWith("--")) || "all";
const force = args.includes("--force");
const concurrencyArgument = args.find((item) => item.startsWith("--concurrency="));
const workerConcurrency = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || process.env.LINGSUAN_IMAGE_CONCURRENCY || 20)));

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}
async function exists(file) { try { await access(file); return true; } catch { return false; } }
function selectedJobs() {
  const jobs = animalJobs.filter((job) => STYLE_BRIDGE_IDS.has(job.templateId) || job.templateId === THEME_RESET_ID);
  if (target === "all") return jobs;
  const ids = target.split(",").filter(Boolean);
  const unknown = ids.filter((id) => !jobs.some((job) => job.templateId === id));
  if (unknown.length) throw new Error(`Unknown remediation template: ${unknown.join(", ")}`);
  return jobs.filter((job) => ids.includes(job.templateId));
}

function buildStyleGuidePrompt(job) {
  return [
    "Use case: source-subject design transfer for a reusable pet identity replacement pipeline.",
    "Image 1 is the sole authority for the replacement subject design. Copy the designated source subject's pose, action, expression, gaze, crop, silhouette rhythm, head-to-body proportion, facial abstraction, eye/nose/muzzle design, anatomical simplification, fur construction, ornament integration, line language, brushwork, pigment behavior, edge treatment, texture scale, local contrast and degree of realism.",
    "Image 2 supplies identity markers only: adult species and breed, coat colors, stable markings, ear type and eye color. Image 2 must not supply pose, expression, photographic facial construction, realistic muzzle volume, literal fur strands, lens lighting or camera depth.",
    "Create an isolated replacement-subject blueprint on a plain unobtrusive background. The replacement pet must already occupy Image 1's subject crop and reproduce Image 1's pose and expression before it enters the final scene. Do not copy the surrounding scene, text, watermark or unrelated background objects.",
    "Translate the new pet identity through Image 1's shape grammar, not through photographic anatomy. Preserve only enough breed structure to recognize the pet. Adult age means mature and healthy, not realistic: the adult pet may use the same enlarged eyes, shortened or simplified muzzle, rounded planes, graphic fur masses, mythical body treatment or painterly distortion as Image 1 without becoming a puppy or kitten.",
    "Every facial surface must be constructed from Image 1's visible marks and shapes. Replace glassy eyes, wet nose highlights, smooth three-dimensional muzzle shading, individual hair detail and photo lighting with Image 1's stylized equivalents. A face crop must read immediately as part of Image 1's artwork, never as a painted photograph of Image 2.",
    "Use one continuous subject-region contract. Both ears, the entire crown, forehead, cheeks, muzzle, neck and every other visible anatomical region belong to the replacement pet and must remain present and connected. Pale pigment, soft washes and broken edges may soften only the outer contour; they must never erase an ear or crown area, turn anatomy into background, or leave a background-shaped hole inside the head.",
    "Use one continuous medium contract. The head and every facial feature must use the same hand-made medium as the body. Do not place a realistically modeled head inside stylized marks. When Image 1 uses ink or watercolor, rebuild facial planes, eyes, nose, muzzle, ears and crown from visible brush-and-pigment shapes, paper gaps, dry-brush breaks, wash blooms and economical lines inside the features, not merely around the silhouette.",
    "Keep the result recognizable, appealing, adult and healthy. No generic realistic pet portrait, no studio-photo pose, no photorealistic face, no shallow depth of field, no realistic fur microtexture, no text, no logo and no watermark.",
    `Identity: adult ${job.identity.breed}; ${job.identity.identity}.`,
    "Return only the finished pre-stylized identity guide."
  ].join(" ");
}

function buildStyleBridgeFinalPrompt(job, spec) {
  return [
    "Use case: identity replacement using a pre-stylized identity guide.",
    `Create an exact final ${spec.ratio} composition at ${spec.size} pixels.`,
    "Image 1 is the sole authority for the final scene: preserve its composition, crop, camera, perspective, pose, expression, gaze, lighting, palette, background, costume, landmarks, props, text layout, brushwork and all contact relationships exactly.",
    "Image 2 is the pre-stylized replacement-subject blueprint. Replace only the original main subject in Image 1 with this exact blueprint. Preserve Image 2's pose, expression, silhouette, face construction, fur marks, eyes, nose, anatomy, ornament treatment and degree of abstraction; do not reconstruct the pet from a generic breed or photographic prior.",
    "Scene-change budget is 0%. Do not redesign, simplify, recolor, clean up, add, remove or relocate any scene element. Make only the smallest contact-boundary adjustment required by natural pet anatomy.",
    "The entire replacement subject, especially the face, must be built from the same non-photographic marks, lines, washes, pigment, edge softness, shape simplification and stylized volume as Image 1 and Image 2. Do not reconstruct any photographic fur strands, realistic glassy eyes, wet nose highlights, lens lighting, shallow depth of field or realistic facial anatomy.",
    "Treat the replacement as one closed semantic subject region: both ears, the full crown, forehead, cheeks, muzzle and neck must remain connected pet anatomy. Do not interpret pale fur, translucent watercolor, paper-white highlights, ink gaps or soft edges as background removal. Every retained anatomical region must contain the same medium-specific marks as the rest of the subject.",
    "Keep the exact adult maturity and healthy body mass from Image 2 while retaining Image 1's stylized proportions. Never make the pet younger, thinner, more realistic, humanoid, uncanny or structurally rigid.",
    job.guard,
    "Keep meaningful text, clothing, landmarks and distinctive props. Replace only known brands, copyrighted names, platform UI and watermarks with short original wording while preserving their blocks and hierarchy.",
    "No residual source subject, duplicate pet, extra ears, eyes, limbs or paws, human hands, fused joints, floating head, logo, signature or watermark. Return only the finished image."
  ].join(" ");
}

function buildThemeResetPrompt(job, spec) {
  return [
    "Use case: rights-safe theme replacement inside an identity-preserving double-exposure edit.",
    `Create an exact final ${spec.ratio} composition at ${spec.size} pixels.`,
    "Image 1 is the sole authority for layout and visual effects. Preserve its large side-profile silhouette, double-exposure mask, dense internal landscape layers, tiny traveler scale cue, warm highlights, dark fantasy atmosphere, poster hierarchy, crop, spacing and painterly texture exactly.",
    "Image 2 is the sole pet identity authority. Replace the original profile subject with the exact adult black Labrador identity from Image 2, fully painted in the same dark fantasy illustration language as Image 1.",
    "Remove every Journey to the West, Monkey King, pilgrimage, Chinese myth adaptation and named-artist reference. Replace the internal narrative with a rich original dark-mythology theme called the Eclipse Hound of the Underworld: an adult black Labrador spirit guards a ruined obsidian gate beneath a blood-red eclipse; inside its profile are layered haunted mountains, a crumbling black citadel, a winding river of ember-like souls, twisted dead trees, storm clouds, drifting ash, broken ritual stones, distant ghost lights and one tiny anonymous cloaked traveler carrying a dim lantern.",
    "Remove all title, subtitle, caption and decorative lettering. Render no text at all. Preserve the original visual balance by leaving the former text zones as intentional negative space with the same surrounding color, texture and light.",
    "The internal mythology must be as layered, intricate and visually dense as Image 1, with clear foreground, middle-ground and distant-depth storytelling inside the silhouette. Avoid a simple mountain-only scene, empty negative space, one-path composition or generic pet portrait.",
    "Scene-change budget applies only to the narrative content inside the existing double-exposure silhouette and removal of text. Do not change the poster layout, profile orientation, double-exposure boundaries, palette, lighting, texture or visual density.",
    "No Journey to the West wording or imagery, no Monkey King, staff, pagoda, known character, named artist, brand, logo, watermark or signature. Return only the finished image."
  ].join(" ");
}

async function runWithRetries(label, run) {
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      console.log(`Start ${label} attempt ${attempt}/${MAX_RETRIES + 1}`);
      return { ...(await run()), attempt };
    } catch (error) {
      lastError = error;
      if (attempt <= MAX_RETRIES) {
        console.error(`Retry ${label}: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  throw lastError;
}

async function createStyleGuide(config, job) {
  const guidePath = path.join(GUIDE_ROOT, `${job.templateId}_${job.identityId}_${STYLE_GUIDE_VERSION}.png`);
  if (!force && await exists(guidePath)) {
    const body = await readFile(guidePath);
    if (await hasUsableVisualContent(body)) return { path: guidePath, body, attempt: 0, prompt: buildStyleGuidePrompt(job), revisedPrompt: null };
  }
  const prompt = buildStyleGuidePrompt(job);
  const generated = await runWithRetries(`${job.templateId}:guide`, async () => {
    const result = await edit(config, {
      imagePaths: [job.effectReferencePath, job.identity.path],
      prompt,
      size: expansionOutputSpecs[job.orientation].size,
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      maxRetries: 0
    });
    if (!await hasUsableVisualContent(result.buffer)) throw new Error("style guide has no usable visual content");
    return result;
  });
  await writeFile(guidePath, generated.buffer);
  return { path: guidePath, body: generated.buffer, attempt: generated.attempt, prompt, revisedPrompt: generated.revisedPrompt || null };
}

async function generateStyleBridge(config, job) {
  const spec = expansionOutputSpecs[job.orientation];
  const version = STYLE_BRIDGE_VERSION;
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${version}`;
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const rawPath = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  if (!force && await exists(candidatePath) && await exists(metadataPath)) return;

  const guide = await createStyleGuide(config, job);
  const prompt = buildStyleBridgeFinalPrompt(job, spec);
  const generated = await runWithRetries(`${job.templateId}:final`, async () => {
    const result = await edit(config, {
      imagePaths: [job.effectReferencePath, guide.path],
      prompt,
      size: spec.size,
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      maxRetries: 0
    });
    if (!await hasUsableVisualContent(result.buffer)) throw new Error("final output has no usable visual content");
    const final = await fit(result.buffer, job.orientation, { anchor: 0.38, format: "png" });
    const actual = await dimensions(final);
    if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`output size ${actual.width}x${actual.height}`);
    return { result, final, actual };
  });
  await writeFile(rawPath, generated.result.buffer);
  await writeFile(candidatePath, generated.final);
  const effectBody = await readFile(job.effectReferencePath);
  const identityBody = await readFile(job.identity.path);
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    version,
    status: "generated-pending-user-approval",
    remediation: "shared-two-stage-style-bridge",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "one-time-third-party-effect-reference", path: animalRelative(job.effectReferencePath), sha256: sha256(effectBody) },
      { role: "self-owned-pet-identity-reference-for-guide-only", path: animalRelative(job.identity.path), sha256: sha256(identityBody) },
      { role: "pre-stylized-identity-guide-for-final-edit", path: animalRelative(guide.path), sha256: sha256(guide.body) }
    ],
    finalEditInputOrder: ["one-time-third-party-effect-reference", "pre-stylized-identity-guide"],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    maskIncluded: false,
    coordinatePatchIncluded: false,
    guide: { prompt: guide.prompt, revisedPrompt: guide.revisedPrompt, attempts: guide.attempt },
    prompt,
    revisedPrompt: generated.result.revisedPrompt || null,
    orientation: job.orientation,
    requestedSize: spec.size,
    outputSize: `${generated.actual.width}x${generated.actual.height}`,
    queue: { configuredConcurrency: config.concurrency, localWorkerConcurrency: workerConcurrency, maxRetriesPerTask: MAX_RETRIES, maxAttemptsPerTask: MAX_RETRIES + 1 },
    output: { path: animalRelative(candidatePath), sha256: sha256(generated.final) },
    review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
    generationAttempts: generated.attempt,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`Done ${job.templateId}: ${animalRelative(candidatePath)}`);
}

async function generateThemeReset(config, job) {
  const spec = expansionOutputSpecs[job.orientation];
  const version = THEME_RESET_VERSION;
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${version}`;
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const rawPath = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  if (!force && await exists(candidatePath) && await exists(metadataPath)) return;
  const prompt = buildThemeResetPrompt(job, spec);
  const generated = await runWithRetries(`${job.templateId}:theme-reset`, async () => {
    const result = await edit(config, {
      imagePaths: [job.effectReferencePath, job.identity.path],
      prompt,
      size: spec.size,
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      maxRetries: 0
    });
    if (!await hasUsableVisualContent(result.buffer)) throw new Error("theme reset output has no usable visual content");
    const final = await fit(result.buffer, job.orientation, { anchor: 0.38, format: "png" });
    const actual = await dimensions(final);
    if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`output size ${actual.width}x${actual.height}`);
    return { result, final, actual };
  });
  await writeFile(rawPath, generated.result.buffer);
  await writeFile(candidatePath, generated.final);
  const inputBodies = await Promise.all([job.effectReferencePath, job.identity.path].map((file) => readFile(file)));
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    version,
    status: "generated-pending-user-approval",
    remediation: "rights-safe-theme-reset",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "one-time-third-party-effect-reference", path: animalRelative(job.effectReferencePath), sha256: sha256(inputBodies[0]) },
      { role: "self-owned-pet-identity-reference", path: animalRelative(job.identity.path), sha256: sha256(inputBodies[1]) }
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "double-exposure-content-only",
    maskIncluded: false,
    coordinatePatchIncluded: false,
    prompt,
    revisedPrompt: generated.result.revisedPrompt || null,
    orientation: job.orientation,
    requestedSize: spec.size,
    outputSize: `${generated.actual.width}x${generated.actual.height}`,
    queue: { configuredConcurrency: config.concurrency, localWorkerConcurrency: workerConcurrency, maxRetriesPerTask: MAX_RETRIES, maxAttemptsPerTask: MAX_RETRIES + 1 },
    output: { path: animalRelative(candidatePath), sha256: sha256(generated.final) },
    review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
    generationAttempts: generated.attempt,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`Done ${job.templateId}: ${animalRelative(candidatePath)}`);
}

const jobs = selectedJobs();
await Promise.all([mkdir(GUIDE_ROOT, { recursive: true }), mkdir(CANDIDATE_ROOT, { recursive: true }), mkdir(RAW_ROOT, { recursive: true }), mkdir(METADATA_ROOT, { recursive: true })]);
const config = await loadEnv();
if (config.concurrency !== workerConcurrency) throw new Error(`Shared queue concurrency ${config.concurrency} does not match worker pool ${workerConcurrency}`);
let cursor = 0;
const failures = [];
const workers = Array.from({ length: Math.min(workerConcurrency, jobs.length) }, async () => {
  while (cursor < jobs.length) {
    const index = cursor++;
    const job = jobs[index];
    try {
      if (job.templateId === THEME_RESET_ID) await generateThemeReset(config, job);
      else await generateStyleBridge(config, job);
    } catch (error) {
      failures.push({ templateId: job.templateId, message: error instanceof Error ? error.message : String(error) });
    }
  }
});
await Promise.all(workers);
for (const failure of failures) console.error(`Failed ${failure.templateId}: ${failure.message}`);
console.log(`Animal remediation complete: ${jobs.length - failures.length}/${jobs.length}`);
if (failures.length) process.exitCode = 1;
