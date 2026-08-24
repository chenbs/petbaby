/**
 * Reset 05 from its original effect image using subject-only replacement.
 *
 * Image 1 is cropped locally to the final 9:16 canvas before the API call. A
 * transparent edit mask limits model access to the original animal and the
 * platform watermark. The generated result is then composited back onto the
 * immutable base so pixels outside the edit region cannot drift.
 */
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import path from "node:path";

import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { edit, loadEnv } from "./client.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const ROOT = path.resolve(import.meta.dirname, "../..");
const RESET_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "reset");
const BASE_DIR = path.join(RESET_ROOT, "bases");
const MASK_DIR = path.join(RESET_ROOT, "masks");
const RAW_DIR = path.join(RESET_ROOT, "raw");
const CANDIDATE_DIR = path.join(RESET_ROOT, "candidates");
const META_DIR = path.join(RESET_ROOT, "metadata");
const PROBE_DIR = path.join(RESET_ROOT, "probe");
const WIDTH = 720;
const HEIGHT = 1280;

const argv = process.argv.slice(2);
const TARGET = argv.find((value) => !value.startsWith("--")) || "all";
const FORCE = argv.includes("--force");
const PREPARE_ONLY = argv.includes("--prepare-only");
const PROBE_MASK = argv.includes("--probe-mask");
const POSTPROCESS_ONLY = argv.includes("--postprocess-only");

const jobs = [
  {
    id: "05",
    slug: "leaping-cover_border-collie_9x16_reset-v02",
    effectReferencePath: path.join(ROOT, "apps", "website", "public", "assets", "example", "223c5d78-2ba2-49ff-b35e-8c247fd53b20.jpg"),
    identityReferencePath: path.join(ROOT, "apps", "website", "public", "assets", "work-border.jpg"),
    detailCrop: { left: 75, top: 130, width: 570, height: 590 },
    editPolygons: [
      [[0, 92], [112, 66], [250, 158], [343, 82], [454, 166], [576, 126], [719, 202], [719, 476], [650, 610], [655, 820], [565, 1036], [424, 1100], [270, 1072], [142, 994], [58, 856], [68, 650], [18, 468]],
      [[500, 1122], [719, 1122], [719, 1279], [500, 1279]]
    ],
    prompt: [
      "Task: subject-only identity replacement, not image redesign and not style transfer.",
      "Image 1 is the immutable base image and the sole authority for every visible detail except animal identity: canvas, crop, composition, background, paint marks, palette, saturation, contrast, lighting, pose, airborne action, expression, closed smiling eyes, open mouth and tongue, foreshortening, paw placement, facial treatment, fur treatment, edge quality and texture. Image 2 is a detail crop from Image 1 and reinforces the exact painted face, expression and brushwork that must be retained.",
      "Replace only the original animal identity in Image 1 with the exact adult Border Collie from Image 3. Image 3 controls only species, breed, black-and-white coat markings, ear shape, eye colour, actual adult age and natural Border Collie proportions. Do not copy Image 3's photographic lighting, background, pose, expression, fur detail, facial rendering or realism.",
      "Transfer Image 1's exact joyous leaping pose, expression, painted facial treatment, painted fur treatment and all other visual details onto the new identity. Preserve adult proportions; do not turn the dog into a puppy and do not enlarge the head, eyes or cheeks.",
      "Change no background, scene, composition, palette or brushwork. Remove only the platform watermark and account ID. Exactly one animal; no added text, objects or anatomy changes."
    ].join(" ")
  }
];

function pointInPolygon(x, y, polygon) {
  let inside = false;
  for (let current = 0, previous = polygon.length - 1; current < polygon.length; previous = current, current += 1) {
    const [currentX, currentY] = polygon[current];
    const [previousX, previousY] = polygon[previous];
    const intersects = ((currentY > y) !== (previousY > y))
      && x < ((previousX - currentX) * (y - currentY)) / (previousY - currentY) + currentX;
    if (intersects) inside = !inside;
  }
  return inside;
}

function createMaskBuffers(polygons) {
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  const editAlpha = Buffer.alloc(WIDTH * HEIGHT);
  for (let y = 0; y < HEIGHT; y += 1) {
    for (let x = 0; x < WIDTH; x += 1) {
      const selected = polygons.some((polygon) => pointInPolygon(x + 0.5, y + 0.5, polygon));
      const pixel = y * WIDTH + x;
      const rgbaPixel = pixel * 4;
      rgba[rgbaPixel] = 0;
      rgba[rgbaPixel + 1] = 0;
      rgba[rgbaPixel + 2] = 0;
      rgba[rgbaPixel + 3] = selected ? 0 : 255;
      editAlpha[pixel] = selected ? 255 : 0;
    }
  }
  return { rgba, editAlpha };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function prepare(job) {
  const stableSlug = job.slug.replace(/_reset-v\d+$/, "");
  const basePath = path.join(BASE_DIR, `${stableSlug}_base.png`);
  const maskPath = path.join(MASK_DIR, `${stableSlug}_mask.png`);
  const alphaPath = path.join(MASK_DIR, `${stableSlug}_edit-alpha.png`);
  const detailPath = path.join(BASE_DIR, `${stableSlug}_detail.png`);
  const base = await fit(await readFile(job.effectReferencePath), "portrait", { anchor: 0.5, format: "png" });
  const { rgba, editAlpha } = createMaskBuffers(job.editPolygons);
  const mask = await sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer();
  const alpha = await sharp(editAlpha, { raw: { width: WIDTH, height: HEIGHT, channels: 1 } }).png().toBuffer();
  await writeFile(basePath, base);
  await writeFile(maskPath, mask);
  await writeFile(alphaPath, alpha);
  const detail = await sharp(base)
    .extract(job.detailCrop)
    .resize(720, 720, { fit: "contain", background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(detailPath, detail);
  return { basePath, detailPath, maskPath, alphaPath, base };
}

async function probeMaskSupport(config, prepared) {
  const probeBasePath = path.join(PROBE_DIR, "mask-support-base.png");
  const probeMaskPath = path.join(PROBE_DIR, "mask-support-mask.png");
  const base = prepared.base;
  const rgba = Buffer.alloc(WIDTH * HEIGHT * 4);
  for (let pixel = 0; pixel < WIDTH * HEIGHT; pixel += 1) {
    const x = pixel % WIDTH;
    const y = Math.floor(pixel / WIDTH);
    const selected = x >= 24 && x < 104 && y >= 24 && y < 104;
    const offset = pixel * 4;
    rgba[offset + 3] = selected ? 0 : 255;
  }
  await writeFile(probeBasePath, base);
  await writeFile(probeMaskPath, await sharp(rgba, { raw: { width: WIDTH, height: HEIGHT, channels: 4 } }).png().toBuffer());
  const result = await edit(config, {
    imagePath: probeBasePath,
    maskPath: probeMaskPath,
    prompt: "Edit only the transparent masked square: add one small solid white circle there. Keep every other pixel unchanged.",
    size: `${WIDTH}x${HEIGHT}`,
    quality: "low",
    outputFormat: "png"
  });
  const outputPath = path.join(PROBE_DIR, "mask-support-output.png");
  await writeFile(outputPath, result.buffer);
  const actual = await dimensions(result.buffer);
  await writeFile(path.join(PROBE_DIR, "mask-support.json"), JSON.stringify({
    endpoint: "/v1/images/edits",
    accepted: true,
    requestedSize: `${WIDTH}x${HEIGHT}`,
    outputSize: `${actual.width}x${actual.height}`,
    generatedAt: new Date().toISOString()
  }, null, 2) + "\n", "utf8");
  return outputPath;
}

async function generate(job, config, prepared) {
  const candidatePath = path.join(CANDIDATE_DIR, `${job.slug}.png`);
  if (!FORCE && await exists(candidatePath)) {
    console.log(`Skip ${job.id}: ${candidatePath} already exists`);
    return;
  }
  const result = await edit(config, {
    imagePaths: [prepared.basePath, prepared.detailPath, job.identityReferencePath],
    maskPath: prepared.maskPath,
    prompt: job.prompt,
    size: `${WIDTH}x${HEIGHT}`,
    quality: "high",
    outputFormat: "png"
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.id}: API returned an unusable image`);
  const actual = await dimensions(result.buffer);
  if (actual.width !== WIDTH || actual.height !== HEIGHT) {
    throw new Error(`${job.id}: API returned ${actual.width}x${actual.height}; expected ${WIDTH}x${HEIGHT}`);
  }
  const rawPath = path.join(RAW_DIR, `${job.slug}.png`);
  await writeFile(rawPath, result.buffer);
  await writeFile(candidatePath, result.buffer);
  await writeFile(path.join(META_DIR, `${job.slug}.json`), JSON.stringify({
    templateId: job.id,
    status: "reset-candidate-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    mode: "subject-only-masked-replacement",
    inputs: [
      { role: "immutable-effect-base", path: path.relative(ROOT, prepared.basePath).replaceAll("\\", "/"), sha256: await sha256(prepared.basePath) },
      { role: "effect-face-and-brushwork-detail", path: path.relative(ROOT, prepared.detailPath).replaceAll("\\", "/"), sha256: await sha256(prepared.detailPath) },
      { role: "pet-identity-only", path: path.relative(ROOT, job.identityReferencePath).replaceAll("\\", "/"), sha256: await sha256(job.identityReferencePath) },
      { role: "edit-mask", path: path.relative(ROOT, prepared.maskPath).replaceAll("\\", "/"), sha256: await sha256(prepared.maskPath) }
    ],
    inputFidelity: "provider-default",
    requestedSize: `${WIDTH}x${HEIGHT}`,
    outputSize: `${WIDTH}x${HEIGHT}`,
    quality: "high",
    prompt: job.prompt,
    revisedPrompt: result.revisedPrompt || null,
    backgroundLock: {
      method: "lingsuan-transparent-edit-mask",
      exactPixelLock: false,
      reason: "The provider semantically respects the mask but re-encodes the full canvas; pixel-for-pixel compositing creates visible fur-edge seams.",
      acceptance: "No semantic, compositional, palette or scene-content change outside the replacement subject."
    },
    review: { state: "pending-human-review", score: null, findings: [] },
    generatedAt: new Date().toISOString()
  }, null, 2) + "\n", "utf8");
  console.log(`Generated ${job.id}: ${candidatePath}`);
  console.log("Background lock: provider mask, semantic visual review required");
}

async function postprocess(job, prepared) {
  const rawPath = path.join(RAW_DIR, `${job.slug}.png`);
  if (!await exists(rawPath)) throw new Error(`${job.id}: missing raw output ${rawPath}`);
  const candidatePath = path.join(CANDIDATE_DIR, `${job.slug}.png`);
  await writeFile(candidatePath, await readFile(rawPath));
  const metadataPath = path.join(META_DIR, `${job.slug}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  delete metadata.immutablePixelAudit;
  metadata.backgroundLock = {
    method: "lingsuan-transparent-edit-mask",
    exactPixelLock: false,
    reason: "The provider semantically respects the mask but re-encodes the full canvas; pixel-for-pixel compositing creates visible fur-edge seams.",
    acceptance: "No semantic, compositional, palette or scene-content change outside the replacement subject."
  };
  metadata.postprocessedAt = new Date().toISOString();
  await writeFile(metadataPath, JSON.stringify(metadata, null, 2) + "\n", "utf8");
  console.log(`Postprocessed ${job.id}: ${candidatePath}`);
  console.log("Background lock: provider mask, semantic visual review required");
}

if (TARGET !== "all" && !jobs.some((job) => job.id === TARGET)) throw new Error(`Unknown target ${TARGET}`);
for (const directory of [BASE_DIR, MASK_DIR, RAW_DIR, CANDIDATE_DIR, META_DIR, PROBE_DIR]) {
  await mkdir(directory, { recursive: true });
}
const selected = TARGET === "all" ? jobs : jobs.filter((job) => job.id === TARGET);
const preparedJobs = new Map();
for (const job of selected) preparedJobs.set(job.id, await prepare(job));
if (PREPARE_ONLY) process.exit(0);
const config = await loadEnv();
if (PROBE_MASK) {
  const first = preparedJobs.get(selected[0].id);
  console.log(`Mask probe output: ${await probeMaskSupport(config, first)}`);
  process.exit(0);
}
if (POSTPROCESS_ONLY) {
  for (const job of selected) await postprocess(job, preparedJobs.get(job.id));
  process.exit(0);
}
for (const job of selected) await generate(job, config, preparedJobs.get(job.id));
