import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const platform = path.join(root, "apps/platform");
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const ts = require(require.resolve("typescript", { paths: [platform] }));
const sceneDir = path.join(root, "tools/imagegen/out/scenes");
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v8");
const inputDir = path.join(root, ".data/art-photo-v8-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg"),
  shorthair: path.join(root, "tools/imagegen/out/scenes-v7/identity-shorthair-v1.jpg"),
  corgi: path.join(root, "tools/imagegen/out/source/dog-corgi.jpg"),
  calico: path.join(root, "tools/imagegen/out/scenes-v7/identity-calico-v1.jpg")
};
/*
 * v8（2026-10）：13–36 里保留 10 套，其余 14 套重做。用户反馈旧版暗沉、单调、表情呆板，
 * 这一版要明亮、表情生动、让人看了想给自家宠物试：一半萌趣（泡泡、花冠、泡泡浴、毛线球、草莓、毛毯、向日葵、青蛙趴），
 * 一半有气质（花店、珍珠、咖啡馆窗边、小绅士、樱花、梳妆台）。仍是真实摄影，不做卡通或过度拟人。
 */
const actions = {
  "tennis-champion": "The dog sits on the grass with a big happy open-mouth pant, eyes bright, gaze following a floating bubble.",
  "paper-flower-window": "The poodle tilts its head to one side with bright curious eyes and a gentle open-mouth smile.",
  "corgi-sploot": "The corgi lies in a sploot, chin up, ears perked, mouth slightly open with the tongue tip showing.",
  "corgi-crate": "The corgi sits in the foam tub with front paws on the rim, a little foam on its head, smiling at camera.",
  "shorthair-paper-bag": "The cat lies on its side and reaches one front paw up to swat the yarn ball, eyes wide and playful.",
  "calico-bowl": "The cat sits at the table edge, tongue just licking its nose, eyes half-closed with contentment.",
  "laundry-day": "The poodle is wrapped in the blanket like a burrito, only face and front paws showing, with a sleepy content smile.",
  "corgi-denim": "The corgi stands among sunflowers with ears up and a wide happy open-mouth smile.",
  "mountain-cable-car": "The poodle sits neatly beside the flower buckets, looking calmly toward camera with soft eyes.",
  "post-office": "The cat sits in an elegant three-quarter turn, chin slightly raised, eyes calm and luminous.",
  "shorthair-night-rim": "The cat lounges on the window-seat cushion with eyes half-closed, basking in the sun.",
  "corgi-sweater": "The corgi sits upright with its chest proudly out, ears up and a gentle closed-mouth smile.",
  "calico-rain-window": "The cat sits on the grass and looks up at a falling petal with wide, wonder-filled eyes.",
  "calico-cane-stool": "The cat sits on the vanity and turns to look back at camera with a soft, sweet gaze, its reflection softly visible."
};
const identities = {
  golden: "the same adult golden retriever from Image 1, with natural golden coat, floppy ears, dark eyes and black nose",
  poodle: "the same adult gray toy poodle from Image 1, with charcoal curly coat, lighter muzzle, floppy ears and compact build",
  british: "the same adult blue British Shorthair from Image 1, with round face, solid gray coat and copper-amber eyes",
  shorthair: "the same adult American Shorthair from Image 1, with silver tabby coat, bold black swirl markings, round face and copper-green eyes",
  corgi: "the same adult Pembroke Welsh Corgi from Image 1, with red-and-white coat, large upright ears, white chest and short legs",
  calico: "the same adult calico cat from Image 1, with white, orange and black patches, white chest and paws, and green-amber eyes"
};

function sceneCatalog(sourceText) {
  const source = ts.createSourceFile("pet-art-photo.ts", sourceText, ts.ScriptTarget.Latest, true);
  let array;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === "petArtPhotoScenes") {
      array = ts.isAsExpression(node.initializer) ? node.initializer.expression : node.initializer;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!array || !ts.isArrayLiteralExpression(array)) throw new Error("petArtPhotoScenes missing");
  return array.elements.map((item) => {
    const values = {};
    for (const property of item.properties || []) {
      if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) values[property.name.text] = property.initializer.text;
    }
    return values;
  }).filter((item) => item.samplePet);
}

const scenes = sceneCatalog(await readFile(path.join(platform, "src/domain/pet-art-photo.ts"), "utf8"));
if (scenes.length !== 24 || scenes.some((scene) => !references[scene.samplePet])) throw new Error("Expected 24 sample-pet scenes");
const requested = process.argv.slice(2);
if (requested.some((id) => !actions[id])) throw new Error("Unknown scene ID");
const selected = scenes.filter((scene) => actions[scene.id] && (!requested.length || requested.includes(scene.id)));
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });
await mkdir(inputDir, { recursive: true });

for (const scene of selected) {
  const output = path.join(sceneDir, `scene-${scene.id}-v8.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v8.json`);
  if (await access(output).then(() => true, () => false) && await access(metaFile).then(() => true, () => false)) {
    console.log(`已存在 ${scene.id}`);
    continue;
  }
  const reference = references[scene.samplePet];
  const input = path.join(inputDir, `${scene.samplePet}.jpg`);
  const inputBytes = await sharp(reference).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  if (inputBytes.length > 1024 * 1024) throw new Error(`Reference too large: ${scene.samplePet}`);
  await writeFile(input, inputBytes);
  const prompt = [
    "Use case: photorealistic, bright and charming lifestyle pet portrait, shot by a professional pet photographer in a real place. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people. Wear only the single garment or accessory named in the set description, fitted naturally and understated; if none is named, the pet wears nothing.`,
    `Set and light: ${scene.prompt} ${actions[scene.id]}`,
    "Photographic qualities: a single dominant light source with one consistent direction, natural soft falloff into shadow, true-to-life fur with individual strands and slight natural unevenness, realistic eye moisture with one small catchlight, believable contact shadow where the body meets the surface.",
    "Camera: full-frame camera with an 85mm portrait lens at about f/2.8, eye-level with the pet, shallow natural depth of field. Bright, clean, well-exposed image with fresh natural colors that are lively but not oversaturated, soft pleasing light on the face, no HDR look, no heavy retouching.",
    "Expression matters most: the pet looks alive and endearing, with bright eyes and a natural, readable emotion, so that any pet owner would want the same photo of their own pet. Vertical 3:4, complete pet with safe margins, the face occupying about 35-50% of frame height, uncluttered background.",
    "Avoid: dull or dark muddy tones, blank or sleepy-stiff expression unless the scene says the pet is dozing, human-like poses, costumes, hats, glasses, multiple accessories, glowing or rim light that looks painted, dramatic fantasy lighting, oversaturated colors, plastic or airbrushed fur, perfect symmetry, extra props, floating body, pasted edges, extra limbs, duplicate pets, CGI or illustration look, text, logos or watermark. Return one photograph only."
  ].join(" ");
  const result = await edit(config, { imagePath: input, prompt, size: "1200x1600", quality: "high", inputFidelity: "high", maxRetries: 3 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 90 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, bytes);
  await writeFile(metaFile, JSON.stringify({ id: scene.id, title: scene.title, samplePet: scene.samplePet, prompt,
    provider: "lingsuan", model: config.model, reference: path.relative(root, reference).replaceAll("\\", "/"),
    referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex"),
    output: path.relative(root, output).replaceAll("\\", "/"), sha256: hash, review: "pending-visual-review" }, null, 2) + "\n");
  console.log(`已生成 ${scene.id} (${scene.samplePet}) ${hash.slice(0, 12)}`);
}
