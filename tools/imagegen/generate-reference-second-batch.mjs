/**
 * 第二批 5 张单宠母版候选：第三方效果参考 + 自有宠物身份图 -> lingsuan 图生图。
 *
 * 用法：
 *   node tools/imagegen/generate-reference-second-batch.mjs all
 *   node tools/imagegen/generate-reference-second-batch.mjs exaggerated-expression
 *   node tools/imagegen/generate-reference-second-batch.mjs all --force --concurrency=1
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUT = path.join(REFERENCE_ROOT, "candidates");
const RAW = path.join(OUT, "raw");
const META = path.join(REFERENCE_ROOT, "metadata");
const TARGET = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
const CONCURRENCY = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || 1)));

const OUTPUT = { size: "720x1280", ratio: "9x16", width: 720, height: 1280 };
const EFFECT_ROOT = path.join(ROOT, "apps", "website", "public", "assets", "example");
const IDENTITY_ROOT = path.join(ROOT, "apps", "website", "public", "assets");

const commonScenePolicy = [
  "Image 1 is the primary effect reference and scene base. Preserve its core composition, camera language, scene type, clothing, landmark, distinctive props, meaningful text layout and overall visual effect.",
  "Allow an optional scene-change budget of approximately 5% to 20%. You may naturally adjust only secondary details, colours, materials, small decorations or context-equivalent props when the adjustment clearly improves the result and belongs in the current scene. Match the original perspective, scale, lighting and visual style. This is not a quota: if no replacement is clearly better, keep the source scene unchanged. Do not redesign the environment or weaken its story."
].join(" ");

const commonIdentityPolicy = [
  "Image 2 is the sole pet identity reference and overrides the animal shown in Image 1. Remove the original animal from Image 1 completely and replace it with the exact pet from Image 2.",
  "The replacement must look youthful, healthy, rounded and irresistibly cute at first glance, with soft full cheeks, friendly bright eyes and appealing contemporary proportions. Preserve recognisable breed anatomy and the identity markings stated below. Never make the pet skinny, elongated, angular, gaunt, stern, aggressive, strange, elderly-looking or uncanny.",
  "Keep exactly one pet identity and no unrelated animal. Correct anatomy only: no duplicate or fused limbs, extra ears, warped eyes, malformed mouth, human hands or broken clothing boundaries. No brand logo, known IP, platform UI, watermark or signature."
].join(" ");

const JOBS = [
  {
    id: "exaggerated-expression",
    title: "夸张表情头像",
    entryId: "fun",
    subject: "ragdoll-cat",
    breed: "布偶猫",
    version: "v01",
    anchor: 0.26,
    effectReference: path.join(EFFECT_ROOT, "1786368480133.png"),
    identityReference: path.join(IDENTITY_ROOT, "work-ragdoll.jpg"),
    identity: "Preserve the cream long coat, deep seal-brown mask and ears, round blue-grey eyes, broad fluffy cheeks, dark nose and soft full chest of the same Ragdoll cat.",
    rationale: "用圆润布偶猫验证夸张表情能否保持可爱，而不继承原犬的凶相和瘦长脸。",
    prompt: [
      "Use case: compositing and identity-preserving expression transfer. Create a vertical 9:16 polished close-up pet expression portrait from exactly two input images, composed for an exact final size of 720x1280 pixels.",
      commonScenePolicy,
      "Preserve Image 1's off-white paper background, energetic hand-painted sketch texture, extreme three-quarter close-up, raised brow, sideways upward glance and instantly readable mischievous comic timing. Preserve the unusual expressive mouth as the distinctive prop of the image, but adapt it to believable feline anatomy.",
      commonIdentityPolicy,
      "Preserve the cream long coat, deep seal-brown mask and ears, round blue-grey eyes, broad fluffy cheeks, dark nose and soft full chest of the exact Ragdoll cat in Image 2.",
      "Give the cat a playful cheeky grin with one slightly raised eyebrow and a small glimpse of clean natural feline teeth. The emotion must read as clever, teasing and lovable, never predatory, vicious, frightening or distorted. Keep the muzzle short and plush rather than stretching it into the long dog muzzle from Image 1.",
      "No text is required. Keep the sparse paper backdrop and visible brush lines."
    ].join(" ")
  },
  {
    id: "landmark-adventure",
    title: "环球地标与户外探险",
    entryId: "travel",
    subject: "abyssinian-cat",
    breed: "阿比西尼亚猫",
    version: "v01",
    anchor: 0.28,
    effectReference: path.join(EFFECT_ROOT, "1786368804360.png"),
    identityReference: path.join(IDENTITY_ROOT, "avatar-abyssinian.jpg"),
    identity: "Preserve the warm ruddy ticked coat, darker forehead markings, large upright ears, golden almond eyes, terracotta nose and elegant but healthy Abyssinian face.",
    rationale: "验证地标、墨镜反射、伸爪自拍和短毛猫身份在同一强镜头中是否稳定。",
    prompt: [
      "Use case: compositing and identity-preserving travel portrait. Create a vertical 9:16 high-fidelity pet travel selfie from exactly two input images, composed for an exact final size of 720x1280 pixels.",
      commonScenePolicy,
      "Preserve Image 1's bright Paris daytime setting, Eiffel Tower landmark in the rear left, close ultra-wide selfie perspective, extended foreground paw, black beret, round sunglasses with landmark reflections, red-and-white striped shirt, blue sky and cheerful tourist energy. The landmark may remain; do not imply sponsorship or brand cooperation.",
      commonIdentityPolicy,
      "Preserve the warm ruddy ticked coat, darker forehead markings, large upright ears, golden almond eyes, terracotta nose and elegant but healthy Abyssinian face from Image 2.",
      "Keep the same pet young and immediately lovable: soften the cheeks and expression without changing the breed into a round-faced breed. Use a small open happy smile, bright eyes visible naturally through lightly reflective lenses, and a plausible single front paw reaching toward the camera. Adapt the beret around the large ears and tailor the striped shirt without hiding the neck or coat identity.",
      "Retain the landmark, outfit and sunglasses; no new text, labels, platform interface or tourism logo."
    ].join(" ")
  },
  {
    id: "dessert-shopkeeper",
    title: "甜品饮品主理人",
    entryId: "career",
    subject: "toy-poodle",
    breed: "玩具贵宾犬",
    version: "v01",
    anchor: 0.3,
    effectReference: path.join(EFFECT_ROOT, "1786367409484.png"),
    identityReference: path.join(IDENTITY_ROOT, "avatar-poodle.jpg"),
    identity: "Preserve the warm apricot tight-curled coat, round dark eyes, small black nose, rounded teddy-bear muzzle, floppy curly ears and compact Toy Poodle build.",
    rationale: "验证甜品职业环境、蛋糕道具、帽饰和卷毛小型犬可爱度。",
    prompt: [
      "Use case: compositing and identity-preserving career portrait. Create a vertical 9:16 polished dessert-shop pet portrait from exactly two input images, composed for an exact final size of 720x1280 pixels.",
      commonScenePolicy,
      "Preserve Image 1's pink strawberry patisserie, warm display-window glow, central counter composition, strawberry cream cake in the foreground, glass cloche, berry basket, hydrangea-like flowers, cupcakes, lace bow and the distinctive miniature cake hat. Keep the existing soft sign and packaging text layout; replace any unreadable copy only with short relevant dessert wording such as 'STRAWBERRY' or omit tiny copy rather than generating gibberish.",
      commonIdentityPolicy,
      "Preserve the warm apricot tight-curled coat, round dark eyes, small black nose, rounded teddy-bear muzzle, floppy curly ears and compact Toy Poodle build from Image 2.",
      "Make the same Toy Poodle the adorable active owner of the dessert shop. Keep one front paw naturally resting beside a cake server or cake plate so the occupation reads through action, not costume alone. Adapt the lace bow and miniature cake hat to the dog's ears without fusion. Keep the main strawberry cake, shop displays and pink uniform atmosphere.",
      "All cakes must remain separate from the face and paws. No duplicate desserts fused into the coat, no human hand, no platform watermark or brand."
    ].join(" ")
  },
  {
    id: "pet-runway",
    title: "宠物时装周",
    entryId: "career",
    subject: "maine-coon-cat",
    breed: "缅因猫",
    version: "v01",
    anchor: 0.36,
    effectReference: path.join(EFFECT_ROOT, "1786368555480.png"),
    identityReference: path.join(IDENTITY_ROOT, "work-maine.jpg"),
    identity: "Preserve the brown-black classic tabby coat, golden eyes, square but soft muzzle, tall lynx-tipped ears, large neck ruff, sturdy body and very full dark tail of the same Maine Coon.",
    rationale: "验证 T 台、全套服装和大型长毛猫身份，避免生成瘦长拟人身体。",
    prompt: [
      "Use case: compositing and identity-preserving fashion portrait. Create a vertical 9:16 premium pet runway photograph from exactly two input images, composed for an exact final size of 720x1280 pixels.",
      commonScenePolicy,
      "Preserve Image 1's centred runway, dark audience on both sides, grey spotlight backdrop, frontal walking momentum and distinctive layered outfit: oversized light-grey wool coat, cream cable-knit layer, charcoal patterned neck scarf and pale sage wide-leg lower garment. The outfit may receive minor tailoring or colour balancing, but keep its recognisable silhouette, materials and fashion-week restraint.",
      commonIdentityPolicy,
      "Preserve the brown-black classic tabby coat, golden eyes, square but soft muzzle, tall lynx-tipped ears, large neck ruff, sturdy body and very full dark tail of the exact Maine Coon in Image 2.",
      "Adapt the fashion look to a believable sturdy Maine Coon walking naturally toward the camera on four paws. Do not create a human torso, human hands, a narrow waist or a tall skinny biped. Shape the coat and sage draped garment around natural feline shoulders and forelegs while leaving the face, ear tufts, chest ruff, front paws and tail identity visible. The expression should be calm, confident and cute rather than stern or old-fashioned.",
      "Keep runway lighting, garment texture and audience blur. No designer logo, readable brand name, platform UI or watermark."
    ].join(" ")
  },
  {
    id: "leaping-cover",
    title: "腾空跳跃封面",
    entryId: "action",
    subject: "border-collie",
    breed: "边境牧羊犬",
    version: "v01",
    anchor: 0.34,
    effectReference: path.join(EFFECT_ROOT, "223c5d78-2ba2-49ff-b35e-8c247fd53b20.jpg"),
    identityReference: path.join(IDENTITY_ROOT, "work-border.jpg"),
    identity: "Preserve the black-and-white Border Collie coat, narrow white facial blaze, white muzzle and chest, warm brown eyes, black nose and semi-upright ears.",
    rationale: "验证腾空四肢、快乐表情、彩色厚涂和边牧身份在高动态画面中的稳定性。",
    prompt: [
      "Use case: compositing and identity-preserving action illustration. Create a vertical 9:16 expressive painted pet action cover from exactly two input images, composed for an exact final size of 720x1280 pixels.",
      commonScenePolicy,
      "Preserve Image 1's joyful head-on leap, two front paws closest to the viewer, open happy mouth, turquoise painted field, energetic magenta-purple lower strokes, orange-yellow accents and thick tactile brushwork. Remove the bottom-right platform watermark and account ID only; preserve the artwork's visual content and framing.",
      commonIdentityPolicy,
      "Preserve the black-and-white Border Collie coat, narrow white facial blaze, white muzzle and chest, warm brown eyes, black nose and semi-upright ears from Image 2.",
      "Show the same Border Collie springing toward the viewer with delighted wide eyes, a natural open smile and all four limbs anatomically readable. Keep the dog healthy, compact and fluffy; do not elongate the body. The two rear legs must remain distinct behind the front paws, with believable paw pads and no fused or missing limbs.",
      "Keep the colourful impasto medium and exuberant young energy. No collar text, platform mark, logo, watermark or signature."
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
  const basename = `${job.id}_${job.subject}_${OUTPUT.ratio}_${job.version}`;
  const finalPath = path.join(OUT, `${basename}.png`);
  const rawPath = path.join(RAW, `${basename}.png`);
  const metadataPath = path.join(META, `${basename}.json`);
  if (!FORCE && await exists(finalPath)) {
    console.log(`跳过 ${job.title}：候选已存在`);
    return { job, skipped: true, finalPath, metadataPath };
  }

  console.log(`开始 ${job.title} / ${job.breed}`);
  const inputHashes = await Promise.all([sha256(job.effectReference), sha256(job.identityReference)]);
  const result = await edit(config, {
    imagePaths: [job.effectReference, job.identityReference],
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
  if (!await hasUsableVisualContent(final)) throw new Error(`${job.title} 输出画面无有效内容`);

  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.id,
    title: job.title,
    entryId: job.entryId,
    status: "master-candidate-pending-user-approval",
    subject: job.subject,
    breed: job.breed,
    selectionRationale: job.rationale,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      {
        role: "third-party-effect-reference-internal-master-production-only",
        path: path.relative(ROOT, job.effectReference).replaceAll("\\", "/"),
        sha256: inputHashes[0]
      },
      {
        role: "pet-identity-reference",
        path: path.relative(ROOT, job.identityReference).replaceAll("\\", "/"),
        sha256: inputHashes[1]
      }
    ],
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
  return { job, skipped: false, finalPath, metadataPath };
}

if (TARGET !== "all" && !JOBS.some((job) => job.id === TARGET)) {
  throw new Error(`未知第二批模板 ${TARGET}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(RAW, { recursive: true });
await mkdir(META, { recursive: true });

const selected = TARGET === "all" ? JOBS : JOBS.filter((job) => job.id === TARGET);
for (const job of selected) {
  for (const input of [job.effectReference, job.identityReference]) {
    if (!await exists(input)) throw new Error(`${job.title} 缺输入 ${input}`);
  }
}

const config = await loadEnv();
let cursor = 0;
const results = [];
async function worker() {
  while (cursor < selected.length) {
    const job = selected[cursor];
    cursor += 1;
    results.push(await run(job, config));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () => worker()));

console.log(`第二批完成：${results.filter((item) => !item.skipped).length} 张新生成，${results.filter((item) => item.skipped).length} 张跳过`);
