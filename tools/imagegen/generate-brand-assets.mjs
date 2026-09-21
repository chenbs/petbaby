import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { generate, loadEnv } from "./client.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(root, "apps/platform/package.json"));
const sharp = require("sharp");
const output = path.join(root, "tools/imagegen/out/website");
const background = path.join(output, "brand-social-background.png");
const prompt = [
  "Use case: ads-marketing. Create an elegant, warm editorial pet photography background for a Chinese pet memories brand social sharing card.",
  "Landscape composition, approximately 1.9:1. A relaxed black-and-white tuxedo cat beside a small golden retriever, photographed naturally together on the RIGHT half of the image.",
  "Both pets must have complete recognisable faces and anatomically natural bodies. Soft warm daylight, creamy paper backdrop, a subtle blush pink blanket, believable fur detail, affectionate calm mood.",
  "Keep the LEFT half mostly empty with a very light warm ivory background for typography. Avoid any text, lettering, logos, watermarks, borders, grids, human figures or decorative symbols."
].join(" ");

await mkdir(output, { recursive: true });
if (!await access(background).then(() => true, () => false)) {
  const config = await loadEnv();
  const result = await generate(config, { prompt, size: "1536x1024", quality: "high", maxRetries: 1 });
  await writeFile(background, result.buffer);
  await writeFile(path.join(output, "brand-social-background.json"), JSON.stringify({ prompt, provider: "lingsuan", model: config.model, generatedAt: new Date().toISOString() }, null, 2) + "\n");
}

const logo = await sharp(await readFile(path.join(root, "cargo/logo.jpg"))).resize(160, 160, { fit: "cover" }).webp({ quality: 90 }).toBuffer();
await writeFile(path.join(output, "brand-logo.webp"), logo);
const lettering = Buffer.from('<svg width="1200" height="630" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="veil"><stop stop-color="#fff8f2"/><stop offset="0.6" stop-color="#fff8f2" stop-opacity="0.9"/><stop offset="1" stop-color="#fff8f2" stop-opacity="0"/></linearGradient></defs><rect width="760" height="630" fill="url(#veil)"/><g font-family="Microsoft YaHei, Noto Sans CJK SC, sans-serif"><text x="62" y="276" font-size="72" font-weight="700" fill="#312721">麻麻抱我</text><text x="64" y="352" font-size="32" fill="#77544b">把日常，抱进回忆里。</text><text x="64" y="423" font-size="23" fill="#77544b">宠物照片 · 创意作品 · 陪伴记录</text><text x="64" y="558" font-size="20" fill="#77544b">www.babykitty.cn</text><text x="1020" y="605" font-size="16" fill="#312721">AI 生成示意</text></g></svg>');
const social = await sharp(await readFile(background)).resize(1200, 630, { fit: "cover" }).composite([{ input: lettering }, { input: await sharp(logo).resize(92, 92).toBuffer(), left: 64, top: 66 }]).png().toBuffer();
await writeFile(path.join(output, "og-default.png"), social);
for (const directory of ["apps/website/public/assets", "docs/website/prototype/assets"]) {
  const destination = path.join(root, directory);
  await mkdir(destination, { recursive: true });
  for (const filename of ["brand-logo.webp", "og-default.png"]) await copyFile(path.join(output, filename), path.join(destination, filename));
}
console.log("品牌 Logo 与 1200×630 分享图已同步至素材真源、官网和原型目录。");
