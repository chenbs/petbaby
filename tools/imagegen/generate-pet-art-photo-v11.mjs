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
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v11");
const inputDir = path.join(root, ".data/art-photo-v11-inputs");
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
  siamese: path.join(root, "tools/imagegen/out/scenes-v9/identity-siamese-v1.jpg")
};
/*
 * v11（2026-10）：用户反馈 v10 不够「帅气高贵」——高贵指气质、表情和动作，不是品种。
 * 参考用户给的时尚大片：撞色或深色背景、半身特写、一两件实物；姿态是昂头、睥睨、侧身回望，服饰是礼服、皮衣、金链、墨镜风衣。
 * 场景 id 与位置不变，丝绒王座保留不重拍。
 */
const actions = {
  "shorthair-night-rim": "The Sphynx sits tall, chin raised high, looking down its nose at the camera with half-lidded aloof eyes.",
  "corgi-denim": "The dog stands side-on and turns its head over its shoulder to stare straight into the lens, cool and unimpressed.",
  "calico-rain-window": "The cat sits in profile with chin lifted and slides its eyes toward the camera with a haughty diva gaze.",
  "calico-cane-stool": "The cat sits upright, head tilted slightly down, gazing over the top of the sunglasses it is wearing."
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
  siamese: "the same adult seal-point Siamese cat from Image 1, with cream body, dark seal-brown points and sapphire-blue eyes"
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
  const output = path.join(sceneDir, `scene-${scene.id}-v11.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v11.json`);
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
    "Use case: photorealistic high-end international fashion magazine editorial (Vogue / Harper's Bazaar style) pet portrait, shot by a top fashion photographer in a professional indoor studio. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people. Wear exactly the garments and accessories named in the set description, tailored and clearly visible; nothing else.`,
    `Set and light: ${scene.prompt} ${actions[scene.id]}`,
    "Photographic qualities: a single dominant light source with one consistent direction, natural soft falloff into shadow, true-to-life fur with individual strands and slight natural unevenness, realistic eye moisture with one small catchlight, believable contact shadow where the body meets the surface.",
    "Camera: medium-format fashion camera with a 100mm lens at about f/4, eye-level, crisp detail on the face and coat. Controlled professional studio lighting, refined color grading like a printed magazine spread, deep clean tones, no HDR look, no plastic retouching.",
    "Attitude matters most: handsome, noble and commanding like a top fashion model on a magazine cover, with a strong pose and a cool, self-assured, slightly aloof expression, so that any pet owner would want this cover shot of their own pet. Indoor studio only, never outdoors, never a wide landscape. Vertical 3:4 half-body portrait from head to chest, the pet large in frame, with one or two real set pieces partly visible beside it so the backdrop is not empty.",
    "Avoid: outdoor scenery, nature backgrounds, messy cluttered sets, full-body tiny pet, cute or goofy expressions, dull muddy tones, blank or sleepy expression, human-like poses, cartoonish costumes, hats, multiple accessories, glowing or rim light that looks painted, dramatic fantasy lighting, oversaturated colors, plastic or airbrushed fur, perfect symmetry, extra props, floating body, pasted edges, extra limbs, duplicate pets, CGI or illustration look, text, logos or watermark. Return one photograph only."
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
