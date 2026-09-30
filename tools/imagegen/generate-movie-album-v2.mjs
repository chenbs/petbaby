import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { generate, loadEnv } from "./client.mjs";
import { fit, hasUsableVisualContent } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(import.meta.dirname, "out/movie-album-v3");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.join(root, "apps/platform")] }));

const jobs = [
  {
    group: "movie", id: "highseas", title: "晴海远航", eyebrow: "A PET FILM / ADVENTURE", color: "#174b58",
    prompt: "Use case: ads-marketing. Vertical 3:4 premium photorealistic pet adventure film key art, cinematic wide establishing shot with strong foreground-to-horizon depth. In the foreground a real golden retriever, full body and paws clearly visible on the open deck of an original old sailing ship, occupies roughly 38 percent of frame height and looks alert toward the sunlit horizon. White sails tower diagonally overhead, turquoise sea stretches to distant sunlit islands and dramatic white clouds, a few ribbons of wind and spray suggest a voyage about to begin. Bright midday sunlight, luminous aqua and ivory palette with warm honey fur, crisp natural face and eyes, premium practical film lighting, large outdoor scale. Keep the bottom 20 percent visually simple for a separately added title without making the scene dark. No text, logos, skull flag, branded costume, recognizable franchise imagery, extra animals, cropped paws or distorted anatomy."
  },
  {
    group: "movie", id: "musical", title: "落日歌舞", eyebrow: "A PET FILM / MUSICAL", color: "#723f50",
    prompt: "Use case: ads-marketing. Vertical 3:4 premium photorealistic pet musical film key art with a sweeping architectural setting. A real caramel toy poodle is the sole protagonist, full body and paws clearly visible on broad stone steps in the foreground, occupying roughly 38 percent of frame height. Beyond it a vast open-air theater plaza descends into the distance: curved terraces, an elegant unbranded stage canopy, small glowing festoon lights, soft silhouettes of a distant audience and petals caught in a dance-like breeze. Radiant golden-hour sun and peach, coral, rose and cream tones, joyous and romantic atmosphere, bright face and natural fur, dynamic diagonal leading lines, cinematic 35mm wide-angle sense of scale. Musical storytelling through the setting, no floating notes. Keep the bottom 20 percent clean for a separately added title while retaining natural brightness. Entirely original, no text, logos, recognizable film pose, copyrighted characters, extra animals or distorted limbs."
  },
  {
    group: "movie", id: "webcity", title: "云端巡游", eyebrow: "A PET FILM / CITY HERO", color: "#7a3944",
    prompt: "Use case: ads-marketing. Vertical 3:4 premium photorealistic pet city-hero film key art, an expansive bright daytime city panorama with a distinct warm crimson-and-cream palette. A real orange tabby cat is the sole protagonist, full body and all paws grounded on a wide safe pale-stone rooftop terrace in the left foreground, occupying about 38 percent of frame height, alert face lit by soft daylight. Behind it a huge vermilion-red suspension bridge sweeps diagonally across a narrow river through sunlit ivory and pale rose city towers, repeating bridge cables and streets leading toward a distant hazy skyline; a simple burgundy scarf adds motion. Architectural red bridge must be the dominant color accent, warm cream city must fill most of the background; only a small amount of blue sky or water, no blue-dominant image. Bright clear noon light, crisp realistic fur, a sense of discovery and decisive foreground-to-horizon depth. Keep the bottom-right quarter open and visually calm for a separate title. Original urban setting; no rain, night, superhero costume, mask, emblem, logos, text, recognizable franchise imagery, extra animals or distorted limbs."
  },
  {
    group: "movie", id: "starvoyage", title: "星际远航", eyebrow: "A PET FILM / SPACE", color: "#39516d",
    prompt: "Use case: ads-marketing. Vertical 3:4 premium photorealistic pet space adventure film key art, epic wide-angle establishing view of a near-future observation deck opening onto a vast alien world. A real cream corgi is the sole protagonist in the left foreground, standing naturally on a believable pale metal floor; show its complete body and paws, and turn its head three-quarters toward camera so both eyes, muzzle and expression are unmistakably visible. The pet must not face away from the viewer. Huge curved window frames lead the eye to a luminous ice-blue planet hanging above white cloud valleys and a sunlit silver coastline far below; small distant spacecraft silhouettes establish scale. Pearly white, glacier blue and restrained tangerine highlights, clean bright daylight filtering through the window, tactile plausible architecture, hopeful discovery and strong foreground-midground-background separation. Leave clear open floor and sky in the bottom-right quarter for a separately added title. Entirely original, no franchise helmets, weapons, logos, text, extra pets or anatomy errors."
  },
  {
    group: "album", id: "growth", title: "成长记录", eyebrow: "MY LITTLE DAYS", color: "#e4f2e7",
    prompt: "Use case: product-mockup. Vertical 3:4 close overhead photograph of a refined handmade pet growth scrapbook page on pale mint paper. Three neatly arranged real photographic prints show the SAME golden retriever at puppy, adolescent and adult stages, recognizable coat and eyes across ages. Washi tape, small hand-drawn timeline dots, one dried leaf, generous white margin, tactile paper, youthful and collectible editorial art direction. Clean page hierarchy and realistic printed photos, bright natural daylight. Leave bottom margin open for title added later. No readable text, logos, human hands, duplicate limbs or glossy plastic textures."
  },
  {
    group: "album", id: "birthday", title: "生日纪念", eyebrow: "A DAY FOR YOU", color: "#fff0bb",
    prompt: "Use case: product-mockup. Vertical 3:4 close overhead photograph of a refined pet birthday scrapbook page on soft butter-yellow paper. Three neatly arranged real photo prints of the SAME small caramel toy poodle wearing a simple ribbon, beside a pet-safe little cake and a single candle in the scene; consistent face and curls in each print. Sparse coral paper confetti, a folded invitation, subtle printed date marks without readable lettering, tactile paper and gentle window light. Playful, sophisticated editorial album art direction, clear photo subjects, open bottom margin for later title. No readable text, logos, hands, extra limbs or overloaded stickers."
  },
  {
    group: "album", id: "healing", title: "治愈日常", eyebrow: "SOFT DAYS TOGETHER", color: "#e4eef8",
    prompt: "Use case: product-mockup. Vertical 3:4 close overhead photograph of a calm pet daily-life scrapbook page on powder blue paper. Three neatly arranged real photographic prints show the SAME blue British Shorthair cat resting, stretching and watching afternoon sunlight at home, consistent face and amber eyes. Pale blue photo corners, a pressed tiny white flower and soft pencil-like rules, roomy white margin, paper grain and realistic photographic depth. Gentle collected-memory art direction, quiet and warm, bottom margin open for later title. No readable text, logos, hands, extra limbs or crowded decorations."
  },
  {
    group: "album", id: "holiday", title: "节日相册", eyebrow: "OUR BRIGHTEST DAY", color: "#f8e9e0",
    prompt: "Use case: product-mockup. Vertical 3:4 close overhead photograph of a festive pet scrapbook page on soft coral paper. Three neatly arranged real photographic prints show the SAME Shiba Inu enjoying a home celebration with paper garlands, wrapped gifts and warm string lights; consistent face and natural paws in every print. Small red and cream paper accents, a ribbon crossing one corner, tactile matte print surfaces and generous clean margins. Joyful refined editorial album design, not tied to any single holiday, bottom margin open for later title. No readable text, logos, people, extra limbs or excessive decoration."
  }
];

function overlay(job) {
  const movie = job.group === "movie";
  const titleColor = movie ? "#fffaf1" : "#243835";
  const top = movie ? "" : `<rect x="0" y="510" width="480" height="120" fill="${job.color}" fill-opacity="0.95"/>`;
  const gradient = movie ? `<defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.72" stop-color="${job.color}" stop-opacity="0"/><stop offset="1" stop-color="${job.color}" stop-opacity="0.88"/></linearGradient></defs><rect width="480" height="630" fill="url(#shade)"/>` : top;
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="480" height="630">${gradient}<text x="30" y="${movie ? 518 : 546}" fill="${titleColor}" font-family="Arial" font-size="15" letter-spacing="2">${job.eyebrow}</text><text x="28" y="${movie ? 577 : 601}" fill="${titleColor}" font-family="Microsoft YaHei, sans-serif" font-weight="bold" font-size="42">${job.title}</text></svg>`);
}

const recompose = process.argv.includes("--recompose");
const regenerate = process.argv.includes("--regenerate");
const selected = process.argv.slice(2).filter((item) => item !== "--recompose" && item !== "--regenerate");
if (selected.some((id) => !jobs.some((job) => job.id === id))) throw new Error("Unknown asset id");
const config = await loadEnv();
await mkdir(output, { recursive: true });

for (const job of jobs.filter((item) => !selected.length || selected.includes(item.id))) {
  const rawFile = path.join(output, `${job.group}-${job.id}-raw.jpg`);
  const finalFile = path.join(output, `${job.group}-${job.id}.jpg`);
  const metaFile = path.join(output, `${job.group}-${job.id}.json`);
  if (!recompose && !regenerate && await access(finalFile).then(() => true, () => false) && await access(metaFile).then(() => true, () => false)) {
    console.log(`已存在 ${job.group}/${job.id}`);
    continue;
  }
  let raw;
  if (recompose) {
    raw = await readFile(rawFile);
  } else {
    const generated = await generate(config, { prompt: job.prompt, size: "1024x1536", quality: "high", maxRetries: 1 });
    if (!await hasUsableVisualContent(generated.buffer)) throw new Error(`${job.id} 返回空白图`);
    raw = await fit(generated.buffer, "card", { anchor: 0.4, quality: 92 });
    await writeFile(rawFile, raw);
  }
  const base = await sharp(raw).resize(480, 630, { fit: "cover", position: "centre" }).toBuffer();
  const final = await sharp(base).composite([{ input: overlay(job) }]).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  await writeFile(finalFile, final);
  await writeFile(metaFile, JSON.stringify({
    id: job.id, group: job.group, provider: "lingsuan", model: config.model, prompt: job.prompt,
    finalPrompt: job.prompt, source: path.relative(root, rawFile).replaceAll("\\", "/"),
    output: path.relative(root, finalFile).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(final).digest("hex"), review: "pending-visual-review"
  }, null, 2) + "\n");
  console.log(`已生成 ${job.group}/${job.id}`);
}

if (!selected.length || jobs.filter((job) => job.group === "movie").every((job) => selected.includes(job.id))) {
  const movieJobs = jobs.filter((job) => job.group === "movie");
  const tiles = await Promise.all(movieJobs.map(async (job, index) => ({
    input: await sharp(path.join(output, `movie-${job.id}.jpg`)).resize(240, 315).toBuffer(),
    left: index * 240,
    top: 0
  })));
  await sharp({ create: { width: movieJobs.length * 240, height: 315, channels: 3, background: "#ffffff" } })
    .composite(tiles).jpeg({ quality: 88 }).toFile(path.join(output, "review-contact.jpg"));
}
