import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";
import { fit, hasUsableVisualContent, dimensions } from "./crop.mjs";
import { generate, loadEnv } from "./client.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const outputRoot = path.join(root, "tools/imagegen/out/pet-workshop-v1");
const rawRoot = path.join(outputRoot, "raw");
const sharp = createRequire(path.resolve(root, "apps/platform/package.json"))("sharp");

const shared = [
  "premium commercial pet campaign for a modern Chinese pet memories product",
  "playful and irresistibly cute, instantly recognizable concept, high-end art direction",
  "one clearly visible pet as the main subject, expressive natural face and body, tactile physical set",
  "bright clean studio lighting, crisp detail, tasteful coral yellow sky-blue lilac mint accents",
  "minimal contemporary composition, polished editorial pet photography, charming enough to make viewers want to try it",
  "no readable text, letters, numbers, watermark, logo, UI, or human people",
];

const themes = [
  {
    id: "04-cloud-mail",
    name: "云朵邮差",
    category: "角色冒险",
    prompt: "a happy corgi as a tiny cloud mail carrier, wearing a miniature sky-blue satchel and paper cap, standing beside a fluffy cloud mailbox, one paw reaching toward a floating heart-shaped parcel, pale blue sky set, whimsical but premium",
    anchor: 0.38,
  },
  {
    id: "05-bubble-tea",
    name: "奶茶店长",
    category: "日常职业",
    prompt: "a curious orange tabby as a tiny bubble tea shop helper, sitting beside an oversized pastel drink cup with tapioca pearls and a striped straw, wearing a tiny coral apron, cheerful counter set, playful scale contrast, no drinking",
    anchor: 0.42,
  },
  {
    id: "06-space-rover",
    name: "月球探险车",
    category: "幻想冒险",
    prompt: "a brave shiba inu in a clear toy astronaut bubble helmet, seated in a tiny rounded moon rover, floating star props and a lavender planet around it, colorful studio space set, heroic but irresistibly cute, clearly still a dog",
    anchor: 0.4,
  },
  {
    id: "07-pastel-dj",
    name: "彩色 DJ 台",
    category: "音乐派对",
    prompt: "a black-and-white cat wearing colorful oversized headphones, paws resting on a tiny pastel DJ controller, soft coral and cobalt stage lights, playful paper confetti and small speakers, joyful music festival energy, clearly still a cat",
    anchor: 0.4,
  },
  {
    id: "08-paw-detective",
    name: "爪印侦探",
    category: "互动解谜",
    prompt: "a toy poodle detective with an oversized magnifying glass, following a trail of glowing paw prints through a candy-colored studio, miniature trench coat and detective hat, curious surprised face, clean visual story, no human body",
    anchor: 0.4,
  },
  {
    id: "09-rainy-day",
    name: "雨天散步",
    category: "生活记录",
    prompt: "a joyful golden retriever in a bright yellow raincoat under a transparent dome umbrella, standing beside reflective puddles with tiny paper boats, teal and peach rain set, warm diffused light, cozy rather than gloomy",
    anchor: 0.42,
  },
  {
    id: "10-giant-garden",
    name: "巨型花园",
    category: "趣味日常",
    prompt: "a fluffy cream kitten exploring an oversized greenhouse, sitting beside a giant strawberry and a tiny mint watering can, flower vines and soft glass reflections, playful scale contrast, bright coral and mint palette, one kitten",
    anchor: 0.4,
  },
  {
    id: "11-undersea-submarine",
    name: "海底潜水艇",
    category: "幻想探险",
    prompt: "a curious corgi peeking from the round window of a small colorful toy submarine in an underwater garden, bubbles, coral, sea stars and soft fish-shaped props, turquoise and lilac studio world, adventurous and cute, clearly still a dog",
    anchor: 0.4,
  },
  {
    id: "12-storybook-castle",
    name: "立体故事书",
    category: "童话想象",
    prompt: "a fluffy cream puppy sitting inside an oversized pop-up storybook, surrounded by a paper castle, folded clouds and tiny stars, wearing a small sky-blue cape, tactile paper folds, warm ivory studio, magical and playful, one puppy",
    anchor: 0.4,
  },
];

const existing = [
  {
    id: "01-flying-adventure",
    name: "飞行冒险",
    category: "幻想冒险",
    source: "tools/imagegen/out/website-v2/website-v2-play-poster.jpg",
    sourceId: "website-v2-play-poster",
  },
  {
    id: "02-fashion-icon",
    name: "潮流造型",
    category: "风格肖像",
    source: "tools/imagegen/out/website-v2/website-v2-ai.jpg",
    sourceId: "website-v2-ai",
  },
  {
    id: "03-four-season-growth",
    name: "四季成长",
    category: "成长记录",
    source: "tools/imagegen/out/website-v2/website-v2-timeline.jpg",
    sourceId: "website-v2-timeline",
  },
];

async function exists(file) {
  return access(file).then(() => true, () => false);
}

await mkdir(outputRoot, { recursive: true });
await mkdir(rawRoot, { recursive: true });
for (const item of existing) {
  const target = path.join(outputRoot, item.id + ".jpg");
  if (!await exists(target)) await copyFile(path.join(root, item.source), target);
}

const config = await loadEnv();
const generated = [];
for (const theme of themes) {
  const rawPath = path.join(rawRoot, theme.id + ".png");
  const outputPath = path.join(outputRoot, theme.id + ".jpg");
  const prompt = shared.concat(theme.prompt).join(". ");
  if (!await exists(rawPath)) {
    const result = await generate(config, { prompt, size: "1024x1024", quality: "high", maxRetries: 2 });
    await writeFile(rawPath, result.buffer);
  }
  const fitted = await fit(await readFile(rawPath), "cover", { anchor: theme.anchor, quality: 90 });
  await writeFile(outputPath, fitted);
  const size = await dimensions(fitted);
  if (!await hasUsableVisualContent(fitted)) throw new Error(theme.id + " 图像内容校验失败");
  generated.push({ ...theme, file: "tools/imagegen/out/pet-workshop-v1/" + theme.id + ".jpg", size, prompt, provider: "lingsuan", model: config.model });
  console.log("完成 " + theme.id);
}

const manifest = {
  version: "v1",
  purpose: "AI 创意工坊第一批 12 个官方主题候选图",
  style: shared,
  existing: existing.map((item) => ({ ...item, file: "tools/imagegen/out/pet-workshop-v1/" + item.id + ".jpg" })),
  generated,
  outputRatio: "4:3",
  generatedAt: new Date().toISOString(),
};
await writeFile(path.join(outputRoot, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
await writeFile(path.join(outputRoot, "prompts.json"), JSON.stringify({ shared, themes }, null, 2) + "\n");

const cells = await Promise.all([...existing, ...themes].map(async (item) => {
  const file = path.join(outputRoot, item.id + ".jpg");
  return sharp(file).resize(400, 300, { fit: "cover" }).toBuffer();
}));
const sheet = sharp({ create: { width: 1600, height: 900, channels: 3, background: "#fffaf5" } });
await sheet.composite(cells.map((input, index) => ({ input, left: (index % 4) * 400, top: Math.floor(index / 4) * 300 }))).jpeg({ quality: 90 }).toFile(path.join(outputRoot, "contact-sheet.jpg"));
console.log("完成 AI 创意工坊第一批素材：" + (existing.length + generated.length) + " 张");
