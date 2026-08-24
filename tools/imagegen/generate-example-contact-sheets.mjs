/** 生成 65 张效果参考图的分页索引；仅本地拼版，不调用图片模型。 */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EXAMPLE_ROOT = path.join(ROOT, "apps/website/public/assets/example");
const OUTPUT_ROOT = path.join(ROOT, ".tmp/example-contact-sheets");
const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");

const PAGE_SIZE = 16;
const tile = { width: 320, height: 320 };
const captionHeight = 54;
const gap = 18;
const margin = 24;

function caption(name) {
  const escaped = name.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return Buffer.from(`<svg width="${tile.width}" height="${captionHeight}"><rect width="100%" height="100%" fill="#ffffff"/><text x="10" y="33" font-family="Arial, sans-serif" font-size="17" font-weight="700" fill="#111111">${escaped}</text></svg>`);
}

const files = (await readdir(EXAMPLE_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));

await mkdir(OUTPUT_ROOT, { recursive: true });

for (let pageIndex = 0; pageIndex < Math.ceil(files.length / PAGE_SIZE); pageIndex += 1) {
  const pageFiles = files.slice(pageIndex * PAGE_SIZE, (pageIndex + 1) * PAGE_SIZE);
  const columns = 4;
  const rows = Math.ceil(pageFiles.length / columns);
  const width = margin * 2 + columns * tile.width + (columns - 1) * gap;
  const height = margin * 2 + rows * (tile.height + captionHeight) + (rows - 1) * gap;
  const composites = [];

  for (let index = 0; index < pageFiles.length; index += 1) {
    const file = pageFiles[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (tile.width + gap);
    const top = margin + row * (tile.height + captionHeight + gap);
    composites.push({
      input: await sharp(path.join(EXAMPLE_ROOT, file))
        .resize(tile.width, tile.height, { fit: "contain", background: "#e9e9e9" })
        .png()
        .toBuffer(),
      left,
      top
    });
    composites.push({ input: caption(file), left, top: top + tile.height });
  }

  const output = path.join(OUTPUT_ROOT, `page-${String(pageIndex + 1).padStart(2, "0")}.png`);
  await sharp({ create: { width, height, channels: 3, background: "#d8d8d8" } })
    .composite(composites)
    .png({ compressionLevel: 9 })
    .toFile(output);
  console.log(path.relative(ROOT, output));
}

await writeFile(path.join(OUTPUT_ROOT, "index.json"), `${JSON.stringify({ count: files.length, files }, null, 2)}\n`, "utf8");
