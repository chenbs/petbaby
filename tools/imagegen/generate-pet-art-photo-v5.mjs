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
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v5");
const inputDir = path.join(root, ".data/art-photo-v5-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg")
};
const actions = {
  "railway-traveler": "A candid frame of the dog walking along the platform toward camera while looking back toward the train, all four paws grounded, scarf moving slightly, travel bag left beside the bench.",
  "tennis-champion": "The dog is trotting diagonally after a loose tennis ball, one front paw raised mid-step, the other paws connected to the court, racket resting safely beyond the dog's path.",
  "greenhouse-gardener": "The dog leans its head down to sniff a rosemary plant at muzzle height, shoulders and four paws visible on the greenhouse floor, pots surrounding but not covering the body.",
  "sailboat-holiday": "The dog is lying securely on the dry deck with its front paws crossed and chin raised into the breeze, sail and water visible at a believable distance.",
  "berry-pastry-chef": "The poodle stands on the bakery floor beside a low pastry cart and looks intently at the berry tart, paws clearly on the floor rather than on the food counter.",
  "paper-flower-window": "The poodle walks across the low display plinth between two paper flowers, one forepaw forward and head turned gently toward camera, clear body-to-plinth contact.",
  "mountain-cable-car": "The poodle stands on the cabin's broad upholstered seat, paws pressing naturally into fabric, looking through the window at the snowy ridgeline; the cabin frame remains visible.",
  "laundry-day": "The poodle gently pulls one small gingham towel from the wicker basket with its mouth while standing on the floor, an imperfect candid action with realistic fabric folds.",
  "museum-curator": "The cat is slowly walking beside the exhibit plinth with one forepaw lifted and head turned toward a ceramic object, all objects safely behind glass and floor contact clearly visible.",
  "poolside-vacation": "The cat reclines lengthwise on the dry deck chair under the parasol, front paws stretched toward the camera, fur catching real midday sunlight; pool remains behind the chair.",
  "post-office": "The cat reaches one paw toward the twine of a small parcel resting on the sorting table, other paws anchored firmly on the table, curious side profile and alert eyes.",
  "ballet-backstage": "The cat steps out from between the velvet curtains onto a low wooden trunk with one forepaw raised, tail relaxed and real mirror bulbs receding behind it."
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
  const output = path.join(sceneDir, `scene-${scene.id}-v5.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v5.json`);
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
    "Use case: photorealistic-natural. A finished premium pet editorial photograph, not a digital composite. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no Ragdoll cat, no people.`,
    `Build a physically coherent location and tell this exact moment: ${scene.prompt} ${actions[scene.id]}`,
    "Frame as a candid eye-level 35mm or 50mm pet photograph with natural optical depth, subtle grain, authentic imperfections and light falling consistently across fur, props and floor. The pet's weight must have believable contact shadows and scale relative to nearby objects.",
    "Vertical 3:4, complete pet including paws and tail where visible, safe margins, clear expressive face occupying about 45-60% of frame height. Keep the action obvious even at small thumbnail size.",
    "Avoid centered seated studio-portrait pose unless the described action requires it. No floating body, pasted edges, plastic fur, overly smooth render, impossible clothing, extra limbs, duplicate pets, fantasy glow, pseudo-text, logo or watermark. Return one photograph only."
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
