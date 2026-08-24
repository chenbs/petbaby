/**
 * 用 lingsuan 图生图生成自有参考图的方向预览。
 *
 * 用法：
 *   node tools/imagegen/generate-reference-previews.mjs travel-selfie
 *   node tools/imagegen/generate-reference-previews.mjs pet-barista
 *   node tools/imagegen/generate-reference-previews.mjs all
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUT = path.join(import.meta.dirname, "out", "reference-v1", "candidates");
const RAW = path.join(OUT, "raw");
const META = path.join(import.meta.dirname, "out", "reference-v1", "metadata");
const TARGET = process.argv[2] || "all";
const FORCE = process.argv.includes("--force");
const OUTPUTS = {
  portrait: { size: "720x1280", ratio: "9x16", width: 720, height: 1280 },
  landscape: { size: "1280x720", ratio: "16x9", width: 1280, height: 720 }
};

const JOBS = [
  {
    id: "travel-selfie",
    subject: "devon-kitten",
    category: "旅行自拍",
    breed: "黑白幼年德文猫",
    selectionRationale: "验证近距离自拍透视、地标与服装保留、幼态猫身份迁移",
    orientation: "portrait",
    anchor: 0.32,
    version: "v05",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "1786368752371.png"),
      path.join(ROOT, "tools", "imagegen", "out", "reference-v1", "characters", "devon-black-white-kitten.png")
    ],
    prompt: [
      "Use case: compositing. Create a vertical 9:16 high-fidelity pet replacement based on both input images. Compose for an exact final size of 720x1280 pixels.",
      "Image 1 is the primary effect reference and scene base. Preserve its core tropical island travel-selfie composition, scene type, cheerful holiday story, close ultra-wide camera perspective, foreground selfie action, distant volcano, temple-like landmark, turquoise water, straw hat, flowers and colourful floral shirt.",
      "Use a restrained scene-change budget of approximately 5% to 20%. You may naturally adjust a few secondary details such as vegetation, small background decorations, clothing colours, flower colours, material details or replace a prop only with a contextually equivalent travel item. Every change must look native to this tropical island scene and match its perspective, scale, daylight, colour temperature and visual style. This is an optional budget, not a quota: if there is no clearly more suitable replacement, keep the original content unchanged. Do not add unrelated objects, change the location type, remove the landmark or weaken the selfie story.",
      "Remove the original grey cat from Image 1 completely and replace it with the exact black-and-white Devon Rex kitten from Image 2. Image 2 is the identity and cuteness reference: preserve the black crown and ears, broad white blaze down the face, white muzzle, pink nose, white chest and white paws, very large round blue eyes, oversized upright ears and short curly coat.",
      "The replacement must look like the same young kitten in Image 2: irresistibly cute at first glance, round baby face, soft full cheeks, short compact plump body, bright gentle curious eyes and a warm happy expression. Keep the kitten healthy and cuddly, not skinny, not elongated, not angular, not gaunt, not gloomy, not uncanny and not elderly-looking.",
      "Keep exactly one kitten and no other animal. Preserve the readable selfie action and plausible paw contact. Correct anatomy only: no duplicate paws, fused limbs, extra ears, warped eyes or broken clothing boundaries.",
      "Photorealistic polished social-media travel portrait with soft natural daylight and detailed soft fur. No platform UI, watermark or signature. If any incidental text exists, keep it short, legible and semantically appropriate rather than deleting it or generating gibberish."
    ].join(" ")
  },
  {
    id: "pet-barista",
    subject: "shiba",
    category: "宠物职业大片",
    breed: "柴犬",
    selectionRationale: "验证职业场景、服装道具、可读文字与犬型身份迁移",
    orientation: "portrait",
    anchor: 0.3,
    version: "v05",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "1786367434575.png"),
      path.join(ROOT, "apps", "website", "public", "assets", "hero-shiba.jpg")
    ],
    prompt: [
      "Use case: compositing. Create a vertical 9:16 high-fidelity pet replacement based on both input images. Compose for an exact final size of 720x1280 pixels.",
      "Image 1 is the primary effect reference and scene base. Preserve its core cosy coffee-shop layout, calm barista story, left window, warm side lighting, wooden shelves, chalkboard menu, coffee cup and latte art, cookies, bow tie, apron and readable tabletop-to-subject relationship.",
      "Use a restrained scene-change budget of approximately 5% to 20%. You may naturally adjust a few secondary details such as shelf decorations, dried flowers, coffee beans, ceramics, fabric colour, material details or replace a small prop only with a contextually equivalent coffee-shop item. Every change must look native to this cafe and match its perspective, scale, warm window light, colour temperature and visual style. This is an optional budget, not a quota: if there is no clearly more suitable replacement, keep the original content unchanged. Do not add unrelated objects, change the cafe setting, remove the functional coffee props or weaken the barista story. The apron and bow tie may remain unchanged, change colour or receive minor tailoring.",
      "Remove the original grey cat from Image 1 completely and replace it with the red Shiba Inu from Image 2. Preserve the Shiba's red-and-cream coat, cream cheeks and chest, triangular ears, dark eyes and recognisable breed identity.",
      "Render the Shiba as an irresistibly cute young adult with a puppy-like look: slightly oversized rounded head, broad plush cheeks, soft short muzzle, warm open friendly eyes, a tiny relaxed smile and compact sturdy body. It must feel lovable to a young audience at first glance, never stern, old-fashioned, skinny, long-bodied, gaunt, aggressive, gloomy or uncanny.",
      "Keep exactly one Shiba Inu and no other animal. Preserve the seated barista pose and the front paw resting naturally beside the coffee setup. Correct anatomy only: no duplicate paws, fused limbs, extra ears, warped eyes or broken apron boundaries.",
      "Retain clear coffee-related text rather than deleting all text. The chalkboard heading must read exactly 'COFFEE' with a short plausible menu below: 'AMERICANO', 'LATTE', 'CAPPUCCINO', 'MOCHA'. Change the apron wording to exactly 'SHIBA BREW'. On the glass bottle, use one clean readable label that says exactly 'COFFEE' and no tiny secondary copy. All visible lettering must be legible and correctly spelled; omit tiny secondary copy rather than generating gibberish. No platform UI, watermark or signature."
    ].join(" ")
  },
  {
    id: "roller-coaster",
    subject: "corgi",
    category: "动作剧情",
    breed: "柯基犬",
    selectionRationale: "验证高速动作、座舱接触、兴奋表情与短腿犬体型保持",
    orientation: "portrait",
    anchor: 0.34,
    version: "v01",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "1786368644435.png"),
      path.join(ROOT, "tools", "imagegen", "out", "source", "dog-corgi.jpg")
    ],
    prompt: [
      "Use case: compositing. Create a vertical 9:16 high-fidelity pet replacement based on both input images. Compose for an exact final size of 720x1280 pixels.",
      "Image 1 is the primary effect reference and scene base. Preserve its first-row roller-coaster composition, red car, black safety restraint, orange track loops, blue supports, bright sky, green park background, speed, wide-angle energy and joyful mid-ride story.",
      "Use an optional scene-change budget of approximately 5% to 20%. You may naturally adjust a few secondary clouds, distant trees, small car details, restraint material or track-side details only when the replacement improves coherence. Every change must belong in this outdoor roller-coaster scene and match its perspective, motion, scale and sunlight. Do not change the ride type, remove the looping track or add unrelated objects. If no replacement is clearly better, keep the original content unchanged.",
      "Remove the original Shiba Inu from Image 1 completely and replace it with the exact Pembroke Welsh Corgi from Image 2. Preserve the tan-and-white coat, broad white facial blaze, white muzzle and chest, large upright ears, dark round eyes, short legs and compact sturdy body.",
      "Make the same Corgi irresistibly cute and youthful at first glance: rounded plush cheeks, bright happy eyes, open joyful smile and healthy compact proportions. Keep the short-legged Corgi silhouette; never make it skinny, long-bodied in an unhealthy way, gaunt, stern, frightened or uncanny.",
      "Exactly one Corgi and no other animal. Keep both front paws naturally braced on the car edge and the restraint correctly crossing the body. No extra paws, fused limbs, broken seat, deformed mouth, human hands, platform UI, text, logo, watermark or signature."
    ].join(" ")
  },
  {
    id: "pet-wanted-poster",
    subject: "golden-retriever",
    category: "萌宠通缉令",
    breed: "金毛犬",
    selectionRationale: "验证服装保留、手持道具、中文内容适配与大型犬可爱度",
    orientation: "portrait",
    anchor: 0.28,
    version: "v01",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "1786369065023.png"),
      path.join(ROOT, "tools", "imagegen", "out", "source", "dog-golden.jpg")
    ],
    prompt: [
      "Use case: compositing and text localization. Create a vertical 9:16 high-fidelity pet replacement based on both input images. Compose for an exact final size of 720x1280 pixels.",
      "Image 1 is the primary effect reference and scene base. Preserve its front-facing humorous mugshot composition, white height-chart background, navy measurement lines and numbers, orange prison shirt, two paws holding a dark rectangular placard, direct eye contact and deadpan comedy.",
      "Use an optional scene-change budget of approximately 5% to 20%. You may naturally adjust the shirt tailoring and colour tone, line spacing, placard material or small studio details to fit the new dog. All changes must remain native to a clean playful mugshot studio and match its frontal perspective and even light. Do not remove the shirt, placard or height chart. If no replacement is clearly better, keep the original content unchanged.",
      "Remove the original tabby cat from Image 1 completely and replace it with the exact Golden Retriever from Image 2. Preserve the warm golden coat, floppy feathered ears, dark friendly eyes, broad soft muzzle and recognisable Golden Retriever identity.",
      "Make the Golden Retriever youthful, rounded, fluffy and immediately lovable, with a gently mischievous but friendly expression. Never make it old, stern, aggressive, skinny, gaunt, long-faced or uncanny.",
      "Replace the placard text with the exact four Chinese characters '偷吃零食'. Keep the height-chart numbers readable and plausible. Do not delete the existing text structure. All visible text must be correctly formed; omit optional tiny text rather than generating gibberish.",
      "Exactly one dog and no other animal. Both front paws must grip the two sides of the placard naturally. No duplicate paws, human hands, fused clothing, platform UI, institutional emblem, watermark or signature."
    ].join(" ")
  },
  {
    id: "pet-encyclopedia",
    subject: "british-shorthair",
    category: "本宠百科图鉴",
    breed: "英国短毛猫",
    selectionRationale: "验证高信息密度版式、同宠细节小窗、标题文字与猫型身份一致性",
    orientation: "portrait",
    anchor: 0.5,
    version: "v02",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "9.png"),
      path.join(ROOT, "tools", "imagegen", "out", "source", "cat-british.jpg")
    ],
    prompt: [
      "Use case: infographic-diagram compositing and text localization. Create a vertical 9:16 high-fidelity pet encyclopedia poster based on both input images. Compose for an exact final size of 720x1280 pixels.",
      "Image 1 is the primary effect and layout reference. Preserve its cream editorial atlas design, large title area, central full-body pet portrait, circular ear-eye-fur-paw detail insets with leader lines, countryside backdrop, modular information panels, green accents, icon rhythm and dense but orderly hierarchy.",
      "Use an optional scene-change budget of approximately 5% to 20%. You may naturally adjust panel proportions, green tones, small icons, paper texture, inset placement or pastoral details to suit a cat. Every change must remain native to a premium pet encyclopedia page and preserve clear information hierarchy. Do not replace the layout with a generic poster. If no replacement is clearly better, keep the original content unchanged.",
      "Remove every Border Collie depiction from Image 1 and replace all main, inset and action depictions with the exact same blue British Shorthair cat from Image 2. Preserve the solid blue-grey coat, round broad face, amber eyes, small upright ears, plush dense fur, thick tail and sturdy rounded body. Every depiction must clearly be the same individual.",
      "Make the cat youthful, round, plush and appealing, never skinny, long-faced, stern, old or uncanny. Keep realistic cat anatomy in the full-body view and accurate close-up details.",
      "Change the small top-left header to exactly '猫种科普百科'. Change the main Chinese title to exactly '英国短毛猫' and the English subtitle to exactly 'BRITISH SHORTHAIR'. Use these exact readable Chinese section headings: '基础档案', '外观特征', '性格行为', '饲养护理', '互动建议'. Remove every occurrence of the character '犬'. Keep body copy short and factual-looking; omit unreadable tiny sentences rather than generating gibberish or false medical claims.",
      "No extra breed, duplicated main pet, malformed eyes or paws, platform UI, brand logo, watermark or signature."
    ].join(" ")
  },
  {
    id: "pet-character-sheet",
    subject: "tuxedo-cat",
    category: "宠物角色设定集",
    breed: "黑白家猫",
    selectionRationale: "验证横版输出、同宠多视图、服装拆解和表情一致性",
    orientation: "landscape",
    anchor: 0.5,
    version: "v01",
    inputs: [
      path.join(ROOT, "apps", "website", "public", "assets", "example", "15.png"),
      path.join(ROOT, "tools", "imagegen", "out", "source", "cat-tuxedo.jpg")
    ],
    prompt: [
      "Use case: compositing and character-sheet design. Create a horizontal 16:9 high-fidelity pet character sheet based on both input images. Compose for an exact final size of 1280x720 pixels.",
      "Image 1 is the primary effect and layout reference. Preserve its clean white professional character-sheet structure: title and profile block on the left, front-side-back turnaround across the upper middle, six facial-expression portraits at the upper right, clothing and accessory breakdown along the bottom, compact colour palette and one small world vignette.",
      "Use an optional scene-change budget of approximately 5% to 20%. You may naturally adjust the muted green, teal and ochre palette, garment materials, small accessory shapes, panel spacing or world vignette details to better suit the cat. Every change must remain native to a polished explorer character sheet. Do not discard the turnaround, expression grid, outfit breakdown or palette. If no replacement is clearly better, keep the original content unchanged.",
      "Remove the original human character from every panel and replace every view with the exact same black-and-white tuxedo cat from Image 2. Preserve the black ears and crown, narrow white facial blaze, white muzzle and chest, pale green eyes, pink nose, black back and white front legs.",
      "Design the cat as a cute youthful forest explorer. Keep a round friendly feline face, healthy compact body and soft proportions. Adapt the original padded jacket, scarf, goggles, boots and waist pouch naturally for a quadruped cat; clothing may change colour or receive minor tailoring but must not hide the facial markings. Never make it humanoid, skinny, elderly, fierce or uncanny.",
      "The turnaround must show front, side and back views of the same cat; the six portraits must show clearly different friendly expressions while preserving identical markings. Use exact readable English headings: 'CHARACTER SHEET', 'PROFILE', 'TURNAROUND', 'FACIAL EXPRESSIONS', 'ITEM & COSTUME', 'COLOR PALETTE', 'WORLD'. Omit tiny body copy rather than generating gibberish.",
      "This is one character shown repeatedly, not multiple pets. No identity drift, changed markings, extra limbs, human hands, brand, known IP, watermark or signature."
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

async function run(job, config, inputHashes) {
  const output = OUTPUTS[job.orientation];
  if (!output) throw new Error(`未知方向 ${job.orientation}`);
  const basename = `${job.id}_${job.subject}_${output.ratio}_${job.version}`;
  const finalPath = path.join(OUT, `${basename}.png`);
  if (!FORCE && await exists(finalPath)) {
    console.log(`跳过 ${job.id}：预览图已存在`);
    return;
  }

  console.log(`生成 ${job.id}...`);
  const result = await edit(config, {
    imagePaths: job.inputs,
    prompt: job.prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  const rawPath = path.join(RAW, `${basename}.png`);
  const final = await fit(result.buffer, job.orientation, { anchor: job.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`输出尺寸错误 ${actual.width}x${actual.height}，要求 ${output.size}`);
  }
  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  await writeFile(path.join(META, `${basename}.json`), JSON.stringify({
    templateId: job.id,
    status: "master-candidate-pending-user-approval",
    category: job.category,
    subject: job.subject,
    breed: job.breed,
    selectionRationale: job.selectionRationale,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: job.inputs.map((input, index) => ({
      role: index === 0 ? "third-party-effect-reference-internal-only" : "pet-identity-reference",
      path: path.relative(ROOT, input).replaceAll("\\", "/"),
      sha256: inputHashes[index]
    })),
    inputFidelity: "high",
    orientation: job.orientation,
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt: job.prompt,
    revisedPrompt: result.revisedPrompt || null,
    review: {
      state: "pending-human-review",
      score: null,
      findings: []
    },
    generatedAt: new Date().toISOString()
  }, null, 2) + "\n", "utf8");
  console.log(`完成 ${finalPath}`);
}

if (TARGET !== "all" && !JOBS.some((job) => job.id === TARGET)) {
  throw new Error(`未知预览 ${TARGET}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(RAW, { recursive: true });
await mkdir(META, { recursive: true });
const config = await loadEnv();
const selected = TARGET === "all" ? JOBS : JOBS.filter((job) => job.id === TARGET);
for (const job of selected) {
  const inputHashes = await Promise.all(job.inputs.map(async (input) => createHash("sha256").update(await readFile(input)).digest("hex")));
  await run(job, config, inputHashes);
}
