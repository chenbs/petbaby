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
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v4");
const inputDir = path.join(root, ".data/art-photo-v4-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg")
};
const identities = {
  golden: "the same adult golden retriever from Image 1, with its warm golden coat, floppy ears, dark eyes, black nose and naturally joyful face",
  poodle: "the same adult gray toy poodle from Image 1, with compact build, charcoal curly coat, lighter gray muzzle, floppy ears and dark eyes",
  british: "the same adult blue British Shorthair cat from Image 1, with round face, dense solid gray coat, copper-amber eyes and small upright ears"
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

const scenes = sceneCatalog(await readFile(path.join(root, "apps/platform/src/domain/pet-art-photo.ts"), "utf8"));
if (scenes.length !== 12 || scenes.some((scene) => !references[scene.samplePet])) throw new Error("Expected 12 new art-photo scenes with approved pet breeds");
const requested = process.argv.slice(2);
if (requested.some((id) => !scenes.some((scene) => scene.id === id))) throw new Error("Unknown scene ID");
const selected = requested.length ? scenes.filter((scene) => requested.includes(scene.id)) : scenes;
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });
await mkdir(inputDir, { recursive: true });

for (const scene of selected) {
  const output = path.join(sceneDir, `scene-${scene.id}-v4.jpg`);
  const metaFile = path.join(metaDir, `scenes-${scene.id}-v4.json`);
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
    "Use case: finished public sample for a premium photorealistic pet art-photo series. Edit Image 1 into a new real editorial photograph.",
    `Keep ${identities[scene.samplePet]}; no other breed, no Ragdoll cat. One pet only.`,
    "Vertical 3:4 image. Show the complete natural head, body and paws; leave 8% safety margin around the pet. Pet occupies 45-65% of frame height, with face and eyes sharp and unobstructed.",
    `Scene, composition, mood, styling and props: ${scene.prompt}`,
    "Use real fabric, physical props and believable contact shadows. Young, playful, polished visual style with crisp daylight or practical studio light. No people or hands, duplicate pets, extra limbs, CGI, illustration, logos, readable text or watermark. Return one image only."
  ].join(" ");
  const result = await edit(config, { imagePath: input, prompt, size: "1200x1600", quality: "medium", inputFidelity: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 90 });
  const hash = createHash("sha256").update(bytes).digest("hex");
  await writeFile(output, bytes);
  await writeFile(metaFile, JSON.stringify({ id: scene.id, title: scene.title, description: scene.description, samplePet: scene.samplePet, prompt, provider: "lingsuan", model: config.model, reference: path.relative(root, reference).replaceAll("\\", "/"), referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex"), output: path.relative(root, output).replaceAll("\\", "/"), sha256: hash, review: "pending-visual-review" }, null, 2) + "\n");
  console.log(`已生成 ${scene.id} (${scene.samplePet}) ${hash.slice(0, 12)}`);
}
