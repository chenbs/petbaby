import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile, access } from "node:fs/promises";
import path from "node:path";

import { generate, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "tools/imagegen/out/together-v1");
const jobs = [
  {
    id: "together-selfie-photobomb",
    title: "抢镜自拍",
    mood: "funny",
    prompt: "A spontaneous phone selfie on a sunny city sidewalk: an adult East Asian woman in a cream casual jacket is laughing at the camera while her own medium golden retriever leans its muzzle into the lower foreground, playfully stealing the frame. Both faces are fully visible and naturally proportioned, the dog's nose slightly closer to the lens without grotesque distortion. The woman is holding the phone with one anatomically correct hand; dog body and front paws remain visible. Their gaze and expressions make this a believable funny moment, not a staged portrait."
  },
  {
    id: "together-sofa-yawn",
    title: "同步打哈欠",
    mood: "funny",
    prompt: "A candid photograph in a lived-in apartment: an adult East Asian man in a soft blue sweater sits at one end of a sofa while his short-haired orange tabby cat sits beside him, and both are caught mid-yawn at the same instant. One human and one cat only. The man's face remains attractive and clearly visible, the cat has a complete natural body and four paws touching the cushion; their parallel poses create the joke. Coffee table and window light provide real spatial depth. No exaggerated cartoon facial deformation."
  },
  {
    id: "together-rainy-umbrella",
    title: "雨天一把伞",
    mood: "warm",
    prompt: "An intimate candid street photograph just after rain: an adult East Asian woman in a simple tan trench coat holds a large transparent umbrella low over herself and her small cream poodle. She crouches beside the dog on a quiet wet sidewalk, smiling down at it; the dog looks up at her. Both faces and the dog's full body with paws on the pavement are visible. Natural reflections on wet stone, a few soft city lights in the distance, real rain droplets on the umbrella. A believable affectionate exchange, no staged studio lighting."
  },
  {
    id: "together-window-nap",
    title: "午后靠着你",
    mood: "warm",
    prompt: "A quiet documentary photograph at home: an adult East Asian man in a pale linen shirt sits by a sunlit window, gently resting one hand on a blue British Shorthair cat curled against his side on a wide sofa. The man's face and the cat's expressive round face are both clearly visible, their bodies make natural contact, the cat's paws rest on the cushion. Soft unmade throw blanket and houseplants create a warm real home without visual clutter. An honest tender moment, subtle smile, no posed catalogue look."
  }
];

await mkdir(output, { recursive: true });
const config = await loadEnv();
for (const job of jobs) {
  const file = path.join(output, `${job.id}.jpg`);
  const metadataFile = path.join(output, `${job.id}.json`);
  if (await access(file).then(() => true, () => false) && await access(metadataFile).then(() => true, () => false)) {
    console.log(`已存在 ${job.id}`);
    continue;
  }
  const prompt = [
    "Use case: photorealistic-natural. Asset type: an original self-owned frozen master for a pet-and-owner portrait effect.",
    job.prompt,
    "Make a single vertical 9:16 35mm lifestyle photograph with a full coherent scene, physically plausible perspective, matching contact shadows and consistent natural light. Real skin texture and pet fur, moderate optical depth and gentle film grain. Keep both subjects within generous safe margins so neither face, hand, paw nor tail is cropped by a 9:16 frame. Their identities may later be replaced separately, so the owner and pet must remain clearly distinct and unobstructed.",
    "No real person's likeness, no public figure, no logo, no written text, no watermark, no extra humans or pets, no floating limbs, duplicate anatomy, plastic fur, overprocessed skin, pasted edges, fantasy glow or glossy AI illustration. Return one photograph only."
  ].join(" ");
  const result = await generate(config, { prompt, size: "1024x1792", quality: "high", maxRetries: 1 });
  const image = await fit(result.buffer, "portrait", { anchor: 0.5, quality: 91 });
  if (!await hasUsableVisualContent(image)) throw new Error(`${job.id}: image has no visual content`);
  await writeFile(file, image);
  await writeFile(metadataFile, JSON.stringify({ id: job.id, title: job.title, mood: job.mood, provider: "lingsuan", model: config.model, prompt, output: path.relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(image).digest("hex"), review: "pending-visual-review" }, null, 2) + "\n");
  console.log(`已生成 ${job.id} ${image.length} bytes`);
}
