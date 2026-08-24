/** Generate four preview-only second-stage pet humanization identity transfers. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

throw new Error("PET_HUMAN_SCHEME_RETIRED: 旧宠物人化方案已撤回，禁止重新生成中间图");

const ROOT = path.resolve(import.meta.dirname, "../..");
const HUMANIZATION_ROOT = path.join(import.meta.dirname, "out", "humanization-v1");
const OUTPUT_ROOT = path.join(HUMANIZATION_ROOT, "probes", "lingsuan-round-02");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");

const jobs = [
  {
    id: "human-breezy-fence_tuxedo-cat_9x16_v02",
    title: "晴空微风 x 奶牛猫",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-breezy-fence_9x16_v01.png"),
    identityCardPath: path.join(HUMANIZATION_ROOT, "identity-cards", "tuxedo-cat_v01.png"),
    masterLock: "Preserve the white shirt, windblown hair silhouette, low camera angle, wire fence and open blue sky."
  },
  {
    id: "human-color-splash_parrot_9x16_v02",
    title: "跃彩笔触 x 鹦鹉",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-color-splash_9x16_v01.png"),
    identityCardPath: path.join(HUMANIZATION_ROOT, "identity-cards", "parrot_v01.png"),
    masterLock: "Preserve the illustrated brushwork, colored splashes, earrings and upward side-profile head pose."
  },
  {
    id: "human-snow-scarf_husky-dog_9x16_v02",
    title: "风雪回眸 x 哈士奇",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-snow-scarf_9x16_v01.png"),
    identityCardPath: path.join(HUMANIZATION_ROOT, "identity-cards", "husky-dog_v01.png"),
    masterLock: "Preserve the black scarf and coat, over-the-shoulder pose, snow scene and backlight."
  },
  {
    id: "human-tailored-suit_blue-british-cat_9x16_v02",
    title: "黑色裁缝 x 英短",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-tailored-suit_9x16_v01.png"),
    identityCardPath: path.join(HUMANIZATION_ROOT, "identity-cards", "blue-british-cat_v01.png"),
    masterLock: "Preserve the complete black tailored suit, gloves, seated pose, brooch and geometric background."
  }
];

function relativeToRoot(file) {
  return path.relative(ROOT, file).split(path.sep).join("/");
}

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

function promptFor(job) {
  return [
    "Use case: identity-preserve",
    "Asset type: preview-only second-stage pet humanization result",
    "Primary request: This is an identity replacement image edit, not a new scene design.",
    "Input images: Image 1 is the self-owned human master and the only authority for the complete image. Image 2 is a private human identity card derived from one pet and is the sole authority for replacement facial identity.",
    "Change only: Replace only the adult human facial identity in Image 1 with the human facial identity in Image 2, including eye spacing, face width, eye-color relationship, nose-to-mouth proportions and distinctive expression.",
    "Master invariants: Preserve Image 1 exactly outside the minimum facial identity replacement. Scene-change budget is 0%. Preserve its composition, camera, crop, complete adult human body, pose, gaze, expression intensity, hairstyle silhouette, clothing, accessories, scene, lighting, color, rendering medium, brushwork and texture.",
    `Template-specific invariants: ${job.masterLock}`,
    "Identity constraints: Keep Image 2's distinctive human facial proportions. Do not transfer Image 2's hairstyle, clothing, body, background, lighting or rendering style. Do not beautify away its identity.",
    "Human anatomy constraints: Keep exactly one complete, natural, credible adult human. Do not introduce the original pet or any animal anatomy. No animal ears, animal nose, muzzle, fur face, whiskers, feathers, tail, paws, claws or hybrid anatomy.",
    "Avoid: extra subjects, changed body or pose, changed clothing, changed hairstyle silhouette, changed background, changed lighting, changed style, text, logo, watermark or malformed anatomy."
  ].join("\n");
}

async function validateInput(file, role) {
  const body = await readFile(file);
  if (!await hasUsableVisualContent(body)) throw new Error(`${role} has no usable visual content: ${relativeToRoot(file)}`);
  return {
    path: relativeToRoot(file),
    sha256: sha256(body),
    dimensions: await dimensions(body)
  };
}

async function generateJob(config, job) {
  const outputPath = path.join(OUTPUT_ROOT, `${job.id}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${job.id}.json`);
  if (await exists(outputPath) || await exists(metadataPath)) {
    throw new Error(`Refusing to overwrite existing preview: ${relativeToRoot(outputPath)}`);
  }

  const [master, identityCard] = await Promise.all([
    validateInput(job.masterPath, "self-owned human master"),
    validateInput(job.identityCardPath, "private derived human identity card")
  ]);
  const prompt = promptFor(job);
  console.log(`[START] ${job.title}`);
  const result = await edit(config, {
    imagePaths: [job.masterPath, job.identityCardPath],
    prompt,
    size: "720x1280",
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  const providerDimensions = await dimensions(result.buffer);
  const output = await fit(result.buffer, "portrait", { format: "png", anchor: 0.5 });
  const outputDimensions = await dimensions(output);
  if (outputDimensions.width !== 720 || outputDimensions.height !== 1280) {
    throw new Error(`Invalid output dimensions for ${job.id}: ${outputDimensions.width}x${outputDimensions.height}`);
  }
  if (!await hasUsableVisualContent(output)) throw new Error(`Generated output has no usable visual content: ${job.id}`);

  await writeFile(outputPath, output);
  const metadata = {
    purpose: "preview-only-second-stage-pet-humanization",
    provider: "lingsuan",
    model: config.model,
    modelCall: true,
    useCase: "identity-preserve",
    status: "preview-pending-user-review",
    title: job.title,
    generatedAt: new Date().toISOString(),
    humanizationChain: ["original-pet-photo", "private-derived-human-identity-card", "final-human-output"],
    currentCallStage: 2,
    firstStageIdentityCardReused: true,
    originalPetPhotoIncluded: false,
    requestOrder: ["self-owned-human-master", "private-derived-human-identity-card"],
    inputs: {
      image1: { role: "self-owned-human-master", ...master },
      image2: { role: "private-derived-human-identity-card", ...identityCard }
    },
    request: {
      size: "720x1280",
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      prompt
    },
    providerOutput: {
      dimensions: providerDimensions,
      revisedPrompt: result.revisedPrompt
    },
    output: {
      path: relativeToRoot(outputPath),
      sha256: sha256(output),
      dimensions: outputDimensions
    }
  };
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
  console.log(`[DONE] ${job.title} -> ${relativeToRoot(outputPath)}`);
  return {
    id: job.id,
    title: job.title,
    status: metadata.status,
    output: metadata.output,
    metadataPath: relativeToRoot(metadataPath)
  };
}

const config = await loadEnv();
await mkdir(METADATA_ROOT, { recursive: true });
console.log(`[CONFIG] provider=lingsuan model=${config.model} concurrency=${config.concurrency}`);
const results = await Promise.allSettled(jobs.map((job) => generateJob(config, job)));
const items = results.map((result, index) => result.status === "fulfilled"
  ? result.value
  : {
      id: jobs[index].id,
      title: jobs[index].title,
      status: "generation-failed",
      error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    });
const manifestPath = path.join(OUTPUT_ROOT, "run-metadata.json");
await writeFile(manifestPath, `${JSON.stringify({
  purpose: "lingsuan-humanization-round-02-user-preview",
  provider: "lingsuan",
  model: config.model,
  generatedAt: new Date().toISOString(),
  requestOrder: ["self-owned-human-master", "private-derived-human-identity-card"],
  originalPetPhotoIncluded: false,
  status: items.every((item) => item.status === "preview-pending-user-review")
    ? "preview-pending-user-review"
    : "partial-generation-failure",
  items
}, null, 2)}\n`, "utf8");
console.log(`[MANIFEST] ${relativeToRoot(manifestPath)}`);

const failures = items.filter((item) => item.status === "generation-failed");
if (failures.length) {
  for (const failure of failures) console.error(`[FAILED] ${failure.title}: ${failure.error}`);
  process.exitCode = 1;
}
