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
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v6");
const inputDir = path.join(root, ".data/art-photo-v6-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg")
};
/*
 * v6（2026-10）：后 12 套改成真实摄影棚 / 自然光人文写真，去掉拟人服装、复杂布景与高饱和撞色。
 * 依据：单一主光（柔光箱或窗光）、纯色或手绘背景布、至多一件道具、低饱和、轻颗粒。
 */
const actions = {
  "railway-traveler": "The dog sits in a calm three-quarter turn, chin slightly lifted, the far side of the face falling into soft shadow.",
  "tennis-champion": "The dog lies down on the floorboards, front paws extended, head resting low and eyes turned toward the window light.",
  "greenhouse-gardener": "The dog sits upright beside the plaster wall with eyes half-closed in the warm striped light.",
  "sailboat-holiday": "The dog stands side-on and turns its head back toward camera, one forepaw resting on the low wooden stool.",
  "berry-pastry-chef": "The poodle sits neatly beside the stoneware jar and looks straight into the lens.",
  "paper-flower-window": "The poodle lowers its nose toward the dried wildflowers on the velvet, eyes soft.",
  "mountain-cable-car": "The poodle stands with all four paws planted and tilts its head with genuine curiosity.",
  "laundry-day": "The poodle is curled up on the wool blanket, one eye just opening toward camera.",
  "museum-curator": "The cat sits upright on the suitcase lid, tail wrapped around its paws, gazing calmly past the camera.",
  "poolside-vacation": "The cat sits on the windowsill in near profile, eyes turned toward camera, fur rimmed by soft backlight.",
  "post-office": "The cat lies on its side on the paper floor and looks back over its shoulder at the camera.",
  "ballet-backstage": "The cat sits inside the rattan basket, front paws on the rim, looking up toward camera."
};
const identities = {
  golden: "the same adult golden retriever from Image 1, with natural golden coat, floppy ears, dark eyes and black nose",
  poodle: "the same adult gray toy poodle from Image 1, with charcoal curly coat, lighter muzzle, floppy ears and compact build",
  british: "the same adult blue British Shorthair from Image 1, with round face, solid gray coat and copper-amber eyes"
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
if (scenes.length !== 12 || scenes.some((scene) => !references[scene.samplePet] || !actions[scene.id])) throw new Error("Expected 12 fully specified scenes");
const requested = process.argv.slice(2);
if (requested.some((id) => !actions[id])) throw new Error("Unknown scene ID");
const selected = requested.length ? scenes.filter((scene) => requested.includes(scene.id)) : scenes;
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });
await mkdir(inputDir, { recursive: true });

for (const scene of selected) {
  const output = path.join(sceneDir, `scene-${scene.id}-v6.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v6.json`);
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
    `Keep ${identities[scene.samplePet]}. One pet only, no people. The pet wears no clothing, costume, hat, bow or collar.`,
    `Set and light: ${scene.prompt} ${actions[scene.id]}`,
    "Photographic qualities: a single dominant light source with one consistent direction, natural soft falloff into shadow, true-to-life fur with individual strands and slight natural unevenness, realistic eye moisture with one small catchlight, believable contact shadow where the body meets the surface.",
    "Camera: full-frame camera with an 85mm portrait lens at about f/2.8, eye-level with the pet, shallow but natural depth of field, fine film-like grain, restrained true-to-life colors with low saturation, no HDR look, no heavy retouching.",
    "Vertical 3:4, complete pet with safe margins, the face occupying about 30-45% of frame height, simple uncluttered background with generous negative space.",
    "Avoid: anthropomorphic expressions or poses, clothing, glowing or rim light that looks painted, dramatic fantasy lighting, oversaturated colors, plastic or airbrushed fur, perfect symmetry, extra props, floating body, pasted edges, extra limbs, duplicate pets, CGI or illustration look, text, logos or watermark. Return one photograph only."
  ].join(" ");
  const result = await edit(config, { imagePath: input, prompt, size: "1200x1600", quality: "high", inputFidelity: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 90 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, bytes);
  await writeFile(metaFile, JSON.stringify({ id: scene.id, title: scene.title, samplePet: scene.samplePet, prompt,
    provider: "lingsuan", model: config.model, reference: path.relative(root, reference).replaceAll("\\", "/"),
    referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex"),
    output: path.relative(root, output).replaceAll("\\", "/"), sha256: hash, review: "pending-visual-review" }, null, 2) + "\n");
  console.log(`已生成 ${scene.id} (${scene.samplePet}) ${hash.slice(0, 12)}`);
}
