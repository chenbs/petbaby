import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const assets = path.resolve(import.meta.dirname, "../public/assets");
const sourceDir = path.resolve(import.meta.dirname, "../src");
const sourceFiles = (await readdir(sourceDir, { recursive: true }))
  .filter((name) => /\.(astro|css|js|ts|md)$/.test(name));
const sourceText = (await Promise.all(sourceFiles.map((name) => readFile(path.join(sourceDir, name), "utf8")))).join("\n");
const names = (await readdir(assets)).filter((name) =>
  /^(work-|style-|play-|hero-|website-v2-).+\.jpg$/.test(name)
  && sourceText.includes(`/assets/${name}`));
for (const name of names) {
  const sourcePath = path.join(assets, name);
  for (const width of [160, 320, 640, 960]) {
    const output = path.join(assets, name.replace(/\.jpg$/, `-${width}.webp`));
    await sharp(sourcePath).resize({ width, withoutEnlargement: true }).webp({ quality: 78 }).toFile(output);
  }
}
console.log(`已准备 ${names.length} 张图片的响应式资源。`);
