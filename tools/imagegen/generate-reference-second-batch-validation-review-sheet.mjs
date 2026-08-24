/** Build a local master/cat/dog comparison sheet without calling an image model. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { relativeToRoot } from "./reference-template-prompts.mjs";
import { secondBatchValidationJobs } from "./reference-second-batch-validation-prompts.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const VALIDATION = path.join(REFERENCE_ROOT, "validation-second-batch");
const OUTPUT = path.join(REFERENCE_ROOT, "second-batch-migration-approval-sheet-v02.png");
const OUTPUT_META = path.join(REFERENCE_ROOT, "second-batch-migration-approval-sheet-v02.json");
const page = { width: 1860, height: 4065 };
const tile = { width: 560, height: 700 };
const columns = [45, 650, 1255];
const headerHeight = 115;
const captionHeight = 55;
const rowGap = 35;

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function caption(text) {
  return Buffer.from(`<svg width="${tile.width}" height="${captionHeight}"><rect width="100%" height="100%" fill="#ffffff"/><text x="14" y="35" font-family="Arial, sans-serif" font-size="19" font-weight="700" fill="#1d2220">${text}</text></svg>`);
}

async function tileImage(file) {
  return sharp(file)
    .resize(tile.width, tile.height, { fit: "contain", background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const grouped = [];
for (const job of secondBatchValidationJobs) {
  let item = grouped.find((entry) => entry.template.id === job.template.id);
  if (!item) {
    item = { template: job.template, jobs: [] };
    grouped.push(item);
  }
  item.jobs.push(job);
}

const composites = [];
const metadata = [];
for (let row = 0; row < grouped.length; row += 1) {
  const item = grouped[row];
  const top = headerHeight + row * (captionHeight + tile.height + rowGap);
  const cat = item.jobs.find((job) => job.variant === "cat");
  const dog = item.jobs.find((job) => job.variant === "dog");
  const entries = [
    ["FROZEN MASTER", item.template.masterPath],
    [`CAT / ${cat.identityId.toUpperCase()}`, path.join(VALIDATION, `${cat.template.id}_${cat.variant}_${cat.identityId}_9x16_${cat.version}.png`)],
    [`DOG / ${dog.identityId.toUpperCase()}`, path.join(VALIDATION, `${dog.template.id}_${dog.variant}_${dog.identityId}_9x16_${dog.version}.png`)]
  ];
  const rowFiles = [];
  for (let column = 0; column < entries.length; column += 1) {
    const [role, file] = entries[column];
    const body = await readFile(file);
    rowFiles.push({ role, path: relativeToRoot(file), sha256: sha256(body) });
    composites.push({ input: caption(`${String(row + 1).padStart(2, "0")} ${item.template.id.toUpperCase()} | ${role}`), left: columns[column], top });
    composites.push({ input: await tileImage(file), left: columns[column], top: top + captionHeight });
  }
  metadata.push({ templateId: item.template.id, files: rowFiles });
}

const header = Buffer.from(`<svg width="${page.width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#1d2925"/><text x="45" y="53" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">SECOND BATCH RUNTIME MIGRATION REVIEW V02</text><text x="45" y="88" font-family="Arial, sans-serif" font-size="18" fill="#cddbd4">Frozen self-owned master  |  Cat identity transfer  |  Dog identity transfer</text></svg>`);
composites.unshift({ input: header, left: 0, top: 0 });

const result = await sharp({ create: { width: page.width, height: page.height, channels: 3, background: "#eef2ef" } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toBuffer();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, result);
await writeFile(OUTPUT_META, `${JSON.stringify({
  purpose: "second-batch-runtime-migration-user-approval",
  generatedBy: "local-sharp-composite",
  modelCall: false,
  runtimeThirdPartyEffectReferenceIncluded: false,
  output: { path: relativeToRoot(OUTPUT), width: page.width, height: page.height, sha256: sha256(result) },
  items: metadata
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(OUTPUT));
console.log(relativeToRoot(OUTPUT_META));
