import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";

/*
 * v14（2026-10-06）两类改动，固定串行：
 * 1. 13 套 v12/v13 棚拍写真画面偏空：以当前样片为唯一输入，保留主设计，只加 1–2 件同主题装饰。
 * 2. 经典黑白肖像、街头雨衣、小拳击手、叼一束花下架，同 id 换成 4 套时尚杂志大片（对齐黑金礼服、丝绒王座）。
 * 3. 2026-10-07 用户复审：泳圈小将、滑板少年、毛线帽换示范宠物（黑白雪纳瑞、白雪纳瑞、白萨摩耶）整张重拍；
 *    草地花环午后、软玩具野餐从户外生活情景改成棚拍新主题（贵宾泰迪、陨石边牧）；加冕时刻改为黑白雪纳瑞的时尚位。
 */
const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const platform = path.join(root, "apps/platform");
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const ts = require(require.resolve("typescript", { paths: [platform] }));
const sceneDir = path.join(root, "tools/imagegen/out/scenes");
const metaDir = path.join(root, "tools/imagegen/out/miniprogram-v14");
const inputDir = path.join(root, ".data/art-photo-v14-inputs");
const references = {
  golden: path.join(root, "tools/imagegen/out/source/dog-golden.jpg"),
  poodle: path.join(root, "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg"),
  british: path.join(root, "tools/imagegen/out/source/cat-british.jpg"),
  husky: path.join(root, "tools/imagegen/out/source/dog-husky.jpg"),
  // 2026-10-07 用户嫌 v1 雪纳瑞不够可爱，改用用户提供的参考照（不进版本控制，只作身份参考）
  schnauzer: path.join(root, ".data/art-photo-v14-refs/schnauzer-user-ref.jpg"),
  whiteschnauzer: path.join(root, "tools/imagegen/out/scenes-v14/identity-schnauzer-white-v1.jpg"),
  samoyed: path.join(root, "tools/imagegen/out/scenes-v14/identity-samoyed-v1.jpg"),
  teddy: path.join(root, "tools/imagegen/out/scenes-v14/identity-teddy-v1.jpg"),
  merle: path.join(root, "tools/imagegen/out/scenes-v14/identity-merle-v1.jpg")
};
const identities = {
  golden: "the same adult golden retriever from Image 1, with natural golden coat, floppy ears, dark eyes and black nose",
  poodle: "the same adult gray toy poodle from Image 1, with charcoal curly coat, lighter muzzle, floppy ears and compact build",
  british: "the same adult blue British Shorthair from Image 1, with round face, solid gray coat and copper-amber eyes",
  husky: "the same adult Siberian Husky from Image 1, with grey-and-white coat, classic face mask, upright ears and ice-blue eyes",
  schnauzer: "the same young Miniature Schnauzer from Image 1, a fluffy puppy-like look with a soft round face, big round shiny dark eyes, a short fluffy white muzzle and soft white eyebrows, dark grey head top and ears with long silky fringes, salt-and-pepper grey-and-white fluffy coat and fluffy white legs; keep it just as sweet and adorable as in Image 1, but without its harness or collar",
  whiteschnauzer: "the same adult pure white Miniature Schnauzer from Image 1, with soft all-white coat, fluffy white eyebrows, white beard and moustache, folded ears, black nose and dark eyes",
  samoyed: "the same adult white Samoyed from Image 1, with thick fluffy pure white coat, upright triangular ears, black lips in the classic Samoyed smile and dark almond eyes",
  teddy: "the same adult apricot toy poodle from Image 1, in a round teddy-bear cut with soft curly apricot coat, round fluffy face and ears, dark button eyes and black nose",
  merle: "the same adult blue merle Border Collie from Image 1, with marbled silver-grey and black merle coat, white blaze, white collar ruff and paws, tan cheek points, semi-erect ears, one light blue eye and one brown eye"
};
/* 当前样片版本 → 本轮只加的装饰（与 pet-art-photo.ts 里追加的句子同义） */
const decorations = {
  "railway-traveler": ["v13", "a small stack of two old cloth-bound books under the magnifying-glass stand and an open antique brass pocket watch on the floor beside it"],
  "tennis-champion": ["v13", "two pale ribbon streamers tied to the fan grille fluttering in the wind, and a tall glass of iced lemonade with a lemon slice and a striped paper straw on the floor"],
  "sailboat-holiday": ["v13", "two smaller gift boxes in cream and blush paper with satin bows stacked beside the main box, and a few curls of ribbon on the floor"],
  "berry-pastry-chef": ["v12", "two more soft fabric balls in mustard and sky blue resting on the floor, and a low red-and-white striped training hurdle standing behind"],
  "mountain-cable-car": ["v13", "a small glass jar of bone-shaped biscuits in a lower corner with two biscuits on the floor"],
  "laundry-day": ["v13", "a ball of matching oatmeal yarn with two wooden knitting needles, and a mug in a knitted cosy, beside the sweater"],
  "museum-curator": ["v13", "a small stack of colourful picture books with a red apple on top on the floor beside the chair, and a small blank wooden-framed chalk slate leaning against a chair leg"],
  "post-office": ["v13", "two more folded white paper airplanes already landed on the floor, and a small stack of pastel origami paper nearby"],
  "corgi-sploot": ["v13", "a tipped-over wicker knitting basket spilling two more yarn balls in cream and mustard onto the floor"],
  "corgi-sweater": ["v13", "a halved watermelon behind the dog and a woven straw sun hat lying on the floor nearby"],
  "calico-rain-window": ["v13", "a sealed cream envelope closed with a red heart sticker and a few loose red rose petals scattered near the heart cushion"]
};
const covers = new Set(["snow-cabin", "city-rain", "greenhouse-gardener", "paper-flower-window"]);
/* 整张重拍的棚拍场景：示范宠物换了或主题重新设计 */
const studios = new Set(["lakeside-sunset", "spring-picnic", "poolside-vacation", "shorthair-armchair", "shorthair-paper-bag"]);

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

function decoratePrompt(extra) {
  return [
    "Edit Image 1, a finished professional pet studio photograph. Keep it exactly as it is: the same pet with the same identity, pose, expression and fur, the same seamless backdrop colour, the same main prop, light direction, camera angle, framing and colour grading.",
    `Add only these new set decorations, placed naturally on the floor or at the sides and behind the pet so they never cover its face or body: ${extra}.`,
    "The new pieces must belong to the same theme as the existing props, sit at a believable scale in the same light with soft contact shadows, and leave clear empty backdrop around the pet: tidy, airy and uncluttered, not crowded.",
    "Avoid: changing or moving the pet, a different backdrop colour, extra animals, people or hands, more decorations than listed, clutter, text, letters, numbers, logos or watermark. Return one photograph only."
  ].join(" ");
}

/*
 * 2026-10-06 用户复审：首版四套（人类衬衫领、西装翻领、人形上身）像「宠物拟人化 AI 换衣」被否。
 * 能成立的丝绒王座 / 墨镜风衣 / 黑金礼服，衣服都是宠物真的套得上的版型。所以这里强约束：
 * 宠物专用版型、动物自己的身体与姿态、衣服与身体的贴合和褶皱真实，不出现人类衬衫领、领带、人形肩线。
 */
function coverPrompt(scene) {
  return [
    "Use case: a real photograph from a luxury pet fashion studio shoot, the kind a premium pet-apparel brand prints in a fashion magazine. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people, no hands.`,
    `Set, garment and moment: ${scene.prompt}`,
    "The garment is a real piece of pet clothing sewn for this animal's body shape, the kind actually sold for pets and put on a real dog or cat for a shoot: it wraps the animal's own back, chest and neck, the legs come out of it naturally, the fabric sits with believable weight, small folds and slight bunching where the body bends, and fur pokes out at the edges. The pet keeps its real animal anatomy, proportions and posture; it is clearly an animal wearing pet clothes, not a person.",
    "Photographic qualities: one dominant key light with natural falloff, true-to-life fur with individual strands, realistic eye moisture with one catchlight, believable contact shadow on the floor or seat. Medium-format camera, 85-100mm lens at about f/4, refined magazine colour grading, mild contrast, fine grain, no plastic retouching.",
    `Attitude: noble, poised and a little aloof, a calm self-assured gaze, so any owner would want this shot of their own pet. Indoor studio only. Framing: ${scene.framing}`,
    "Avoid: anthropomorphic dressing, a human torso or human shoulders, an upright human-like posture, human dress shirts, shirt collars, neckties, suit lapels on a human-shaped chest, clothes that look painted or pasted onto the fur, a head pasted on a costume, cartoonish costumes, crowns, extra accessories, cluttered sets, outdoor scenery, glowing rim light, oversaturated colours, perfect symmetry, extra limbs, duplicate pets, CGI or illustration look, text, logos or watermark. Return one photograph only."
  ].join(" ");
}

function studioPrompt(scene) {
  return [
    "Use case: a real photograph from a professional pet photo studio session, shot on a full-frame camera by an experienced pet photographer, the kind of image studios print and frame. Image 1 is the identity reference only, not a pose or background template.",
    `Keep ${identities[scene.samplePet]}. One pet only, no people, no human hands. The pet wears only the garments or accessories named in the scene, and nothing at all if the scene says no clothing.`,
    `Studio set and moment: ${scene.prompt}`,
    `Framing: ${scene.framing || "Vertical 3:4 photograph; the pet is the clear hero at about 45-65% of frame height, with plenty of plain backdrop around it."}`,
    "This is studio pet portraiture, not a lifestyle scene: only the seamless backdrop, the floor and the props named above, placed tidily with clear empty backdrop around the pet; no rooms, furniture, windows, plants or shelves beyond them. The fun comes from the pet's own action and expression with the props, caught at a real, slightly imperfect moment.",
    "Make it look like a genuine camera photograph, not AI art: slightly asymmetric natural composition, the pet not perfectly centred, fur a little messy where it naturally would be, real stray hairs, believable weight and contact with the floor, a soft natural shadow from one key light, 85mm lens at about f/2.8 with focus on the eyes and gentle falloff, honest colours with mild contrast, faint paper wrinkles and floor scuffs on the backdrop, fine sensor grain.",
    "Avoid: glossy over-sharpened AI look, plastic or airbrushed fur, glowing rim light, overly saturated colours, perfect symmetry, staged lifestyle sets, outdoor scenery, prop clutter, extra props, cartoonish costumes, human-like poses, extra limbs, duplicate pets, floating body, pasted edges, text, letters, numbers, logos or watermark. Return one photograph only."
  ].join(" ");
}

const scenes = sceneCatalog(await readFile(path.join(platform, "src/domain/pet-art-photo.ts"), "utf8"));
if (scenes.length !== 36) throw new Error("Expected 36 scenes");
const requested = process.argv.slice(2).filter((item) => !item.startsWith("--"));
if (requested.some((id) => !decorations[id] && !covers.has(id) && !studios.has(id))) throw new Error("Unknown or protected scene ID");
const selected = scenes.filter((scene) => (decorations[scene.id] || covers.has(scene.id) || studios.has(scene.id)) && (!requested.length || requested.includes(scene.id)));
if (!requested.length && selected.length !== 20) throw new Error("Expected 20 v14 scenes");
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });
await mkdir(inputDir, { recursive: true });

for (const scene of selected) {
  const output = path.join(sceneDir, `scene-${scene.id}-v14.jpg`);
  const metaFile = path.join(metaDir, `scene-${scene.id}-v14.json`);
  if (await access(output).then(() => true, () => false) && await access(metaFile).then(() => true, () => false)) {
    console.log(`已存在 ${scene.id}`);
    continue;
  }
  const cover = covers.has(scene.id);
  const studio = studios.has(scene.id);
  if ((cover || studio) && !references[scene.samplePet]) throw new Error(`No reference for ${scene.id}`);
  const reference = cover || studio ? references[scene.samplePet] : path.join(sceneDir, `scene-${scene.id}-${decorations[scene.id][0]}.jpg`);
  const input = path.join(inputDir, `${scene.id}.jpg`);
  // 离线返工固定小载荷：单张输入，最长边 1200、质量约 82 的 JPEG。
  const inputBytes = await sharp(reference).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
  if (inputBytes.length > 1024 * 1024) throw new Error(`Input too large: ${scene.id}`);
  await writeFile(input, inputBytes);
  const prompt = cover ? coverPrompt(scene) : studio ? studioPrompt(scene) : decoratePrompt(decorations[scene.id][1]);
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
