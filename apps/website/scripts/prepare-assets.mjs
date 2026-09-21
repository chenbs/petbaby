import { readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const assets = path.resolve(import.meta.dirname, "../public/assets");
const names = (await readdir(assets)).filter((name) => /^(work-|style-|play-|hero-|detail-).+\.jpg$/.test(name));
for (const name of names) {
  const source = path.join(assets, name);
  const metadata = await sharp(source).metadata();
  for (const width of [160, 320, 640, 960, 1440].filter((width) => width <= metadata.width)) {
    const output = path.join(assets, name.replace(/\.jpg$/, `-${width}.webp`));
    await sharp(source).resize({ width, withoutEnlargement: true }).webp({ quality: 84 }).toFile(output);
  }
}
console.log(`已准备 ${names.length} 张图片的响应式资源。`);
