/** Build a local visual approval sheet; this does not call an image model. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const require = (await import("node:module")).createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const OUTPUT = path.join(REFERENCE_ROOT, "second-batch-approval-sheet-v02.png");
const OUTPUT_META = path.join(REFERENCE_ROOT, "second-batch-approval-sheet-v02.json");

const items = [
  {
    id: "landmark-adventure",
    label: "LANDMARK ADVENTURE / ABYSSINIAN CAT",
    effect: path.join(ROOT, "apps/website/public/assets/example/1786368804360.png"),
    identity: path.join(ROOT, "apps/website/public/assets/avatar-abyssinian.jpg"),
    candidate: path.join(CANDIDATES, "landmark-adventure_abyssinian-cat_9x16_v01.png"),
    version: "v01"
  },
  {
    id: "dessert-shopkeeper",
    label: "DESSERT SHOPKEEPER / TOY POODLE",
    effect: path.join(ROOT, "apps/website/public/assets/example/1786367409484.png"),
    identity: path.join(ROOT, "apps/website/public/assets/avatar-poodle.jpg"),
    candidate: path.join(CANDIDATES, "dessert-shopkeeper_toy-poodle_9x16_v02.png"),
    version: "v02"
  },
  {
    id: "pet-runway",
    label: "PET RUNWAY / MAINE COON",
    effect: path.join(ROOT, "apps/website/public/assets/example/1786368555480.png"),
    identity: path.join(ROOT, "apps/website/public/assets/work-maine.jpg"),
    candidate: path.join(CANDIDATES, "pet-runway_maine-coon-cat_9x16_v04.png"),
    version: "v04"
  }
];

const page = { width: 1860, height: 2520 };
const tile = { width: 560, height: 700 };
const marginX = 45;
const gapX = 45;
const headerHeight = 115;
const rowHeaderHeight = 55;
const rowGap = 45;
const columnX = [marginX, marginX + tile.width + gapX, marginX + 2 * (tile.width + gapX)];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function captionSvg(text, fill = "#ffffff") {
  return Buffer.from(`<svg width="${tile.width}" height="${rowHeaderHeight}"><rect width="100%" height="100%" fill="${fill}"/><text x="14" y="35" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1d2220">${text}</text></svg>`);
}

async function tileImage(file) {
  return sharp(file)
    .resize(tile.width, tile.height, { fit: "contain", background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const composites = [];
const sheetMetadata = [];
for (let row = 0; row < items.length; row += 1) {
  const item = items[row];
  const top = headerHeight + row * (rowHeaderHeight + tile.height + rowGap);
  const inputs = [
    ["EFFECT REFERENCE", item.effect],
    ["PET IDENTITY", item.identity],
    [`CANDIDATE ${item.version}`, item.candidate]
  ];
  const files = [];
  for (let column = 0; column < inputs.length; column += 1) {
    const [role, file] = inputs[column];
    const body = await readFile(file);
    files.push({ role, path: path.relative(ROOT, file).replaceAll("\\", "/"), sha256: sha256(body) });
    composites.push({ input: captionSvg(`${item.label}  |  ${role}`), left: columnX[column], top });
    composites.push({ input: await tileImage(file), left: columnX[column], top: top + rowHeaderHeight });
  }
  sheetMetadata.push({ id: item.id, version: item.version, files });
}

const header = Buffer.from(`<svg width="${page.width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#1d2925"/><text x="45" y="53" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">SECOND BATCH APPROVAL SHEET</text><text x="45" y="88" font-family="Arial, sans-serif" font-size="18" fill="#cddbd4">Effect reference  |  Pet identity  |  Current candidate</text></svg>`);
composites.unshift({ input: header, left: 0, top: 0 });

const result = await sharp({ create: { width: page.width, height: page.height, channels: 3, background: "#eef2ef" } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toBuffer();

await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, result);
await writeFile(OUTPUT_META, `${JSON.stringify({
  purpose: "second-batch-user-approval-sheet",
  generatedBy: "local-sharp-composite",
  modelCall: false,
  output: { path: path.relative(ROOT, OUTPUT).replaceAll("\\", "/"), width: page.width, height: page.height, sha256: sha256(result) },
  items: sheetMetadata
}, null, 2)}\n`, "utf8");

console.log(path.relative(ROOT, OUTPUT));
console.log(path.relative(ROOT, OUTPUT_META));
