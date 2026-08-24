/** User-requested frozen-master and public-preview remediation, 2026-08-19. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const MASTER_INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const LIBRARY_INDEX = path.join(REFERENCE_ROOT, "library-review", "index.json");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "remediation-20260819");
const INPUT_ROOT = path.join(ROOT, ".tmp", "master-remediation-20260819-inputs");
const require = createRequire(path.resolve(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");

const targetArgument = process.argv.find((item) => item.startsWith("--target="));
const kindArgument = process.argv.find((item) => item.startsWith("--kind="));
const TARGET = targetArgument?.slice("--target=".length) || "all";
const KIND = kindArgument?.slice("--kind=".length) || "all";
const FORCE = process.argv.includes("--force");

const sharedPublic = [
  "Use case: precise-object-edit.",
  "Asset type: public Mini Program template preview.",
  "Image 1 is the effect-reference edit target and is the sole authority for composition, subject, camera, pose, lighting, medium and all details not explicitly changed below.",
  "Create a clean new public-facing rendition, not a collage or framed mockup.",
  "Remove every platform badge, AI-generated label, account name, account number, watermark, logo and signature, reconstructing the covered area seamlessly.",
  "Do not add captions, borders, UI, logos, watermarks or signatures.",
];

const sharedMaster = [
  "Use case: identity-preserve precise-object-edit.",
  "Asset type: self-owned runtime frozen-master candidate.",
  "Image 1 is the current self-owned master and controls the replacement pet or owner identity unless the request explicitly changes the breed.",
  "Image 2 is the composition and effect reference. Use it only to correct the requested composition, pose, expression, gaze or visual treatment.",
  "Preserve every aspect that is not explicitly changed below, including the scene, camera, crop, palette, lighting, costume, props, spatial relationships and visual medium.",
  "Remove every platform badge, AI-generated label, account name, account number, watermark, logo and signature.",
  "No extra subjects, duplicate anatomy, human hands on animals, malformed paws, text, logo, watermark or signature.",
];

const jobs = [
  {
    id: "public-leaping-cover",
    kind: "public",
    templateId: "leaping-cover",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Change only the purple and magenta background paint strokes to vivid warm red paint.",
      "Keep the joyful airborne white dog, expression, paws, crop, perspective, thick impasto brushwork, and all teal, yellow, orange, white and other non-purple colors unchanged.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-exaggerated-expression",
    kind: "public",
    templateId: "exaggerated-expression",
    orientation: "portrait",
    version: "public-v01",
    prompt: [...sharedPublic,
      "Keep the exact exaggerated long-neck dog illustration, huge grin, wide eye, cream paper, rough black-and-brown hand-drawn strokes and framing unchanged.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-dessert-shopkeeper",
    kind: "public",
    templateId: "dessert-shopkeeper",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Add exactly three small fresh strawberries around the existing large strawberry on the cream cake hat, arranged naturally and securely in the whipped cream.",
      "Keep the white fluffy cat, pink dessert shop, foreground cake, flowers, glass cloche, lighting and all other details unchanged.",
      "Keep only the readable decorative word STRAWBERRY where it already belongs; add no other text.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-original-magic-academy",
    kind: "public",
    templateId: "original-magic-academy",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Keep the seated fluffy cat, dark green academy robe and scarf, stone classroom, potion bottles, cauldron, warm light and camera unchanged.",
      "Replace the small snake-like chest emblem only with an original simple paw-and-star academy crest so no known franchise mark remains.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-animal-giant-city-companion",
    kind: "public",
    templateId: "animal-giant-city-companion",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Keep the same giant fluffy grey cat walking through the city canyon, scale, street traffic, pedestrians, buildings, daylight and low camera.",
      "Change only the cat's gaze so both eyes clearly look downward toward the small people and traffic directly below with focused curiosity; do not look at the camera.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-animal-doodle-fisheye-chicken",
    kind: "public",
    templateId: "animal-doodle-fisheye-chicken",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Keep the exact rough hand-drawn chicken doodle, huge fisheye eyes, red comb and scribbled feathers, white paper, childish loose black linework and framing unchanged.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "public-animal-car-window-westie",
    kind: "public",
    templateId: "animal-car-window-westie",
    orientation: "landscape",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Change only the dog's pale blue shirt to a pale fresh green shirt.",
      "Keep the white West Highland Terrier, windblown fur, sleepy closed eyes, paws, yellow car, open window, landscape, motion and daylight unchanged.",
      "Return a 16:9 landscape composition."].join(" "),
  },
  {
    id: "public-animal-ink-scratch-portrait",
    kind: "public",
    templateId: "animal-ink-scratch-portrait",
    orientation: "portrait",
    version: "public-v02",
    prompt: [...sharedPublic,
      "Keep the exact seated long-haired cat, serious gaze, sweeping tail, black ink wash, loose scratch lines, airy off-white paper and negative space unchanged.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-mini-companion",
    kind: "master",
    templateId: "mini-companion",
    orientation: "portrait",
    version: "v04",
    filename: "mini-companion_abyssinian-cat_9x16_v04.png",
    prompt: [...sharedMaster,
      "Regenerate the two identical adult Abyssinian cats with a substantially stronger heroic low-angle view from below, following Image 2's upward-looking attitude.",
      "Move the large cat's left front leg farther left to create a wider, more powerful stance while keeping the paw fully grounded and anatomically correct.",
      "Both cats must remain the same adult identity at different scales, and both blue mirrored goggles must fully cover both eyes rather than sit on the forehead.",
      "Keep the black jackets, purple harnesses, clean white studio and large-left/small-right relationship.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-epic-ruins",
    kind: "master",
    templateId: "epic-ruins",
    orientation: "landscape",
    version: "v02",
    filename: "epic-ruins_german-shepherd-dog_16x9_v02.png",
    prompt: [...sharedMaster,
      "Recompose as a true cinematic horizontal scene matching Image 2: the armored adult German Shepherd occupies the left third in a heroic low-angle full-body stance, while enormous ruined arches and suspended towers open across the middle and right.",
      "Keep the dark metallic armor, rain, mist, backlight, tiny scale figures and monumental science-fantasy ruin detail.",
      "Return a 16:9 landscape composition."].join(" "),
  },
  {
    id: "master-fish-chase",
    kind: "master",
    templateId: "fish-chase",
    orientation: "portrait",
    version: "v02",
    filename: "fish-chase_owner-f01_tuxedo-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Increase the fisheye wide-angle distortion around the foreground tuxedo cat so its face reads extremely close and comically stretched like Image 2.",
      "Make both cat eyes much larger, rounder and more startled, with a frantic guilty expression while still gripping the fish.",
      "Make the woman behind visibly urgent and angry: brows tightened, eyes focused on the cat, mouth opened slightly wider in an alarmed shout, and reaching hand more desperate.",
      "Preserve the current woman and tuxedo-cat identities, market street, flying paper and fish.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-headphone-streetwear",
    kind: "master",
    templateId: "animal-headphone-streetwear",
    orientation: "portrait",
    version: "v02",
    filename: "animal-headphone-streetwear_blue-british-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Make the adult blue British Shorthair face distinctly Q-version and cartoon-cute like Image 2: noticeably oversized round plush head, broad soft cheeks, tiny short muzzle, simplified friendly features and a relaxed music-loving expression.",
      "Keep the blue-grey coat and amber eyes recognizable, plus the headphones, white shirt, crossbody bag, baggy black trousers, sneakers and clean studio poster composition.",
      "Avoid a realistic ordinary-cat head, kitten body, human face or uncanny proportions.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-sunglasses-rabbit",
    kind: "master",
    templateId: "animal-sunglasses-rabbit",
    orientation: "portrait",
    version: "v02",
    filename: "animal-sunglasses-rabbit_cream-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Increase the cream long-haired cat's fluff specifically across the entire face, cheeks, forehead and both ears until those areas are as densely furry and tousled as the body and as tactile as Image 2.",
      "Keep cat anatomy, sunglasses fitted over the eyes, scarf, low angle, grass, blue sky, stance and airy illustration unchanged.",
      "Do not smooth the face, shorten the ear fur or expose bald ear edges.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-capybara-snapshot",
    kind: "master",
    templateId: "animal-capybara-snapshot",
    orientation: "portrait",
    version: "v02",
    filename: "animal-capybara-snapshot_golden-dog_9x16_v02.png",
    prompt: [...sharedMaster,
      "Change only the adult Golden Retriever's expression to serious and unsmiling: mouth fully closed, tongue hidden, lips neutral, steady direct eyes and calm workplace-badge demeanor.",
      "Keep the same dog identity, close selfie perspective, extended foreleg, monitor, desk, collar and matching ID portrait.",
      "The ID portrait must show the same serious closed-mouth expression.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-enamel-cat-beast",
    kind: "master",
    templateId: "animal-enamel-cat-beast",
    orientation: "portrait",
    version: "v02",
    filename: "animal-enamel-cat-beast_ragdoll-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Replace the current tabby identity with one majestic adult seal-bicolor Ragdoll cat: broad fluffy cream-white face, dark seal ears and mask accents, clear blue eyes, pink nose, long silky chest fur and powerful healthy build.",
      "Keep the running pose, red field, white smoke, gold-turquoise-red flowing enamel ribbons and divine-beast energy exactly in the current self-owned visual language.",
      "The first read must be unmistakably a Ragdoll cat, not a tabby, kitten, Siamese or dog.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-glass-paw-portrait",
    kind: "master",
    templateId: "animal-glass-paw-portrait",
    orientation: "portrait",
    version: "v02",
    filename: "animal-glass-paw-portrait_toy-poodle-dog_9x16_v02.png",
    prompt: [...sharedMaster,
      "Replace the black cat with one irresistibly cute adult apricot Toy Poodle: round teddy-bear trim, dense curly apricot coat, round dark eyes, small black nose, compact muzzle and joyful open mouth.",
      "Keep both front paws pressed against the glass, aquarium fish, underwater surface, bubbles, close perspective and reflections.",
      "Preserve strong rippling water-caustic light projected across the poodle's forehead, cheeks and muzzle; those bright refracted streaks on the face are mandatory.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-warrior-cat",
    kind: "master",
    templateId: "animal-warrior-cat",
    orientation: "portrait",
    version: "v02",
    filename: "animal-warrior-cat_abyssinian-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Brighten the current master moderately: lift the cat's face, eyes, mask engravings, blue robe and foreground sleeve by about one stop while retaining highlights, shadows, contrast and cinematic depth.",
      "Do not change the Abyssinian identity, pose, sword, mask, costume, crop, background or warm-cool color relationship.",
      "Return a 9:16 portrait composition."].join(" "),
    masterOnly: true,
  },
  {
    id: "master-animal-sunglasses-rabbit-alt",
    kind: "master",
    templateId: "animal-sunglasses-rabbit-alt",
    orientation: "portrait",
    version: "v02",
    filename: "animal-sunglasses-rabbit-alt_golden-dog_9x16_v02.png",
    prompt: [...sharedMaster,
      "Make the Golden Retriever subject dramatically more rough, scribbly and windswept like Image 2: long chaotic fur spikes around the entire face, crown, cheeks and both ears, with loose stray strands breaking the silhouette.",
      "Keep the recognizable warm golden adult-dog identity, but simplify and fluff the facial forms so the face and ear treatment matches the reference's deliberately unkempt tactile effect.",
      "Keep the round sunglasses, red plaid scarf, low grass-level angle, blue sky, flowers and framing unchanged.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-sword-cat-alt",
    kind: "master",
    templateId: "animal-sword-cat-alt",
    orientation: "portrait",
    version: "v02",
    filename: "animal-sword-cat-alt_silver-abyssinian-cat_9x16_v02.png",
    prompt: [...sharedMaster,
      "Replace the current warm brown cat with the same type of pale cool-grey cat seen in Image 2: a refined light-silver Abyssinian or lightly spotted silver leopard-cat look, large upright ears, narrow elegant muzzle and pale grey coat.",
      "Keep the ornate dark metal mask, martial-arts paw pose, layered black-white costume, blue-red lighting, shallow depth of field and exact framing.",
      "The coat must read pale silver-grey, never ruddy brown, orange, cream or pure white.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-giant-law-poster",
    kind: "master",
    templateId: "animal-giant-law-poster",
    orientation: "portrait",
    version: "stylebridge-v03",
    filename: "animal-giant-law-poster_shepherd-dog_9x16_stylebridge-v03.png",
    prompt: [...sharedMaster,
      "Reduce the German Shepherd head and face substantially so the head occupies no more than about 12 percent of the image height.",
      "Reveal a far more monumental upright humanoid canine-deity body: very broad armored shoulders and chest, long powerful torso, two clear arms, narrow waist and vast robe, towering through the storm like Image 2.",
      "Preserve the recognizable German Shepherd face without turning the whole figure into a normal dog; body scale and human-like heroic silhouette must dominate.",
      "Keep the reaching foreground arm, cloud vortexes, lightning, golden backlight, tiny mountains and epic ant-scale camera.",
      "Return a 9:16 portrait composition."].join(" "),
  },
  {
    id: "master-animal-rabbit-yokai",
    kind: "master",
    templateId: "animal-rabbit-yokai",
    orientation: "portrait",
    version: "stylebridge-v03",
    filename: "animal-rabbit-yokai_cream-cat_9x16_stylebridge-v03.png",
    prompt: [...sharedMaster,
      "Refine the current cream-cat yokai master to the detail standard of Image 2: sharper and more delicate facial fur, layered cheek and chest strands, intricate embroidered blue-red textile, crisp metal filigree, individual gemstones, tassels and ornamental hardware.",
      "Add subtle cool blue-silver tonal depth to the fur and shadows while preserving the cream cat identity, stern elegant gaze, headpiece, frontal pose and night-market background.",
      "The result must look polished, premium and finely resolved rather than simplified or plastic.",
      "Return a 9:16 portrait composition."].join(" "),
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

async function prepareInput(source, label) {
  const output = path.join(INPUT_ROOT, `${label}.jpg`);
  if (!await exists(output)) {
    await sharp(source, { failOn: "error" })
      .rotate()
      .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
      .flatten({ background: "white" })
      .jpeg({ quality: 82, mozjpeg: true })
      .toFile(output);
  }
  return output;
}

const [masterIndex, libraryIndex] = await Promise.all([
  readFile(MASTER_INDEX, "utf8").then(JSON.parse),
  readFile(LIBRARY_INDEX, "utf8").then(JSON.parse),
]);
const masterById = new Map(masterIndex.templates.map((item) => [item.templateId, item]));
const libraryById = new Map(libraryIndex.frozen.map((item) => [item.templateId, item]));

if (TARGET !== "all" && !jobs.some((job) => job.id === TARGET)) throw new Error(`Unknown target ${TARGET}`);
if (!new Set(["all", "public", "master"]).has(KIND)) throw new Error(`Unknown kind ${KIND}`);

await Promise.all([
  mkdir(INPUT_ROOT, { recursive: true }),
  mkdir(path.join(OUTPUT_ROOT, "raw"), { recursive: true }),
  mkdir(path.join(OUTPUT_ROOT, "public-previews"), { recursive: true }),
  mkdir(path.join(OUTPUT_ROOT, "master-candidates"), { recursive: true }),
  mkdir(path.join(OUTPUT_ROOT, "metadata"), { recursive: true }),
]);

const selected = jobs.filter((job) => (TARGET === "all" || job.id === TARGET) && (KIND === "all" || job.kind === KIND));
const config = await loadEnv();
console.log(`lingsuan remediation: ${selected.length} job(s), sequential execution`);

for (const [position, job] of selected.entries()) {
  const master = masterById.get(job.templateId);
  const library = libraryById.get(job.templateId);
  if (!master || !library) throw new Error(`${job.templateId} is not in frozen library indexes`);
  const finalName = job.filename || `${job.templateId}_${job.version}.png`;
  const finalDir = job.kind === "public" ? "public-previews" : "master-candidates";
  const finalPath = path.join(OUTPUT_ROOT, finalDir, finalName);
  if (!FORCE && await exists(finalPath)) {
    console.log(`[${position + 1}/${selected.length}] skip ${job.id}`);
    continue;
  }

  const effectInput = await prepareInput(path.resolve(ROOT, library.effectReferencePath), `${job.templateId}-effect`);
  const imagePaths = job.kind === "public"
    ? [effectInput]
    : [await prepareInput(path.resolve(ROOT, master.path), `${job.templateId}-master`), ...job.masterOnly ? [] : [effectInput]];
  const inputBodies = await Promise.all(imagePaths.map((input) => readFile(input)));
  const inputBytes = inputBodies.reduce((sum, body) => sum + body.byteLength, 0);
  if (imagePaths.length > 2 || inputBytes > 1_000_000) {
    throw new Error(`${job.id} input guard failed: ${imagePaths.length} images / ${inputBytes} bytes`);
  }

  console.log(`[${position + 1}/${selected.length}] generate ${job.id}: ${imagePaths.length} image(s), ${inputBytes} bytes`);
  const requestedSize = job.orientation === "landscape" ? "1280x720" : "720x1280";
  const result = await edit(config, {
    imagePaths,
    prompt: job.prompt,
    size: requestedSize,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high",
  });
  const rawPath = path.join(OUTPUT_ROOT, "raw", `${job.id}.png`);
  await writeFile(rawPath, result.buffer);
  const final = await fit(result.buffer, job.orientation, { format: "png", anchor: job.orientation === "landscape" ? 0.5 : 1 / 3 });
  const actual = await dimensions(final);
  const expected = job.orientation === "landscape" ? { width: 1280, height: 720 } : { width: 720, height: 1280 };
  if (actual.width !== expected.width || actual.height !== expected.height) throw new Error(`${job.id} output size mismatch`);
  if (!await hasUsableVisualContent(final)) throw new Error(`${job.id} output has no usable visual content`);
  await writeFile(finalPath, final);
  await writeFile(path.join(OUTPUT_ROOT, "metadata", `${job.id}.json`), `${JSON.stringify({
    task: "user-requested-frozen-master-remediation-2026-08-19",
    templateId: job.templateId,
    kind: job.kind,
    version: job.version,
    status: "generated-pending-visual-review",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputFidelity: "high",
    inputPolicy: { sequential: true, maxImages: 2, maxCombinedBytes: 1_000_000 },
    inputs: imagePaths.map((input, index) => ({
      role: job.kind === "public" ? "effect-reference-edit-target" : index === 0 ? "current-self-owned-master" : "effect-reference-composition-guide",
      path: path.relative(ROOT, input).replaceAll("\\", "/"),
      bytes: inputBodies[index].byteLength,
      sha256: sha256(inputBodies[index]),
    })),
    orientation: job.orientation,
    requestedSize,
    output: {
      rawPath: path.relative(ROOT, rawPath).replaceAll("\\", "/"),
      finalPath: path.relative(ROOT, finalPath).replaceAll("\\", "/"),
      width: actual.width,
      height: actual.height,
      sha256: sha256(final),
    },
    prompt: job.prompt,
    revisedPrompt: result.revisedPrompt || null,
    generatedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
  console.log(`[${position + 1}/${selected.length}] complete ${finalPath}`);
}

console.log("Remediation generation pass complete. Outputs remain pending visual review.");
