/** Generate the 2026-08-20 pending-master revisions and milk-tea public preview. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { edit, generate, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildExpansionPrompt,
  expansionJobs,
  expansionOutputSpecs,
  relativeToRoot,
} from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const RUN_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "pending-remediation-20260820");
const IDENTITY_ROOT = path.join(RUN_ROOT, "identities");
const CANDIDATE_ROOT = path.join(RUN_ROOT, "candidates");
const RAW_ROOT = path.join(RUN_ROOT, "raw");
const METADATA_ROOT = path.join(RUN_ROOT, "metadata");
const PUBLIC_ROOT = path.join(RUN_ROOT, "public-previews");
const TEMP_ROOT = path.join(ROOT, ".tmp", "pending-remediation-20260820-inputs");
const FORCE = process.argv.includes("--force");
const target = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";

const revisionIds = [
  "fun-chef-expression-grid",
  "fun-scream-reaction",
  "fun-comic-panels",
  "fun-beach-caption",
  "fun-bunny-reaction",
  "fun-fisheye-closeup",
  "travel-paris-dog-selfie",
  "archive-fish-anatomy",
];
if (target !== "all" && target !== "public" && !revisionIds.includes(target)) {
  throw new Error(`未知待审重做模板: ${target}`);
}

const previousCandidates = new Map([
  ["fun-chef-expression-grid", "fun-chef-expression-grid_blue-british-cat_9x16_v01"],
  ["fun-scream-reaction", "fun-scream-reaction_husky-dog_9x16_v01"],
  ["fun-comic-panels", "fun-comic-panels_tuxedo-cat_9x16_v02"],
  ["fun-beach-caption", "fun-beach-caption_shiba-dog_9x16_v01"],
  ["fun-bunny-reaction", "fun-bunny-reaction_blue-british-cat_9x16_v01"],
  ["fun-fisheye-closeup", "fun-fisheye-closeup_black-cat_9x16_v02"],
  ["travel-paris-dog-selfie", "travel-paris-dog-selfie_black-lab-dog_9x16_v02"],
  ["archive-fish-anatomy", "archive-fish-anatomy_blue-british-cat_9x16_v01"],
]);

const identityTasks = [
  {
    id: "siberian-longhair-cat",
    filename: "identity-siberian-longhair-cat_v01.png",
    prompt: [
      "Use case: photorealistic-natural pet identity reference for a self-owned image template.",
      "Create one appealing adult golden-tabby Siberian forest cat in a clean neutral studio portrait.",
      "The cat has a dense long triple coat, full neck ruff, broad rounded wedge-shaped mature face, green-gold almond eyes, tufted upright ears, strong healthy body and a full plume tail.",
      "Show a clear front three-quarter view with the complete head, both ears, chest, forelegs and enough body to establish adult proportions. Calm attentive closed-mouth expression.",
      "Soft even daylight, pale warm-grey seamless background, realistic natural fur and color, no costume, prop, text, logo, watermark, frame, human or other animal.",
      "Clearly adult and breed-accurate, never kitten-like, chibi, flat-faced, Persian, Maine Coon, skinny or oversized-eyed. Exact portrait output 720x1280.",
    ].join(" "),
  },
  {
    id: "longhair-chihuahua-dog",
    filename: "identity-longhair-chihuahua_v01.png",
    prompt: [
      "Use case: photorealistic-natural pet identity reference for a self-owned image template.",
      "Create one appealing adult cream-and-tan long-coated Chihuahua in a clean neutral studio portrait.",
      "The dog has a long silky coat, large upright feathered ears, dark almond eyes, compact tapered muzzle, feathered chest and tail, petite but clearly mature healthy proportions.",
      "Show a clear front three-quarter view with the complete head, both full ears, chest, forelegs and enough body to establish adult proportions. Calm confident closed-mouth expression.",
      "Soft even daylight, pale warm-grey seamless background, realistic natural coat and color, no costume, bow, prop, text, logo, watermark, frame, human or other animal.",
      "Clearly adult and breed-accurate, never puppy-like, chibi, apple-headed caricature, oversized-eyed, long-muzzled, Papillon or Pomeranian. Exact portrait output 720x1280.",
    ].join(" "),
  },
];

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

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareInput(source, label) {
  const target = path.join(TEMP_ROOT, `${label}.jpg`);
  const body = await sharp(source, { failOn: "error" })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  if (body.byteLength >= 512 * 1024) throw new Error(`${label} compressed input is ${body.byteLength} bytes`);
  await writeFile(target, body);
  return { path: target, body };
}

async function generateIdentity(config, task) {
  const output = path.join(IDENTITY_ROOT, task.filename);
  const metadata = path.join(IDENTITY_ROOT, `${path.parse(task.filename).name}.json`);
  if (!FORCE && await exists(output) && await exists(metadata)) {
    console.log(`跳过身份图 ${task.id}: 已存在`);
    return;
  }
  console.log(`开始身份图 ${task.id}`);
  const result = await generate(config, {
    prompt: task.prompt,
    size: "720x1280",
    quality: "high",
    outputFormat: "png",
    maxRetries: 1,
  });
  const final = await fit(result.buffer, "portrait", { anchor: 0.42, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== 720 || actual.height !== 1280 || !await hasUsableVisualContent(final)) {
    throw new Error(`${task.id} identity output failed validation`);
  }
  await writeFile(output, final);
  await writeJson(metadata, {
    purpose: "self-owned-pet-identity-reference",
    identityId: task.id,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/generations",
    prompt: task.prompt,
    revisedPrompt: result.revisedPrompt || null,
    requestedSize: "720x1280",
    output: { path: relativeToRoot(output), sha256: sha256(final) },
    generatedAt: new Date().toISOString(),
  });
  console.log(`完成身份图 ${task.id}`);
}

async function markPreviousRevisionRequired(job, nextBase) {
  const previousBase = previousCandidates.get(job.templateId);
  const candidates = [
    path.join(import.meta.dirname, "out", "reference-v1", "expansion", "metadata", `${previousBase}.json`),
    path.join(METADATA_ROOT, `${previousBase}.json`),
  ];
  const metadataPath = (await Promise.all(candidates.map(async (file) => await exists(file) ? file : null))).find(Boolean);
  if (!metadataPath) throw new Error(`Missing previous metadata for ${job.templateId}: ${previousBase}`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  metadata.status = "revision-required-by-user";
  metadata.review = {
    ...metadata.review,
    state: "revision-required-by-user",
    finalApproval: "revision-required",
    reviewedAt: "2026-08-20T00:00:00+08:00",
    findings: [`用户要求按 pending-masters-comparison 逐项修正，并以 ${nextBase} 作为下一版待审候选。`],
  };
  metadata.replacedBy = nextBase;
  await writeJson(metadataPath, metadata);
}

async function generateRevision(config, job) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const candidate = path.join(CANDIDATE_ROOT, `${base}.png`);
  const raw = path.join(RAW_ROOT, `${base}.png`);
  const metadata = path.join(METADATA_ROOT, `${base}.json`);
  if (!FORCE && await exists(candidate) && await exists(metadata)) {
    await markPreviousRevisionRequired(job, base);
    console.log(`跳过重做 ${job.templateId}: 已存在`);
    return;
  }

  const effect = await prepareInput(job.effectReferencePath, `${job.templateId}-effect`);
  const identity = await prepareInput(job.identity.path, `${job.templateId}-identity`);
  if (effect.body.byteLength + identity.body.byteLength >= 1024 * 1024) {
    throw new Error(`${job.templateId} combined inputs exceed 1MB`);
  }
  const prompt = buildExpansionPrompt(job);
  console.log(`开始重做 ${job.templateId} (${effect.body.byteLength + identity.body.byteLength} input bytes)`);
  const result = await edit(config, {
    imagePaths: [effect.path, identity.path],
    prompt,
    size: spec.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high",
    maxRetries: 1,
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.templateId} returned no usable image`);
  const final = await fit(result.buffer, job.orientation, { anchor: 0.5, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== spec.width || actual.height !== spec.height) {
    throw new Error(`${job.templateId} output is ${actual.width}x${actual.height}`);
  }
  await writeFile(raw, result.buffer);
  await writeFile(candidate, final);
  await writeJson(metadata, {
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    version: job.version,
    status: "master-candidate-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    sourceEffectFile: relativeToRoot(job.effectReferencePath),
    inputs: [
      { role: "one-time-third-party-effect-reference", path: relativeToRoot(job.effectReferencePath), sha256: sha256(await readFile(job.effectReferencePath)), requestPath: relativeToRoot(effect.path), requestBytes: effect.body.byteLength },
      { role: "self-owned-pet-identity-reference", identityId: job.identityId, species: job.identity.species, breed: job.identity.breed, path: relativeToRoot(job.identity.path), sha256: sha256(await readFile(job.identity.path)), requestPath: relativeToRoot(identity.path), requestBytes: identity.body.byteLength },
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    inputPolicy: { maxImages: 2, maxLongestEdge: 1200, jpegQuality: 82, combinedBytesBelow: 1048576, serial: true },
    inputFidelity: "high",
    orientation: job.orientation,
    requestedSize: spec.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    output: { path: relativeToRoot(candidate), rawPath: relativeToRoot(raw), sha256: sha256(final) },
    review: {
      state: "pending-user-review",
      finalApproval: "pending-user",
      checks: { dimensions: "pass", inputContract: "pass", visualAcceptance: "pending-user" },
      findings: [],
    },
    generatedAt: new Date().toISOString(),
  });
  await markPreviousRevisionRequired(job, base);
  console.log(`完成重做 ${job.templateId}`);
}

async function generateMilkTeaPublicPreview(config) {
  const job = expansionJobs.find((item) => item.templateId === "pet-milk-tea-shopkeeper");
  if (!job) throw new Error("pet-milk-tea-shopkeeper is missing from expansion catalog");
  const output = path.join(PUBLIC_ROOT, "pet-milk-tea-shopkeeper_public-v01.png");
  const raw = path.join(PUBLIC_ROOT, "raw", "pet-milk-tea-shopkeeper_public-v01.png");
  const metadata = path.join(PUBLIC_ROOT, "metadata", "pet-milk-tea-shopkeeper_public-v01.json");
  if (!FORCE && await exists(output) && await exists(metadata)) {
    console.log("跳过奶茶店公开展示图: 已存在");
    return;
  }
  const effect = await prepareInput(job.effectReferencePath, "pet-milk-tea-shopkeeper-public-effect");
  const prompt = [
    "Use case: precise-object-edit for a public mini-program preview image.",
    "Image 1 is the edit target and sole visual authority. Recreate the same milk-tea shop photograph with the exact same orange-and-white adult cat identity, face, gaze, hat, apron, bow, front paw placement, counter, drinks, flowers, lighting, warm palette, camera and depth of field.",
    "Remove only platform watermarks, account IDs, creator signatures and corner badges if present, replacing those pixels with seamless natural scene content.",
    "Preserve the in-scene generic 'MILK TEA' shop sign and ordinary milk-tea cup/menu lettering; those are scene details, not watermarks.",
    "Adapt the canvas to exact 720x1280 portrait framing by extending or gently recomposing the existing shop background as needed. Keep the complete cat, both ears, hat, visible paws, foreground drinks and main flower arrangement fully inside frame. Do not crop, replace or redesign any subject or prop.",
    "No new text, logo, watermark, account mark, extra animal, extra limb or changed product styling. Return only the finished public preview.",
  ].join(" ");
  console.log(`开始奶茶店公开展示图 (${effect.body.byteLength} input bytes)`);
  const result = await edit(config, {
    imagePath: effect.path,
    prompt,
    size: "720x1280",
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high",
    maxRetries: 1,
  });
  const final = await fit(result.buffer, "portrait", { anchor: 0.5, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== 720 || actual.height !== 1280 || !await hasUsableVisualContent(final)) {
    throw new Error("pet-milk-tea-shopkeeper public preview failed validation");
  }
  await mkdir(path.dirname(raw), { recursive: true });
  await writeFile(raw, result.buffer);
  await writeFile(output, final);
  await writeJson(metadata, {
    kind: "public-preview",
    templateId: job.templateId,
    title: job.title,
    version: "public-v01",
    status: "public-preview-candidate-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [{ role: "one-time-public-effect-edit-target", path: relativeToRoot(job.effectReferencePath), sha256: sha256(await readFile(job.effectReferencePath)), requestPath: relativeToRoot(effect.path), requestBytes: effect.body.byteLength }],
    runtimeMasterUseAllowed: false,
    publicUseAllowed: false,
    inputPolicy: { maxImages: 1, maxLongestEdge: 1200, jpegQuality: 82, combinedBytesBelow: 1048576, serial: true },
    requestedSize: "720x1280",
    outputSize: `${actual.width}x${actual.height}`,
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    output: { path: relativeToRoot(output), rawPath: relativeToRoot(raw), sha256: sha256(final) },
    review: { state: "pending-user-review", finalApproval: "pending-user", findings: [] },
    generatedAt: new Date().toISOString(),
  });
  console.log("完成奶茶店公开展示图");
}

await Promise.all([
  mkdir(IDENTITY_ROOT, { recursive: true }),
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true }),
  mkdir(PUBLIC_ROOT, { recursive: true }),
  mkdir(TEMP_ROOT, { recursive: true }),
]);

const config = await loadEnv();
if (config.concurrency !== 1) throw new Error(`本批次必须串行生成，当前 LINGSUAN_IMAGE_CONCURRENCY=${config.concurrency}`);
if (target === "all") {
  for (const task of identityTasks) await generateIdentity(config, task);
}
const selectedRevisionIds = target === "all" ? revisionIds : target === "public" ? [] : [target];
const revisionJobs = selectedRevisionIds.map((templateId) => {
  const job = expansionJobs.find((item) => item.templateId === templateId);
  if (!job) throw new Error(`Missing revision job ${templateId}`);
  return job;
});
for (const job of revisionJobs) await generateRevision(config, job);
if (target === "all" || target === "public") await generateMilkTeaPublicPreview(config);

await writeJson(path.join(RUN_ROOT, "index.json"), {
  status: "pending-user-review",
  generatedAt: new Date().toISOString(),
  provider: "lingsuan",
  inputPolicy: { serial: true, maxImagesPerRequest: 2, maxLongestEdge: 1200, jpegQuality: 82, combinedBytesBelow: 1048576 },
  revisionTemplateIds: target === "all" ? revisionIds : selectedRevisionIds,
  publicPreviewTemplateIds: ["pet-milk-tea-shopkeeper"],
  identityIds: identityTasks.map((item) => item.id),
});
console.log("2026-08-20 待审重做批次生成完成");
