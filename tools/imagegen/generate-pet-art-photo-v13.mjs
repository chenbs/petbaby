import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const platform = path.join(root, "apps/platform");
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const ts = require(require.resolve("typescript", { paths: [platform] }));
const sceneDir = path.join(root, "tools/imagegen/out/scenes");
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v13");
const inputDir = path.join(root, ".data/art-photo-v13-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg"),
  shorthair: path.join(root, "tools/imagegen/out/scenes-v7/identity-shorthair-v1.jpg"),
  corgi: path.join(root, "tools/imagegen/out/source/dog-corgi.jpg"),
  calico: path.join(root, "tools/imagegen/out/scenes-v7/identity-calico-v1.jpg"),
  sphynx: path.join(root, "tools/imagegen/out/scenes-v9/identity-sphynx-v1.jpg"),
  afghan: path.join(root, "tools/imagegen/out/scenes-v9/identity-afghan-v1.jpg"),
  greyhound: path.join(root, "tools/imagegen/out/scenes-v9/identity-greyhound-v1.jpg"),
  persian: path.join(root, "tools/imagegen/out/scenes-v9/identity-persian-v1.jpg"),
  siamese: path.join(root, "tools/imagegen/out/scenes-v9/identity-siamese-v1.jpg"),
  tuxedo: path.join(root, "tools/imagegen/out/source/cat-tuxedo.jpg"),
  cream: path.join(root, "tools/imagegen/out/source/cat-cream.jpg"),
  blacklab: path.join(root, "tools/imagegen/out/source/dog-black-lab.jpg"),
  husky: path.join(root, "tools/imagegen/out/source/dog-husky.jpg"),
  shiba: path.join(root, "tools/imagegen/out/source/dog-shiba.jpg"),
  blackcat: path.join(root, "tools/imagegen/out/source/cat-black.jpg")
};
const identities = {
  golden: "the same adult golden retriever from Image 1, with natural golden coat, floppy ears, dark eyes and black nose",
  poodle: "the same adult gray toy poodle from Image 1, with charcoal curly coat, lighter muzzle, floppy ears and compact build",
  british: "the same adult blue British Shorthair from Image 1, with round face, solid gray coat and copper-amber eyes",
  shorthair: "the same adult American Shorthair from Image 1, with silver tabby coat, bold black swirl markings, round face and copper-green eyes",
  corgi: "the same adult Pembroke Welsh Corgi from Image 1, with red-and-white coat, large upright ears, white chest and short legs",
  calico: "the same adult calico cat from Image 1, with white, orange and black patches, white chest and paws, and green-amber eyes",
  sphynx: "the same adult Sphynx cat from Image 1, hairless with warm pinkish-beige wrinkled skin, large ears and lemon-green eyes",
  afghan: "the same adult Afghan Hound from Image 1, with a long silky cream-and-golden coat, darker muzzle and long narrow head",
  greyhound: "the same adult Italian Greyhound from Image 1, with a short sleek blue-grey coat, white chest patch and slender legs",
  persian: "the same adult Chinchilla Persian cat from Image 1, with long silver-tipped white fur, flat sweet face and black-rimmed green eyes",
  siamese: "the same adult seal-point Siamese cat from Image 1, with cream body, dark seal-brown points and sapphire-blue eyes",
  tuxedo: "the same adult black-and-white tuxedo cat from Image 1, with black coat, white muzzle, white chest and paws, pink nose and green eyes",
  cream: "the same adult cream long-haired cat from Image 1, with fluffy pale cream-apricot coat, pink nose and blue eyes",
  blacklab: "the same adult black Labrador Retriever from Image 1, with short glossy black coat, floppy ears and warm brown eyes",
  husky: "the same adult Siberian Husky from Image 1, with grey-and-white coat, classic face mask, upright ears and ice-blue eyes",
  shiba: "the same adult red Shiba Inu from Image 1, with red-and-cream coat, white cheeks, upright triangular ears and dark eyes",
  blackcat: "the same adult solid black short-haired cat from Image 1, with glossy black coat and bright green eyes"
};
/*
 * v13（2026-10）：用户反馈 v12 多数套像生活剧情（洗澡、生日、拆家），不是艺术棚拍，且 AI 感明显。
 * 保留 v12 的半空接球、气球派对、抱着玩偶睡、冰淇淋舔舔，其余 16 套改回棚拍逻辑：
 * 纯色无缝纸背景 + 一盏主光 + 一两件简单道具 + 宠物自己的动作和表情，不搭完整生活场景。
 */
const redesigned = new Set([
  "railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday",
  "paper-flower-window", "mountain-cable-car", "laundry-day", "museum-curator", "poolside-vacation",
  "post-office", "shorthair-armchair", "shorthair-books", "shorthair-paper-bag",
  "corgi-sploot", "corgi-sweater", "calico-rain-window"
]);

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
  });
}

const scenes = sceneCatalog(await readFile(path.join(platform, "src/domain/pet-art-photo.ts"), "utf8"));
if (scenes.length !== 36) throw new Error("Expected 36 scenes");
const requested = process.argv.slice(2).filter((item) => !item.startsWith("--"));
if (requested.some((id) => !redesigned.has(id))) throw new Error("Unknown or protected scene ID");
const selected = scenes.filter((scene) => redesigned.has(scene.id) && (!requested.length || requested.includes(scene.id)));
if (!requested.length && selected.length !== 16) throw new Error("Expected 16 redesigned scenes");
for (const scene of selected) if (!references[scene.samplePet]) throw new Error(`No reference for ${scene.id}`);
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });
await mkdir(inputDir, { recursive: true });

for (const scene of selected) {
  const output = path.join(sceneDir, `scene-${scene.id}-v13.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v13.json`);
  if (await access(output).then(() => true, () => false) && await access(metaFile).then(() => true, () => false)) {
    console.log(`已存在 ${scene.id}`);
    continue;
  }
  const reference = references[scene.samplePet];
  const input = path.join(inputDir, `${scene.samplePet}.jpg`);
  // 离线返工固定小载荷：单张参考图，最长边 1200、质量约 80 的 JPEG。
  const inputBytes = await sharp(reference).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80, mozjpeg: true }).toBuffer();
  if (inputBytes.length > 1024 * 1024) throw new Error(`Reference too large: ${scene.samplePet}`);
  await writeFile(input, inputBytes);
  const prompt = [
    "Use case: a real photograph from a professional pet photo studio session, shot on a full-frame camera by an experienced pet photographer, the kind of image studios print and frame. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people, no human hands. The pet wears only the garments or accessories named in the scene, and nothing at all if the scene says no clothing.`,
    `Studio set and moment: ${scene.prompt}`,
    `Framing: ${scene.framing || "Vertical 3:4 photograph; the pet is the clear hero at about 45-65% of frame height, with plenty of plain backdrop around it."}`,
    "This is studio pet portraiture, not a lifestyle scene: only the seamless backdrop, the floor and the one or two props named above; no rooms, furniture, windows, plants, shelves or decorations beyond them. The fun comes from the pet's own action and expression with the prop, caught at a real, slightly imperfect moment.",
    "Make it look like a genuine camera photograph, not AI art: slightly asymmetric natural composition, the pet not perfectly centred, fur a little messy where it naturally would be, real stray hairs, believable weight and contact with the floor, a soft natural shadow from one key light, 85mm lens at about f/2.8 with focus on the eyes and gentle falloff, honest colours with mild contrast, faint paper wrinkles and floor scuffs on the backdrop, fine sensor grain.",
    "Avoid: glossy over-sharpened AI look, plastic or airbrushed fur, glowing rim light, overly saturated colours, perfect symmetry, staged lifestyle sets, prop clutter, extra props, cartoonish costumes, human-like poses, extra limbs, duplicate pets, floating body, pasted edges, text, letters, numbers, logos or watermark. Return one photograph only."
  ].join(" ");
  const result = await edit(config, { imagePath: input, prompt, size: "1200x1600", quality: "high", inputFidelity: "high", maxRetries: 3 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 90 });
  if (!await hasUsableVisualContent(bytes)) throw new Error(`${scene.id}: image has no visual content`);
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, bytes);
  await writeFile(metaFile, JSON.stringify({ id: scene.id, title: scene.title, samplePet: scene.samplePet, prompt,
    provider: "lingsuan", model: config.model, reference: path.relative(root, reference).replaceAll("\\", "/"),
    referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex"),
    output: path.relative(root, output).replaceAll("\\", "/"), sha256: hash, review: "pending-visual-review" }, null, 2) + "\n");
  console.log(`已生成 ${scene.id} (${scene.samplePet}) ${hash.slice(0, 12)}`);
}
