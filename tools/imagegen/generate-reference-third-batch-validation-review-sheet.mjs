/** Build a local frozen-master/cat/dog review sheet without any model call. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { relativeToRoot } from "./reference-template-prompts.mjs";
import { thirdBatchValidationJobs } from "./reference-third-batch-validation-prompts.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const VALIDATION_ROOT = path.join(REFERENCE_ROOT, "validation-third-batch");
const OUTPUT = path.join(REFERENCE_ROOT, "third-batch-migration-approval-sheet-v01.png");
const OUTPUT_META = path.join(REFERENCE_ROOT, "third-batch-migration-approval-sheet-v01.json");
const page = { width: 1860, height: 5650 };
const tile = { width: 560, height: 700 };
const columns = [45, 650, 1255];
const headerHeight = 115;
const captionHeight = 55;
const rowGap = 35;

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function caption(value) {
  return Buffer.from(`<svg width="${tile.width}" height="${captionHeight}"><rect width="100%" height="100%" fill="#ffffff"/><text x="14" y="35" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#1d2220">${value}</text></svg>`);
}

async function tileImage(file) {
  return sharp(file)
    .resize(tile.width, tile.height, { fit: "contain", background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

function missingTile() {
  return Buffer.from(`<svg width="${tile.width}" height="${tile.height}"><rect width="100%" height="100%" fill="#e5e7e6"/><rect x="24" y="24" width="512" height="652" fill="none" stroke="#a9afac" stroke-width="3" stroke-dasharray="12 10"/><text x="280" y="330" text-anchor="middle" font-family="Arial, sans-serif" font-size="25" font-weight="700" fill="#5d6561">UPSTREAM 524</text><text x="280" y="370" text-anchor="middle" font-family="Arial, sans-serif" font-size="18" fill="#727a76">OUTPUT NOT GENERATED</text></svg>`);
}

const grouped = [];
for (const job of thirdBatchValidationJobs) {
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
    { role: "FROZEN MASTER", file: item.template.masterPath, master: true },
    { role: `CAT / ${cat.identityId.toUpperCase()}`, file: path.join(VALIDATION_ROOT, `${cat.template.id}_${cat.variant}_${cat.identityId}_9x16_${cat.version}.png`) },
    { role: `DOG / ${dog.identityId.toUpperCase()}`, file: path.join(VALIDATION_ROOT, `${dog.template.id}_${dog.variant}_${dog.identityId}_9x16_${dog.version}.png`) }
  ];
  const rowFiles = [];
  for (let column = 0; column < entries.length; column += 1) {
    const { role, file, master = false } = entries[column];
    const available = await exists(file);
    const body = available ? await readFile(file) : null;
    let status = "missing-upstream-524";
    if (available && master) status = "approved-frozen-master";
    if (available && !master) {
      const metadataPath = path.join(VALIDATION_ROOT, "metadata", `${path.basename(file, ".png")}.json`);
      status = JSON.parse(await readFile(metadataPath, "utf8")).status;
    }
    rowFiles.push(available
      ? { role, path: relativeToRoot(file), sha256: sha256(body), status }
      : { role, path: relativeToRoot(file), status });
    composites.push({ input: caption(`${String(row + 1).padStart(2, "0")} ${item.template.id.toUpperCase()} | ${role}`), left: columns[column], top });
    composites.push({ input: available ? await tileImage(file) : missingTile(), left: columns[column], top: top + captionHeight });
  }
  metadata.push({ templateId: item.template.id, files: rowFiles });
}

const header = Buffer.from(`<svg width="${page.width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#1d2925"/><text x="45" y="53" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">THIRD BATCH RUNTIME MIGRATION REVIEW V01</text><text x="45" y="88" font-family="Arial, sans-serif" font-size="18" fill="#cddbd4">Frozen self-owned master  |  Cat identity transfer  |  Dog identity transfer</text></svg>`);
composites.unshift({ input: header, left: 0, top: 0 });

const result = await sharp({ create: { width: page.width, height: page.height, channels: 3, background: "#eef2ef" } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toBuffer();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, result);
await writeFile(OUTPUT_META, `${JSON.stringify({
  purpose: "third-batch-runtime-migration-user-approval",
  generatedBy: "local-sharp-composite",
  modelCall: false,
  runtimeThirdPartyEffectReferenceIncluded: false,
  output: { path: relativeToRoot(OUTPUT), width: page.width, height: page.height, sha256: sha256(result) },
  items: metadata
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(OUTPUT));
console.log(relativeToRoot(OUTPUT_META));
