/** 双主体母版与稳定性结果的本地审批拼版；不调用图片模型。 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  dualMasterBasename,
  dualSubjectJobs,
  ownerReferences,
  relativeToRoot,
  REFERENCE_ROOT,
  ROOT,
  stabilityPets
} from "./dual-subject-prompts.mjs";

const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const DUAL_ROOT = path.join(REFERENCE_ROOT, "dual-subject");
const OUTPUT_ROOT = path.join(DUAL_ROOT, "review");
const tile = { width: 320, height: 460 };
const captionHeight = 52;
const gap = 18;
const margin = 24;

function caption(text) {
  const escaped = text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
  return Buffer.from(`<svg width="${tile.width}" height="${captionHeight}"><rect width="100%" height="100%" fill="#fff"/><text x="10" y="32" font-family="Arial,sans-serif" font-size="16" font-weight="700" fill="#111">${escaped}</text></svg>`);
}

async function thumb(file) {
  return sharp(file).resize(tile.width, tile.height, { fit: "contain", background: "#ededed" }).png().toBuffer();
}

async function sheet(file, entries, columns) {
  const rows = Math.ceil(entries.length / columns);
  const width = margin * 2 + columns * tile.width + (columns - 1) * gap;
  const height = margin * 2 + rows * (tile.height + captionHeight) + (rows - 1) * gap;
  const composites = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index];
    const column = index % columns;
    const row = Math.floor(index / columns);
    const left = margin + column * (tile.width + gap);
    const top = margin + row * (tile.height + captionHeight + gap);
    composites.push({ input: await thumb(entry.path), left, top });
    composites.push({ input: caption(entry.label), left, top: top + tile.height });
  }
  await sharp({ create: { width, height, channels: 3, background: "#d5d5d5" } }).composite(composites).png({ compressionLevel: 9 }).toFile(file);
}

await mkdir(OUTPUT_ROOT, { recursive: true });
const masterEntries = dualSubjectJobs.flatMap((job) => [
  { label: `${job.id} / effect`, path: job.effectReference },
  { label: `${job.id} / ${job.owner.id}`, path: job.owner.path },
  { label: `${job.id} / ${job.pet.id}`, path: job.pet.path },
  { label: `${job.id} / candidate`, path: path.join(DUAL_ROOT, "candidates", `${dualMasterBasename(job)}.png`) }
]);
const masterSheet = path.join(OUTPUT_ROOT, "dual-master-review.png");
await sheet(masterSheet, masterEntries, 4);

const stabilitySheets = [];
for (const job of dualSubjectJobs) {
  const entries = ownerReferences.flatMap((owner) => stabilityPets.map((pet) => ({
    label: `${owner.id} + ${pet.id}`,
    path: path.join(DUAL_ROOT, "stability", job.id, `${job.id}_${owner.id}_${pet.id}_9x16_v01.png`)
  })));
  const output = path.join(OUTPUT_ROOT, `${job.id}-stability-review.png`);
  await sheet(output, entries, 5);
  stabilitySheets.push(relativeToRoot(output));
}

await writeFile(path.join(OUTPUT_ROOT, "index.json"), `${JSON.stringify({
  generatedBy: "local-sharp-composite",
  modelCall: false,
  masterSheet: relativeToRoot(masterSheet),
  stabilitySheets
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(masterSheet));
console.log(stabilitySheets.join("\n"));
