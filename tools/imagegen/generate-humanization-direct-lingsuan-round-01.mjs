/** Generate four preview-only direct human-master + original-pet-photo transfers. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

throw new Error("PET_HUMAN_SCHEME_RETIRED: 旧宠物人化方案已撤回，禁止重新生成中间图");

const ROOT = path.resolve(import.meta.dirname, "../..");
const HUMANIZATION_ROOT = path.join(import.meta.dirname, "out", "humanization-v1");
const SOURCE_ROOT = path.join(import.meta.dirname, "out", "source");
const OUTPUT_ROOT = path.join(HUMANIZATION_ROOT, "probes", "lingsuan-direct-round-01");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");

const jobs = [
  {
    id: "human-breezy-fence_tuxedo-cat_direct_9x16_v01",
    title: "晴空微风 x 奶牛猫（直接方案）",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-breezy-fence_9x16_v01.png"),
    originalPetPath: path.join(SOURCE_ROOT, "cat-tuxedo.jpg"),
    petIdentity: "adult black-and-white tuxedo cat: pale green eyes, narrow white facial blaze, white muzzle, pink nose, alert steady gaze and lean face",
    masterLock: "Preserve the white shirt, windblown hair silhouette, low camera angle, wire fence and open blue sky."
  },
  {
    id: "human-color-splash_parrot_direct_9x16_v01",
    title: "跃彩笔触 x 鹦鹉（直接方案）",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-color-splash_9x16_v01.png"),
    originalPetPath: path.join(SOURCE_ROOT, "pet-parrot.jpg"),
    petIdentity: "green-cheeked conure parrot: very large dark attentive eye, pale eye ring, compact rounded head, grey-green facial color relationship and curious side-facing expression",
    masterLock: "Preserve the illustrated brushwork, colored splashes, earrings and upward side-profile head pose."
  },
  {
    id: "human-snow-scarf_husky-dog_direct_9x16_v01",
    title: "风雪回眸 x 哈士奇（直接方案）",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-snow-scarf_9x16_v01.png"),
    originalPetPath: path.join(SOURCE_ROOT, "dog-husky.jpg"),
    petIdentity: "adult grey-and-white Siberian Husky: ice-blue eyes, symmetrical grey cap and broad white blaze, long balanced face and calm intent side gaze",
    masterLock: "Preserve the black scarf and coat, over-the-shoulder pose, snow scene and backlight."
  },
  {
    id: "human-tailored-suit_blue-british-cat_direct_9x16_v01",
    title: "黑色裁缝 x 英短（直接方案）",
    masterPath: path.join(HUMANIZATION_ROOT, "masters", "candidates", "human-tailored-suit_9x16_v01.png"),
    originalPetPath: path.join(SOURCE_ROOT, "cat-british.jpg"),
    petIdentity: "adult blue British Shorthair cat: broad round face, amber eyes, compact nose-to-mouth proportions, dense blue-grey coloring and serious direct gaze",
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
    "Asset type: preview-only direct pet-to-human identity transfer",
    "Primary request: Create a new human facial identity for the adult human in Image 1, inferred directly from the original pet in Image 2. This is the single-stage direct method: human master plus original animal photo. Do not use or imagine an intermediate human identity card.",
    "Input images: Image 1 is the self-owned human master and the only authority for the final composition and all non-facial content. Image 2 is the original pet photo and is the sole identity inspiration, never a subject to paste into the result.",
    `Pet identity to translate into natural human facial traits: ${job.petIdentity}.`,
    "Required identity change: Do not retain Image 1's original facial identity. Infer a recognizably different but fully natural adult human face directly from Image 2. Translate only the pet's eye color relationship, gaze, expression, face-width relationship, visual contrast and distinctive proportions into plausible human facial features.",
    "Master invariants: Preserve Image 1 exactly outside the minimum facial identity change. Scene-change budget is 0%. Preserve its composition, camera, crop, complete adult human body, pose, gaze direction, expression intensity, hairstyle silhouette, clothing, accessories, scene, lighting, color, rendering medium, brushwork and texture.",
    `Template-specific invariants: ${job.masterLock}`,
    "Strict human-only result: The output must contain exactly one complete, credible adult human and no visible animal. Convert every identity cue into normal human anatomy. No animal ears, beak, animal nose, muzzle, snout, fur, feathers, whiskers, tail, paws, claws, slit pupils or hybrid anatomy.",
    "Avoid: keeping the original human face unchanged, showing Image 2 or its background, adding an animal, costume animal traits, changed body or pose, changed clothing, changed hairstyle silhouette, changed scene, changed lighting, changed style, text, logo, watermark or malformed anatomy."
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

  const [master, originalPetPhoto] = await Promise.all([
    validateInput(job.masterPath, "self-owned human master"),
    validateInput(job.originalPetPath, "original pet photo")
  ]);
  const prompt = promptFor(job);
  console.log(`[START] ${job.title}`);
  const result = await edit(config, {
    imagePaths: [job.masterPath, job.originalPetPath],
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
    purpose: "preview-only-direct-pet-to-human-transfer",
    provider: "lingsuan",
    model: config.model,
    modelCall: true,
    useCase: "identity-preserve",
    strategy: "single-stage-direct-human-master-plus-original-pet",
    status: "preview-pending-user-review",
    title: job.title,
    generatedAt: new Date().toISOString(),
    currentCallStage: 1,
    originalPetPhotoIncluded: true,
    humanIdentityCardIncluded: false,
    requestOrder: ["self-owned-human-master", "original-pet-photo"],
    inputs: {
      image1: { role: "self-owned-human-master", ...master },
      image2: { role: "original-pet-photo", ...originalPetPhoto }
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
  purpose: "lingsuan-direct-humanization-round-01-user-preview",
  provider: "lingsuan",
  model: config.model,
  generatedAt: new Date().toISOString(),
  strategy: "single-stage-direct-human-master-plus-original-pet",
  requestOrder: ["self-owned-human-master", "original-pet-photo"],
  originalPetPhotoIncluded: true,
  humanIdentityCardIncluded: false,
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
