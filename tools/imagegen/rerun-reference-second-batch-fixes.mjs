/**
 * 第二批母版候选定向返修：上一版候选 + 原宠物身份图 -> lingsuan 图生图新版本。
 *
 * 用法：
 *   node tools/imagegen/rerun-reference-second-batch-fixes.mjs all
 *   node tools/imagegen/rerun-reference-second-batch-fixes.mjs dessert-shopkeeper
 *   node tools/imagegen/rerun-reference-second-batch-fixes.mjs pet-runway
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const RAW = path.join(CANDIDATES, "raw");
const META = path.join(REFERENCE_ROOT, "metadata");
const IDENTITY_ROOT = path.join(ROOT, "apps", "website", "public", "assets");
const TARGET = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const OUTPUT = { size: "720x1280", width: 720, height: 1280 };

const jobs = [
  {
    id: "dessert-shopkeeper",
    title: "甜品饮品主理人",
    entryId: "career",
    subject: "toy-poodle",
    breed: "玩具贵宾犬",
    version: "v02",
    anchor: 0.5,
    editTarget: path.join(CANDIDATES, "dessert-shopkeeper_toy-poodle_9x16_v01.png"),
    identityReference: path.join(IDENTITY_ROOT, "avatar-poodle.jpg"),
    upstreamMetadata: path.join(META, "dessert-shopkeeper_toy-poodle_9x16_v01.json"),
    finding: "v01 左上招牌含疑似错误英文；画面、宠物身份、可爱度和解剖均保留。",
    prompt: [
      "Use case: text-localization with identity preservation. Produce a vertical 9:16 master candidate at exactly 720x1280 pixels from exactly two input images.",
      "Image 1 is the edit target. Keep its camera, crop, pink strawberry patisserie, lighting, depth of field, Toy Poodle pose and identity, face, eyes, curls, cake hat, lace bow, flowers, strawberries, cakes, glass cloche, basket, counter, cake server and every other visible detail unchanged.",
      "Change only the text on the upper-left framed wall sign. Replace its current heading with the single exact uppercase word 'STRAWBERRY', spelled S-T-R-A-W-B-E-R-R-Y. The final sign must visibly and accurately read STRAWBERRY. Use a clean elegant dark-pink serif style that naturally matches the existing sign. Remove any incorrect letters or extra heading words from that sign. Tiny ornamental lines below it may be omitted if they cannot be rendered accurately.",
      "Image 2 is the identity reference for verification. Preserve the same warm apricot Toy Poodle with tight curls, round dark eyes, small black nose, rounded teddy-bear muzzle, floppy curly ears and compact youthful build. Do not replace, restyle or reshape the pet.",
      "This is a single targeted text correction, not a scene redesign. No other scene changes are required. Keep exactly one pet. No new text elsewhere, no gibberish, brand, logo, watermark, signature, human hand, extra limb or fused object."
    ].join(" ")
  },
  {
    id: "pet-runway",
    title: "宠物时装周",
    entryId: "career",
    subject: "maine-coon-cat",
    breed: "缅因猫",
    version: "v03",
    anchor: 0.42,
    editTarget: path.join(CANDIDATES, "pet-runway_maine-coon-cat_9x16_v02.png"),
    identityReference: path.join(IDENTITY_ROOT, "work-maine.jpg"),
    upstreamMetadata: path.join(META, "pet-runway_maine-coon-cat_9x16_v01.json"),
    finding: "v01 身体过度拟人直立，v02 仍有衣袖包裹前肢、躯干偏直立；继续保留 T 台、构图与服装材料进行四足化返修。",
    prompt: [
      "Use case: precise-object-edit with pet identity preservation. Produce a vertical 9:16 premium pet runway master candidate at exactly 720x1280 pixels from exactly two input images.",
      "Image 1 is the edit target. Preserve its centred fashion runway, dark blurred audience, grey spotlight backdrop, frontal walking momentum, restrained premium photography, full fluffy tail and the recognisable layered outfit: oversized light-grey wool coat, cream cable-knit layer, charcoal patterned neck scarf and pale sage draped lower garment. Keep the original camera height, crop, lighting, garment palette, fabrics and scene. The garment can be refitted into a short quadruped-safe cape or open drape around the cat's shoulders and chest, while retaining the same materials, colours and layered fashion look.",
      "Edit only the Maine Coon's age impression, expression, body proportions and animal anatomy. Make it a youthful, healthy, sturdy, rounded and immediately lovable Maine Coon, with fuller soft cheeks, slightly larger friendly golden eyes, a relaxed closed mouth and a gentle confident expression. Retain the breed's square but soft muzzle, brown-black classic tabby markings, tall lynx-tipped ears, neck ruff and full dark tail from Image 2.",
      "The cat must be a natural quadruped in a clear mid-stride walking pose, body axis horizontal like a real Maine Coon. Show four separate fur-covered feline legs and paws, with at least three paws clearly visible and the front paws emerging from the open cape rather than from human-like sleeves. The shoulders, chest ruff, belly and hindquarters must read as one continuous furry cat body. Keep the tail attached naturally and visible.",
      "Strictly avoid any human torso, human shoulders, human arms, human hands, sleeve-like forelimbs, trouser legs, waistband, fly, narrow waist, upright bipedal pose, mannequin pose, gaunt cheeks, stern stare, elderly face, aggressive look or elongated body. This must look like a real cute cat wearing a small runway cape, not a person in a cat costume.",
      "Image 2 is the sole identity reference. Preserve the same Maine Coon, not a generic replacement. Keep exactly one pet. No logo, readable brand, platform UI, watermark, signature, malformed paw, duplicate limb or fused clothing boundary."
    ].join(" ")
  }
];

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

async function run(job, config) {
  const basename = `${job.id}_${job.subject}_9x16_${job.version}`;
  const finalPath = path.join(CANDIDATES, `${basename}.png`);
  const rawPath = path.join(RAW, `${basename}.png`);
  const metadataPath = path.join(META, `${basename}.json`);
  if (!FORCE && await exists(finalPath)) {
    console.log(`跳过 ${job.title}：${job.version} 已存在`);
    return;
  }

  const upstream = JSON.parse(await readFile(job.upstreamMetadata, "utf8"));
  const [editTargetHash, identityHash] = await Promise.all([
    sha256(job.editTarget),
    sha256(job.identityReference)
  ]);
  console.log(`开始 ${job.title} / ${job.breed} / ${job.version}`);
  const result = await edit(config, {
    imagePaths: [job.editTarget, job.identityReference],
    prompt: job.prompt,
    size: OUTPUT.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  const final = await fit(result.buffer, "portrait", { anchor: job.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== OUTPUT.width || actual.height !== OUTPUT.height) {
    throw new Error(`${job.title} 输出尺寸错误 ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(final)) {
    throw new Error(`${job.title} 输出画面无有效内容`);
  }

  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.id,
    title: job.title,
    entryId: job.entryId,
    status: "master-candidate-pending-user-approval",
    subject: job.subject,
    breed: job.breed,
    revision: {
      version: job.version,
      sourceVersion: path.basename(job.editTarget).match(/_(v\d+)\.png$/)?.[1] || "unknown",
      reviewFinding: job.finding,
      scope: "targeted-fix"
    },
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      {
        role: "previous-master-candidate-edit-target",
        path: path.relative(ROOT, job.editTarget).replaceAll("\\", "/"),
        sha256: editTargetHash
      },
      {
        role: "pet-identity-reference",
        path: path.relative(ROOT, job.identityReference).replaceAll("\\", "/"),
        sha256: identityHash
      }
    ],
    upstreamEffectReference: upstream.inputs.find((input) => input.role === "third-party-effect-reference-internal-master-production-only") || null,
    runtimeThirdPartyEffectReferenceIncluded: false,
    inputFidelity: "high",
    orientation: "portrait",
    requestedSize: OUTPUT.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt: job.prompt,
    revisedPrompt: result.revisedPrompt || null,
    review: {
      state: "pending-user-approval",
      checks: {
        petIdentity: "pending",
        cuteness: "pending",
        effectComposition: "pending",
        anatomy: "pending",
        textAndRights: "pending",
        dimensions: "pass"
      },
      findings: [],
      finalApproval: "pending-user"
    },
    generatedAt: new Date().toISOString(),
    output: {
      path: path.relative(ROOT, finalPath).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(final).digest("hex")
    }
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.title}: ${path.relative(ROOT, finalPath)}`);
}

if (TARGET !== "all" && !jobs.some((job) => job.id === TARGET)) {
  throw new Error(`未知返修模板 ${TARGET}`);
}

await mkdir(CANDIDATES, { recursive: true });
await mkdir(RAW, { recursive: true });
await mkdir(META, { recursive: true });

const selected = TARGET === "all" ? jobs : jobs.filter((job) => job.id === TARGET);
for (const job of selected) {
  for (const input of [job.editTarget, job.identityReference, job.upstreamMetadata]) {
    if (!await exists(input)) throw new Error(`${job.title} 缺输入 ${input}`);
  }
}

const config = await loadEnv();
for (const job of selected) await run(job, config);

console.log(`定向返修完成：${selected.length} 张`);
