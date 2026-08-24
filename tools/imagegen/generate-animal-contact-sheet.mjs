/** Generate a local index for the 24 animal effect references; no model call. */
import { mkdir, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createRequire } from "node:module";

const ROOT = path.resolve(import.meta.dirname, "../..");
const INPUT_ROOT = path.join(ROOT, "apps", "website", "public", "assets", "example", "animal");
const OUTPUT_ROOT = path.join(ROOT, "tools", "imagegen", "out", "reference-v1", "animal");
const require = createRequire(path.join(ROOT, "apps", "platform", "package.json"));
const sharp = require("sharp");

const TILE = { width: 300, height: 330 };
const CAPTION = 72;
const GAP = 18;
const MARGIN = 24;
const COLUMNS = 4;

function escapeXml(value) {
  return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
}

const files = (await readdir(INPUT_ROOT, { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(png|jpe?g|webp)$/i.test(entry.name))
  .map((entry) => entry.name)
  .sort((a, b) => a.localeCompare(b, "zh", { numeric: true }));

await mkdir(OUTPUT_ROOT, { recursive: true });
const rows = [];
const cards = [];
for (let index = 0; index < files.length; index += 1) {
  const file = files[index];
  const source = path.join(INPUT_ROOT, file);
  const metadata = await sharp(source).metadata();
  rows.push({ index: index + 1, file, width: metadata.width, height: metadata.height });
  const caption = Buffer.from(`<svg width="${TILE.width}" height="${CAPTION}" xmlns="http://www.w3.org/2000/svg"><rect width="100%" height="100%" fill="#16202a"/><text x="10" y="24" fill="#fff" font-size="13" font-family="Arial, Microsoft YaHei, sans-serif">${index + 1}. ${escapeXml(file.slice(0, 31))}</text><text x="10" y="46" fill="#b9c6d2" font-size="11" font-family="Arial, sans-serif">${metadata.width}x${metadata.height}</text><text x="10" y="64" fill="#8fa5b5" font-size="10" font-family="Arial, sans-serif">animal effect reference</text></svg>`);
  const image = await sharp(source).resize(TILE.width - 12, TILE.height - CAPTION - 12, { fit: "contain", background: "#f6f8fa" }).extend({ top: 6, bottom: 6, left: 6, right: 6, background: "#f6f8fa" }).png().toBuffer();
  cards.push({ image, caption });
}

const rowsPerPage = Math.ceil(cards.length / COLUMNS);
const width = MARGIN * 2 + COLUMNS * TILE.width + (COLUMNS - 1) * GAP;
const height = MARGIN * 2 + rowsPerPage * (TILE.height + CAPTION) + (rowsPerPage - 1) * GAP;
const composites = [];
for (let index = 0; index < cards.length; index += 1) {
  const left = MARGIN + (index % COLUMNS) * (TILE.width + GAP);
  const top = MARGIN + Math.floor(index / COLUMNS) * (TILE.height + CAPTION + GAP);
  composites.push({ input: cards[index].image, left, top });
  composites.push({ input: cards[index].caption, left, top: top + TILE.height });
}
const output = path.join(OUTPUT_ROOT, "contact-sheet.png");
await sharp({ create: { width, height, channels: 4, background: "#e8edf1" } }).composite(composites).png().toFile(output);
await writeFile(path.join(OUTPUT_ROOT, "contact-sheet.json"), `${JSON.stringify({ count: rows.length, files: rows }, null, 2)}\n`, "utf8");
console.log(path.relative(ROOT, output));
