/** Generate a cartoon-painted Labrador identity prototype before final master imitation. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const originalPetReference = path.join(REFERENCE_ROOT, "..", "source", "dog-black-lab.jpg");
const petReference = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_profile-flat-guide_reset-v03.png");
const output = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_cartoon-identity_reset-v10.png");
const metadataPath = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_cartoon-identity_reset-v10.json");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const prompt = [
  "Use case: identity-preserving image-to-image cartoonization for an intermediate pet identity prototype, not the final watercolour master.",
  "Image 1 is a deliberately texture-free four-value structure guide derived from the original adult black Labrador. Preserve only its left-facing three-quarter pose, single visible near eye, naturally dropped ears, broad mature muzzle, solid black coat, adult head silhouette, proud neck and healthy adult proportions. Its grey blocks are not valid rendering and must not be copied as stencil patches.",
  "Redesign this Labrador from scratch as a polished modern two-dimensional animated-character portrait with hand-drawn appeal. The face must be unmistakably cartoonized before any later style transfer: simplified rounded forehead and cheeks, clean broad muzzle, expressive brow, compact graphic eye, simplified matte nose, clear closed mouth line and readable dropped-ear shapes. Use intentional character-design proportions while keeping the dog visibly adult, handsome and immediately likeable.",
  "Give the single visible near eye a calm resolute leftward gaze. Make it a compact horizontal almond at least twice as wide as tall, with a confident upper eyelid and eyebrow gently lowered toward the muzzle, a narrow light crescent and one simple dark inner shape. Keep the far eye completely hidden. No round eye, upward gaze, large white eye area, pleading, surprise, fear, anger or aggression.",
  "Render with clean hand-drawn charcoal-black linework, a few broad matte black and charcoal-grey painted shapes, restrained soft brush texture and warm paper-white gaps. Keep facial forms cohesive, smooth and appealing like a finished 2D animation character key drawing, not realistic anatomy and not crude graphic abstraction.",
  "Do not reconstruct the photographic dog that existed before Image 1 was flattened. No realistic eyeball or iris texture, glass highlight, wet nose, skull modelling, detailed nostrils, individual hairs, fur direction, coat gloss, studio lighting, photographic shading, airbrushed realism, charcoal realism, 3D render, hard vector icon, crude stencil, cut-paper collage, disconnected blobs, puppy, chibi head, oversized eye or shortened muzzle.",
  "Use a plain warm off-white background with generous empty space. No splatter composition, diagonal finishing stroke, scenery, clothing, prop, text, logo, watermark, account ID, signature or frame. Exact final canvas 720x1280."
].join(" ");

const config = await loadEnv();
const result = await edit(config, {
  imagePath: petReference,
  prompt,
  size: "720x1280",
  quality: "high",
  outputFormat: "png"
});
const body = await fit(result.buffer, "portrait", { anchor: 0.5, format: "png" });
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error(`Cartoon identity size mismatch: ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(body)) throw new Error("Cartoon identity has no usable visual content");

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, body);
await writeFile(metadataPath, `${JSON.stringify({
  purpose: "coordinate-free-cartoonized-pet-identity-prototype",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [
    { role: "texture-free-pose-aligned-pet-structure-guide", path: relativeToRoot(petReference), sha256: sha256(await readFile(petReference)) }
  ],
  identityProvenance: { originalPetIdentityPath: relativeToRoot(originalPetReference) },
  hardcodedSemanticCoordinates: false,
  mask: null,
  prompt,
  revisedPrompt: result.revisedPrompt || null,
  output: { path: relativeToRoot(output), size: "720x1280", sha256: sha256(body) },
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(output));
