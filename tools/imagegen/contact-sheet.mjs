/**
 * 本地审图拼版：node tools/imagegen/contact-sheet.mjs <输出.jpg> <图1> <图2> ...
 * 只用于人工目检，产物不进版本控制、不作为任何生成输入。
 */
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const sharp = require(require.resolve("sharp", { paths: [path.join(root, "apps/platform")] }));
const [target, ...files] = process.argv.slice(2);
if (!target || !files.length) throw new Error("用法：contact-sheet.mjs <输出.jpg> <图...>");
const columns = Math.min(5, files.length);
const width = 300;
const height = 400;
const label = 28;
const rows = Math.ceil(files.length / columns);
const tiles = await Promise.all(files.map(async (file, index) => {
  const body = await sharp(file).resize(width, height, { fit: "contain", background: "#222" }).jpeg().toBuffer();
  const name = path.basename(file).replace(/\.(jpg|webp)$/, "").slice(0, 34);
  const text = Buffer.from(`<svg width="${width}" height="${label}"><rect width="100%" height="100%" fill="#111"/><text x="6" y="19" font-size="15" fill="#fff" font-family="sans-serif">${name}</text></svg>`);
  return [
    { input: body, left: (index % columns) * width, top: Math.floor(index / columns) * (height + label) },
    { input: text, left: (index % columns) * width, top: Math.floor(index / columns) * (height + label) + height },
  ];
}));
await sharp({ create: { width: columns * width, height: rows * (height + label), channels: 3, background: "#000" } })
  .composite(tiles.flat()).jpeg({ quality: 80 }).toFile(target);
console.log(target);
