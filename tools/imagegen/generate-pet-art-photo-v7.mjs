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
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v7");
const inputDir = path.join(root, ".data/art-photo-v7-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg"),
  shorthair: path.join(root, "tools/imagegen/out/scenes-v7/identity-shorthair-v1.jpg"),
  corgi: path.join(root, "tools/imagegen/out/source/dog-corgi.jpg"),
  calico: path.join(root, "tools/imagegen/out/scenes-v7/identity-calico-v1.jpg")
};
/*
 * v7（2026-10）：写真扩到 36 套。
 * - 后 12 套里 6 套加一件克制的衣物或饰品点缀（围巾、领巾、毛衣、旧皮项圈、蕾丝领），另 6 套保持 v6 素净，不重生成；
 * - 新增 12 套用美短、柯基、三花猫各 4 套，风格与 v6 一致：单一主光或窗光、纯色 / 手绘背景、至多一件道具。
 */
const actions = {
  "railway-traveler": "The dog sits in a calm three-quarter turn, chin slightly lifted, the far side of the face falling into soft shadow.",
  "greenhouse-gardener": "The dog sits upright beside the plaster wall with eyes half-closed in the warm striped light.",
  "berry-pastry-chef": "The poodle sits neatly beside the stoneware jar and looks straight into the lens.",
  "laundry-day": "The poodle is curled up on the wool blanket, one eye just opening toward camera.",
  "museum-curator": "The cat sits upright on the suitcase lid, tail wrapped around its paws, gazing calmly past the camera.",
  "post-office": "The cat lies on its side on the paper floor and looks back over its shoulder at the camera.",
  "shorthair-armchair": "The cat sits curled into the armchair corner, paws tucked under, eyes lifted toward camera.",
  "shorthair-books": "The cat sits upright beside the book stack and tilts its head with quiet curiosity.",
  "shorthair-night-rim": "The cat stands side-on and turns its face to camera, rim light tracing the coat.",
  "shorthair-paper-bag": "The cat peeks out of the paper bag with front paws on its edge, eyes wide.",
  "corgi-denim": "The corgi sits facing camera with ears up and a relaxed open-mouth smile.",
  "corgi-crate": "The corgi stands with front paws on the crate and looks up past the camera.",
  "corgi-sploot": "The corgi lies in a sploot with hind legs stretched flat, chin on the floor, eyes up.",
  "corgi-sweater": "The corgi dozes curled in the patch of sunlight, one ear up.",
  "calico-silk": "The cat lies on the silk with front paws crossed and looks back toward camera.",
  "calico-bowl": "The cat sits upright behind the bowl, tail around its paws, looking into the lens.",
  "calico-rain-window": "The cat sits on the sill in near profile watching the rain, then glances toward camera.",
  "calico-cane-stool": "The cat sits neatly on the cane stool with front paws together, looking slightly off-camera."
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
  const output = path.join(sceneDir, `scene-${scene.id}-v7.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v7.json`);
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
    "Use case: photorealistic fine-art pet portrait, shot by a professional pet photographer in a real studio or a real room. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people. Wear only the single garment or accessory named in the set description, fitted naturally and understated; if none is named, the pet wears nothing.`,
    `Set and light: ${scene.prompt} ${actions[scene.id]}`,
    "Photographic qualities: a single dominant light source with one consistent direction, natural soft falloff into shadow, true-to-life fur with individual strands and slight natural unevenness, realistic eye moisture with one small catchlight, believable contact shadow where the body meets the surface.",
    "Camera: full-frame camera with an 85mm portrait lens at about f/2.8, eye-level with the pet, shallow but natural depth of field, fine film-like grain, restrained true-to-life colors with low saturation, no HDR look, no heavy retouching.",
    "Vertical 3:4, complete pet with safe margins, the face occupying about 30-45% of frame height, simple uncluttered background with generous negative space.",
    "Avoid: anthropomorphic expressions or poses, costumes, hats, glasses, multiple accessories, glowing or rim light that looks painted, dramatic fantasy lighting, oversaturated colors, plastic or airbrushed fur, perfect symmetry, extra props, floating body, pasted edges, extra limbs, duplicate pets, CGI or illustration look, text, logos or watermark. Return one photograph only."
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
