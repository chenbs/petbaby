/** Generate a coordinate-free Labrador structure guide from the effect and pet references. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const effectReference = path.join(ROOT, "apps", "website", "public", "assets", "example", "b983ec71-2f88-4c23-97f2-c0f0cb75bac1.jpg");
const petReference = path.join(REFERENCE_ROOT, "..", "source", "dog-black-lab.jpg");
const output = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_structural-guide_reset-v02.png");
const metadataPath = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_structural-guide_reset-v02.json");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const prompt = [
  "Use case: identity-preserving structural guide generation through image editing, not final artwork.",
  "Use exactly two input images. Image 1 controls the exact subject placement, three-quarter left-facing head angle, bust scale, gaze direction, neck taper, outer silhouette, diagonal lower stroke and portrait composition. Image 2 controls only adult black Labrador breed identity: naturally dropped ears, broad strong muzzle, adult skull proportions, solid black coat and healthy build.",
  "Replace the pointed-ear dog structure from Image 1 with the adult black Labrador structure from Image 2 while preserving Image 1's pose and perspective. Do not copy Image 2's front-facing pose, direct gaze, background, lighting, photographic eyes, wet nose, fur strands or realistic surface detail.",
  "Render the result as a deliberately simplified three-value structural guide using only solid near-black, flat mid-grey and off-white paper shapes. Keep the complete head, dropped ears, muzzle, neck and bust readable, but remove all photographic texture, gradients, highlights, individual hairs, detailed irises and background scenery.",
  "Preserve Image 1's visible-eye placement and openness as a simple off-white eye shape with one compact dark inner mark. Do not narrow it into a slit, enlarge the pupil or create a separate grey disc. Keep the far eye suppressed by the three-quarter profile.",
  "No watermark, account ID, text, logo, signature, decorative frame or added object. Exact final canvas 720x1280."
].join(" ");

const config = await loadEnv();
const result = await edit(config, {
  imagePaths: [effectReference, petReference],
  prompt,
  size: "720x1280",
  quality: "high",
  outputFormat: "png"
});
const body = await fit(result.buffer, "portrait", { anchor: 0.5, format: "png" });
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error(`Structural guide size mismatch: ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(body)) throw new Error("Structural guide has no usable visual content");

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, body);
await writeFile(metadataPath, `${JSON.stringify({
  purpose: "coordinate-free-derived-pet-structure-guide",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [
    { role: "effect-pose-and-composition-reference", path: relativeToRoot(effectReference), sha256: sha256(await readFile(effectReference)) },
    { role: "original-pet-identity-reference", path: relativeToRoot(petReference), sha256: sha256(await readFile(petReference)) }
  ],
  hardcodedSemanticCoordinates: false,
  mask: null,
  prompt,
  revisedPrompt: result.revisedPrompt || null,
  output: { path: relativeToRoot(output), size: "720x1280", sha256: sha256(body) },
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(output));
