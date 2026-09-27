import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(root, "apps/platform/package.json"));
const sharp = require("sharp");
const assets = path.join(root, "apps/miniprogram/assets");
const source = path.join(root, "tools/imagegen/out/styles/play-portrait-v4.jpg");
const destination = path.join(assets, "theme-preview.jpg");
await mkdir(assets, { recursive: true });
await writeFile(destination, await sharp(await readFile(source))
  .resize(360, 240, { fit: "cover", position: "attention" })
  .jpeg({ quality: 72, mozjpeg: true }).toBuffer());

const board = path.join(root, "docs/ui-refactor/visual-proposals.html");
let html = await readFile(board, "utf8");
const replacements = {
  "play-id-card.jpg": "../../tools/imagegen/out/plugins/mp26-pet-id-card.jpg",
  "play-poster.jpg": "../../tools/imagegen/out/plugins/mp26-pet-movie-poster-v3.jpg",
  "play-album.jpg": "../../tools/imagegen/out/plugins/mp26-pet-time-album.jpg",
  "play-portrait.jpg": "../../tools/imagegen/out/styles/play-portrait-v4.jpg",
  "play-storybook.jpg": "../../tools/imagegen/out/styles/play-storybook-v3.jpg",
  "play-magazine.jpg": "../../tools/imagegen/out/styles/play-magazine-v4.jpg",
  "style-warm-film.jpg": "../../tools/imagegen/out/styles/style-warm-film-v3.jpg",
  "style-paper-cut.jpg": "../../tools/imagegen/out/styles/style-paper-cut-v3.jpg",
  "style-studio.jpg": "../../tools/imagegen/out/styles/style-studio-v3.jpg",
  "style-fantasy.jpg": "../../tools/imagegen/out/styles/style-fantasy-v3.jpg"
};
for (const [name, replacement] of Object.entries(replacements)) {
  html = html.replaceAll(`../../apps/website/public/assets/${name}`, replacement);
}
await writeFile(board, html);
