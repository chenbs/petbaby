/**
 * 人宠写真 v2 8 组 × 2 镜头的自有母版（2026-10，按「艺术棚拍」重做）。断点续跑：已存在的镜头跳过。
 *
 * 镜头一文生图；镜头二只传镜头一这一张参考图做图生图（最长边 ≤1200、JPEG 约 82），
 * 让同一组的人物、宠物、穿搭与布景保持一致。产物待人工目检后由 finalize-duo-photo-v2.mjs 登记（v1 脚本已随 v1 素材删除）。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, generate, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";
import { duoGroups } from "./duo-photo-catalog.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.join(root, "apps/platform")] }));
const output = path.join(root, "tools/imagegen/out/duo-v2");
const inputDir = path.join(root, ".data/duo-v2-inputs");
const requested = process.argv.slice(2).filter((item) => !item.startsWith("--"));
const exists = (file) => access(file).then(() => true, () => false);

function describe(group, shot) {
  return [
    "Use case: a real photograph from a professional pet-and-owner art portrait studio session, shot on a full-frame camera by an experienced portrait photographer, like the printed sample albums studios show their clients. Asset type: an original self-owned frozen master; the identities will later be replaced by a real owner and their own pet.",
    `Exactly one human and one pet: ${group.person} and ${group.pet}. The human is a generic, attractive, natural-looking adult with real skin texture, not a celebrity or any real person.`,
    `Wardrobe, coordinated so the person and the pet share one colour story: ${group.wardrobe}`,
    `Studio set and light: ${group.set}`,
    `Pose and interaction: ${shot.action}`,
    "This is a studio art portrait, not a lifestyle or street scene: only the seamless backdrop, the floor and the few props named above; no rooms, windows, kitchens, streets, vehicles, beaches or outdoor scenery. The person poses like a portrait model and the pet is their partner; the image is built on pose, eye contact and a warm, designed interaction between them.",
    "Both the human face and the pet face must be clearly visible, well lit and naturally proportioned; the human and the pet have separate complete bodies with believable physical contact and weight, correct hands with five fingers, and paws resting naturally. Keep both faces inside generous safe margins of a vertical 9:16 frame.",
    "Make it look like a genuine camera photograph, not AI art: slightly asymmetric natural composition, natural skin with pores and fine flyaway hairs, fur a little messy where it naturally would be, fabric with real creases, faint paper wrinkles and floor scuffs on the backdrop, one large soft key light with natural falloff and soft shadows, 50-85mm lens at about f/2.8, honest colours with mild contrast, fine sensor grain.",
    "Avoid: glossy over-sharpened AI look, plastic skin or fur, beauty-filter faces, glowing rim light, oversaturated colours, perfect symmetry, staged lifestyle sets, prop clutter, extra humans or pets, duplicate anatomy, floating limbs, distorted hands, text, letters, logos or watermark. Return one photograph only."
  ].join(" ");
}

await mkdir(output, { recursive: true });
await mkdir(inputDir, { recursive: true });
const config = await loadEnv();
for (const group of duoGroups) {
  if (requested.length && !requested.some((id) => id === group.id || group.shots.some((shot) => shot.id === id))) continue;
  for (const [index, shot] of group.shots.entries()) {
    if (requested.length && !requested.includes(group.id) && !requested.includes(shot.id)) continue;
    const file = path.join(output, `${shot.id}.jpg`);
    const metadataFile = path.join(output, `${shot.id}.json`);
    if (await exists(file) && await exists(metadataFile)) { console.log(`已存在 ${shot.id}`); continue; }
    let prompt = describe(group, shot);
    let result;
    let referenceFile = "";
    if (index === 0) {
      result = await generate(config, { prompt, size: "1024x1792", quality: "high", maxRetries: 3 });
    } else {
      const first = path.join(output, `${group.shots[0].id}.jpg`);
      if (!await exists(first)) throw new Error(`${shot.id}: 先生成同组镜头一`);
      referenceFile = path.join(inputDir, `${group.id}.jpg`);
      const bytes = await sharp(first).resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).jpeg({ quality: 82, mozjpeg: true }).toBuffer();
      if (bytes.length > 1024 * 1024) throw new Error(`${shot.id}: 参考图过大`);
      await writeFile(referenceFile, bytes);
      prompt = [
        "Image 1 is an earlier frame from the same photo session. Keep exactly the same human (face, hair, age, body), the same pet (breed, coat, markings, eye colour), the same wardrobe, the same set, colour palette and lighting. Only change the pose, moment and camera distance as described below; this must look like the next photo in the same shoot, not a copy of Image 1.",
        prompt
      ].join(" ");
      result = await edit(config, { imagePath: referenceFile, prompt, size: "1024x1536", quality: "high", inputFidelity: "high", maxRetries: 3 });
    }
    const image = await fit(result.buffer, "portrait", { anchor: 0.4, quality: 91 });
    if (!await hasUsableVisualContent(image)) throw new Error(`${shot.id}: 画面无有效内容`);
    await writeFile(file, image);
    await writeFile(metadataFile, JSON.stringify({ id: shot.id, groupId: group.id, title: shot.title, provider: "lingsuan", model: config.model, prompt,
      reference: referenceFile ? path.relative(root, path.join(output, `${group.shots[0].id}.jpg`)).replaceAll("\\", "/") : null,
      output: path.relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(image).digest("hex"), review: "pending-visual-review" }, null, 2) + "\n");
    console.log(`已生成 ${shot.id} ${image.length} bytes`);
  }
}
