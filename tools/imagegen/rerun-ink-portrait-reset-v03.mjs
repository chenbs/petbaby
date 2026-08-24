/** Re-run the archived reset-v03 prompt and inputs without changing the active master candidate. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const RESOLUTE = process.argv.includes("--resolute");
const REFERENCE_GAZE = process.argv.includes("--reference-gaze");
if (RESOLUTE && REFERENCE_GAZE) throw new Error("Choose only one eye prompt variant");
const sourceMetadataPath = path.join(REFERENCE_ROOT, "metadata", "ink-portrait_black-labrador-dog_9x16_reset-v03.json");
const outputName = REFERENCE_GAZE
  ? "ink-portrait_black-labrador-dog_9x16_reset-v03-reference-gaze-rerun-v01"
  : RESOLUTE
    ? "ink-portrait_black-labrador-dog_9x16_reset-v03-resolute-rerun-v01"
    : "ink-portrait_black-labrador-dog_9x16_reset-v03-rerun-v01";
const outputPath = path.join(REFERENCE_ROOT, "candidates", "experiments", `${outputName}.png`);
const outputMetadataPath = path.join(REFERENCE_ROOT, "metadata", "experiments", `${outputName}.json`);

try {
  await access(outputMetadataPath);
  const existing = JSON.parse(await readFile(outputMetadataPath, "utf8"));
  if (existing.status === "approved-frozen-master" || existing.approval?.state === "approved-and-frozen") {
    throw new Error(`Refusing to overwrite frozen experiment: ${outputName}`);
  }
} catch (error) {
  if (error?.code !== "ENOENT") throw error;
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const sourceMetadata = JSON.parse(await readFile(sourceMetadataPath, "utf8"));
if (sourceMetadata.version !== "reset-v03" || sourceMetadata.templateId !== "ink-portrait") {
  throw new Error("Source metadata is not ink-portrait reset-v03");
}
if (sourceMetadata.mask || sourceMetadata.inputs.length !== 2) {
  throw new Error("reset-v03 must use exactly two unmasked inputs");
}

const originalEyeClause = "Replicate Image 1's visible eye as one complete watercolour-and-negative-space structure instead of redesigning it. Match the same eye openness, rounded-to-almond outer contour, paper-white crescent and rim, compact dark inner mark, tiny paper break, upper ink edge, brow relationship, gaze direction and relative proportions. The confident sharpness must come from the reference eye direction, brow angle, head posture and surrounding brush masses. Do not turn it into a narrow slit, triangular eye, oversized black pupil, separate grey disc, glossy photographic eyeball or locally pasted patch.";
const resoluteEyeClause = "Single explicit expression exception: make Image 1's visible near eye noticeably more resolute while preserving the same complete watercolour-and-negative-space construction. Use a slightly narrower, horizontally longer almond contour; lower the painted upper eyelid and brow gently toward the muzzle; keep the lower edge calm and stable; reduce the exposed paper-white area to a controlled crescent; and direct the compact dark inner mark decisively toward the left. The dog must look calm, firm, courageous and self-possessed, never pleading, surprised, frightened, sad, angry or aggressive. Keep the eye fully hand-painted with broken ink edges and paper gaps. Do not turn it into a black slit, triangular hostile eye, oversized black pupil, separate grey disc, glossy photographic eyeball or locally pasted patch.";
const referenceGazeClause = "Use the gaze from Image 1 exactly.";
let prompt = sourceMetadata.prompt;
if (RESOLUTE) {
  prompt = prompt
    .replace("pose, action, expression, gaze, lighting, palette", "pose, action, lighting, palette")
    .replace(originalEyeClause, resoluteEyeClause);
  if (prompt === sourceMetadata.prompt || !prompt.includes(resoluteEyeClause)) {
    throw new Error("Unable to apply the resolute-eye prompt variant to reset-v03");
  }
}
if (REFERENCE_GAZE) {
  prompt = prompt.replace(originalEyeClause, referenceGazeClause);
  if (prompt === sourceMetadata.prompt || !prompt.includes(referenceGazeClause)) {
    throw new Error("Unable to apply the reference-gaze prompt variant to reset-v03");
  }
}

const inputPaths = sourceMetadata.inputs.map((input) => path.join(ROOT, input.path));
const inputHashes = await Promise.all(inputPaths.map(async (inputPath) => sha256(await readFile(inputPath))));
for (let index = 0; index < inputHashes.length; index += 1) {
  if (inputHashes[index] !== sourceMetadata.inputs[index].sha256) {
    throw new Error(`reset-v03 input hash mismatch: ${sourceMetadata.inputs[index].path}`);
  }
}

const config = await loadEnv();
const result = await edit(config, {
  imagePaths: inputPaths,
  prompt,
  size: "720x1280",
  quality: "high",
  outputFormat: "png",
  inputFidelity: ""
});
const body = await fit(result.buffer, "portrait", { anchor: 0.38, format: "png" });
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error(`Rerun size mismatch: ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(body)) throw new Error("Rerun has no usable visual content");

await mkdir(path.dirname(outputPath), { recursive: true });
await mkdir(path.dirname(outputMetadataPath), { recursive: true });
await writeFile(outputPath, body);
await writeFile(outputMetadataPath, `${JSON.stringify({
  purpose: REFERENCE_GAZE
    ? "user-requested-reset-v03-reference-gaze-prompt-rerun-preview"
    : RESOLUTE
      ? "user-requested-reset-v03-resolute-eye-prompt-rerun-preview"
      : "user-requested-reset-v03-prompt-rerun-preview",
  status: "experiment-pending-user-review",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  sourceMetadata: relativeToRoot(sourceMetadataPath),
  sourceVersion: sourceMetadata.version,
  promptVariant: REFERENCE_GAZE ? "reference-gaze-only" : RESOLUTE ? "resolute-eye-only" : "exact-reset-v03",
  inputs: sourceMetadata.inputs,
  mask: null,
  inputFidelity: "not-sent",
  requestedSize: "720x1280",
  outputSize: `${actual.width}x${actual.height}`,
  quality: "high",
  prompt,
  revisedPrompt: result.revisedPrompt || null,
  output: { path: relativeToRoot(outputPath), sha256: sha256(body) },
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(outputPath));
