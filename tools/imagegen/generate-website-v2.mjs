import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const outputRoot = path.join(root, "tools/imagegen/out/website-v2");
const rawRoot = path.join(outputRoot, "raw");
const websiteAssets = path.join(root, "apps/website/public/assets");
const prototypeAssets = path.join(root, "docs/website/prototype/assets");

const shared = [
  "premium commercial pet campaign for a modern Chinese pet memories product",
  "playful and irresistibly cute, expressive natural pet face and body, high-end art direction",
  "bright clean studio lighting, crisp detail, tasteful coral yellow sky-blue and lilac accents",
  "minimal contemporary composition, polished brand photography, charming enough to make viewers want to try it",
  "no readable text, no letters, no numbers, no watermark, no logo, no UI screenshot, no people unless explicitly requested",
];

const jobs = [
  {
    id: "website-v2-play-id-card",
    ratio: "cover",
    prompt: "A collectible pet profile card as a delightful physical product object, a fluffy cream kitten peeking through a rounded window with a huge mischievous smile, colorful sticker-like geometric accents and soft glossy paper, the card is clean and premium rather than bureaucratic, centered on a pale studio surface."
  },
  {
    id: "website-v2-play-poster",
    ratio: "cover",
    anchor: 0,
    prompt: "A vertical pet movie poster artwork presented flat in a clean gallery, a tiny corgi hero riding an oversized pastel rocket-shaped toy through a sky-blue cloud set, strong cinematic lighting, generous blank lower area for later web typography, playful scale contrast, premium campaign finish."
  },
  {
    id: "website-v2-play-album",
    ratio: "cover",
    prompt: "A colorful printed pet photo album opened to a spread showing the same orange tabby cat in three funny everyday poses: upside down, hiding in a tote bag, and proudly wearing a tiny paper crown, clean ivory studio surface with coral and butter-yellow blocks, top-down editorial product photograph."
  },
  {
    id: "website-v2-ai",
    ratio: "cover",
    anchor: 0.32,
    prompt: "A joyful AI pet portrait concept: a fluffy black-and-white cat styled as a tiny fashion icon in a cobalt-blue sculptural outfit, oversized flower-shaped sunglasses resting above the eyes, confident curious expression, clean seamless studio, playful but sophisticated, no human body."
  },
  {
    id: "website-v2-human-v2",
    ratio: "card",
    prompt: "A single charming fictional adult human character inspired by a small apricot poodle, the only subject in the image, natural human face and anatomy, curly apricot hair, warm cream and coral outfit, playful confident pose in a candy-colored studio, subtle visual cues from the pet's palette and personality, fashion editorial quality, clearly human. Absolutely no animal, no dog, no cat, no pet, no animal ears, no muzzle, no paws, no fur, no tail, no mixed anatomy, no second subject."
  },
  {
    id: "website-v2-interactive",
    ratio: "cover",
    prompt: "A cute shiba inu exploring a tiny interactive sky garden built from soft floating clouds, glowing star-shaped particles and round stepping stones, the dog reaches one paw toward a light, whimsical sense of touch and discovery, clean premium 3D editorial illustration, uncluttered background."
  },
  {
    id: "website-v2-video",
    ratio: "cover",
    prompt: "A cinematic still for a pet companion short film: a joyful golden retriever running through a colorful sunlit room filled with translucent curtains and moving confetti-like light, motion in the fur and paws, expressive face, premium film color grade, no party clutter."
  },
  {
    id: "website-v2-timeline",
    ratio: "cover",
    prompt: "A clean editorial growth story for one same small grey cat shown across four charming seasonal moments in a single visual composition: spring flower, summer fan, autumn leaf, winter scarf, consistent identity and proportions, playful progression, spacious pale background, premium product campaign."
  },
  {
    id: "website-v2-health",
    ratio: "cover",
    prompt: "A reassuring pet wellness moment: a cute round tabby cat standing on a simple pastel weighing scale beside a neat notebook and a small water bowl, bright airy studio, friendly and calm, no clinical diagnosis imagery, no medical text, premium lifestyle campaign photograph."
  },
  {
    id: "website-v2-memorial-studio",
    ratio: "landscape",
    anchor: 0.5,
    prompt: "A warm pet remembrance campaign photograph in a bright pastel studio, landscape 16:9 composition. One irresistibly cute fluffy cream puppy sits on a low soft lilac cushion, gently resting its chin and front paws on one small butter-yellow plush star, looking lovingly into the camera. A simple oversized cream arch behind it, soft peach backdrop and powder-blue floor, just three tiny sculptural stars suspended nearby suggest cherished memories. Natural lifelike puppy anatomy and tactile fur, tender and reassuring rather than sad, premium editorial pet photography, warm diffused daylight, restrained set design. Show the complete puppy and cushion with generous safe space above the ears and below the paws; keep all important subjects within the middle 60 percent of image height for a wide website crop. No night sky, no dark background, no grave, no angel wings, no rainbow bridge, no wooden table, no photo frame, no collage, no text or watermark."
  },
];

async function exists(file) {
  return access(file).then(() => true, () => false);
}

await mkdir(rawRoot, { recursive: true });
await mkdir(websiteAssets, { recursive: true });
await mkdir(prototypeAssets, { recursive: true });
const requestedIds = process.argv.slice(2);
const selectedJobs = requestedIds.length ? jobs.filter((job) => requestedIds.includes(job.id)) : jobs;
if (requestedIds.some((id) => !jobs.some((job) => job.id === id))) {
  throw new Error("未知官网素材 ID");
}
const config = await loadEnv();

async function runJob(job) {
  try {
    const rawPath = path.join(rawRoot, `${job.id}.png`);
    const finalPath = path.join(outputRoot, `${job.id}.jpg`);
    const prompt = [...shared, job.prompt].join(". ");
    if (!await exists(rawPath)) {
      const result = await generate(config, { prompt, size: "1024x1024", quality: "low", maxRetries: 0 });
      await writeFile(rawPath, result.buffer);
      await writeFile(path.join(outputRoot, `${job.id}.json`), JSON.stringify({ id: job.id, ratio: job.ratio, anchor: job.anchor ?? 0.42, prompt, provider: "lingsuan", model: config.model, generatedAt: new Date().toISOString() }, null, 2) + "\n");
    }
    const fitted = await fit(await readFile(rawPath), job.ratio, { anchor: job.anchor ?? 0.42, quality: 88 });
    const metadataPath = path.join(outputRoot, `${job.id}.json`);
    const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
    await writeFile(metadataPath, JSON.stringify({ ...metadata, ratio: job.ratio, anchor: job.anchor ?? 0.42 }, null, 2) + "\n");
    await writeFile(finalPath, fitted);
    await writeFile(path.join(websiteAssets, `${job.id}.jpg`), fitted);
    await writeFile(path.join(prototypeAssets, `${job.id}.jpg`), fitted);
    console.log(`完成 ${job.id}`);
  } catch (error) {
    console.error(`失败 ${job.id}: ${error.message}`);
    process.exitCode = 1;
  }
}

for (const job of selectedJobs) {
  await runJob(job);
}

if (!process.exitCode) console.log(`官网 V2 素材完成：${selectedJobs.length} 张`);
