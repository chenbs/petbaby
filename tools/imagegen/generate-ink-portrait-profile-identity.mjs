/** Generate a pose-aligned Labrador identity reference without masks or pixel coordinates. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const petReference = path.join(REFERENCE_ROOT, "..", "source", "dog-black-lab.jpg");
const output = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_profile-identity_reset-v02.png");
const metadataPath = path.join(REFERENCE_ROOT, "identity-guides", "ink-portrait_black-labrador-dog_profile-identity_reset-v02.json");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const prompt = [
  "Use case: identity-preserving pose alignment through image editing.",
  "Image 1 is the sole pet identity reference. Create a neutral studio identity photograph of the exact same adult black Labrador, preserving its naturally dropped ears, broad muzzle, black coat, adult skull proportions and healthy build.",
  "Rotate the whole head and neck into a strong left-facing three-quarter profile, close to a side profile. The muzzle, nose and gaze point decisively left. The far eye must be completely hidden behind the bridge of the muzzle and skull perspective; exactly one near eye is visible. The near ear remains naturally dropped and the far ear is mostly occluded by the head.",
  "Keep a closed mouth, calm alert expression and proud lifted neck. Do not make the dog sad, pleading, puppy-like, aggressive or front-facing. No symmetrical face, direct camera gaze, visible far eye or shortened muzzle.",
  "Use a plain off-white seamless studio background and soft flat neutral light. No accessories, clothing, text, logo, watermark, dramatic scenery or art style. This is a clean pose-aligned identity reference, not the final watercolour artwork. Exact final canvas 720x1280."
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
if (actual.width !== 720 || actual.height !== 1280) throw new Error(`Profile identity size mismatch: ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(body)) throw new Error("Profile identity has no usable visual content");

await mkdir(path.dirname(output), { recursive: true });
await writeFile(output, body);
await writeFile(metadataPath, `${JSON.stringify({
  purpose: "coordinate-free-pose-aligned-pet-identity-reference",
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [{ role: "original-pet-identity-reference", path: relativeToRoot(petReference), sha256: sha256(await readFile(petReference)) }],
  hardcodedSemanticCoordinates: false,
  mask: null,
  prompt,
  revisedPrompt: result.revisedPrompt || null,
  output: { path: relativeToRoot(output), size: "720x1280", sha256: sha256(body) },
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(output));
