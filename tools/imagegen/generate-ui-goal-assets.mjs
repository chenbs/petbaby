import { createHash } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { generate, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const outputDir = path.join(import.meta.dirname, "out", "goal-20260929");

const jobs = [
  {
    id: "movie-cover-v4", ratio: "hero", size: "1600x1000",
    prompt: "Use case: ads-marketing. Create the photographic base for a premium wide pet movie poster, 16:10 landscape. A single real adult golden retriever is the clear film protagonist on the RIGHT half of a rain-washed city roof at blue hour, full head and body visible, standing naturally with paws grounded; subtle city lights and a warm practical spotlight behind, dramatic cinematic composition and believable lens perspective. LEFT half stays dark, uncluttered and empty for a large title to be added later. Rich midnight blue, warm amber and restrained rose accent, practical light on fur, realistic film grain and ordinary architecture. A convincing photographed film key art frame, emotional but playful, no text, no logos, no watermark, no extra animals or people, no CGI glow, no extra limbs."
  },
  {
    id: "fun-personality-v2", ratio: "square", size: "1024x1024",
    prompt: "Use case: photorealistic-natural. Square editorial cover for a playful pet personality quiz. A real Shiba Inu dog pauses at a fork in a sunlit garden path, one paw lifted, ears attentive, curious expression and complete natural body visible; two paths framed by peach and mint flowering shrubs. Eye-level 50mm pet photography, spontaneous action, soft morning sunlight and realistic shadows. Fresh coral and garden green palette, youthful and refined, clear subject at thumbnail size. No text, no cards, no costume, no duplicate pet, no logo, no plastic fur, no CGI or impossible anatomy."
  },
  {
    id: "fun-luck-v2", ratio: "square", size: "1024x1024",
    prompt: "Use case: photorealistic-natural. Square editorial cover for a lighthearted quiz about little everyday luck. A real blue British Shorthair cat reaches one paw toward a small sunny patch beside a simple paper pinwheel on a home windowsill, relaxed complete body with paws and tail visible, amber eyes alert. Natural window light makes a soft golden reflection on fur and pale linen, believable contact and scale. Warm butter yellow, powder blue and cream, candid 50mm photography, charming without fantasy symbols. No text, no logos, no watermark, no floating objects, no extra limbs, no plastic fur or CGI."
  },
  {
    id: "fun-bond-v2", ratio: "square", size: "1024x1024",
    prompt: "Use case: photorealistic-natural. Square editorial cover for a pet and owner companionship quiz. A real adult golden retriever rests its head softly against its owner's denim-clad knee on a park bench, one natural human hand gently touching its neck, no visible face. Dog's eyes and whole head prominent, torso and paws visible; candid unposed affection, believable body scale, genuine late-afternoon light, cream and soft sky-blue accents, shallow optical depth. Warm emotional realism suitable for a polished young pet app. No text, logo, watermark, extra people, extra dogs, extra hands, distorted paws or CGI."
  },
  {
    id: "fun-recharge-v2", ratio: "square", size: "1024x1024",
    prompt: "Use case: photorealistic-natural. Square editorial cover for a quiz about how a pet lifts the owner's mood. A real small caramel toy poodle rests on a rumpled pale mint sofa cushion in a sunny living room, awake and offering a slightly funny head tilt toward camera, a worn soft toy nearby. Complete head and front paws visible, natural pose, window light crossing realistic curls, comfortable lived-in room details. Mint, warm cream and butter-yellow palette, candid refined pet photography, inviting smile at thumbnail size. No text, logo, watermark, duplicate pet, extra limbs, plastic fur or CGI."
  },
];

const targets = process.argv.slice(2);
if (targets.some((id) => !jobs.some((job) => job.id === id))) throw new Error("Unknown asset id");
const selected = targets.length ? jobs.filter((job) => targets.includes(job.id)) : jobs;
const config = await loadEnv();
await mkdir(outputDir, { recursive: true });

for (const job of selected) {
  const output = path.join(outputDir, `${job.id}.jpg`);
  const metadata = path.join(outputDir, `${job.id}.json`);
  if (await access(output).then(() => true, () => false) && await access(metadata).then(() => true, () => false)) {
    console.log(`已存在 ${job.id}`);
    continue;
  }
  const result = await generate(config, { prompt: job.prompt, size: job.size, quality: "high", maxRetries: 1 });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.id} 返回无有效画面`);
  const bytes = await fit(result.buffer, job.ratio, { anchor: 0.5, quality: 90 });
  await writeFile(output, bytes);
  await writeFile(metadata, JSON.stringify({
    id: job.id, provider: "lingsuan", model: config.model, prompt: job.prompt,
    output: path.relative(root, output).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    review: "pending-visual-review",
  }, null, 2) + "\n");
  console.log(`已生成 ${job.id}`);
}
