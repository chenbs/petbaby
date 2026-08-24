/** Keep every public-preview provenance link aligned with the current frozen master. */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const MASTER_INDEX_PATH = path.join(REFERENCE_ROOT, "masters", "index.json");
const PUBLIC_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

const masterIndex = await readJson(MASTER_INDEX_PATH);
const publicIndex = await readJson(PUBLIC_INDEX_PATH);
const masterByTemplate = new Map(masterIndex.templates.map((item) => [item.templateId, item]));
let updated = 0;
for (const preview of publicIndex.templates) {
  const master = masterByTemplate.get(preview.templateId);
  if (!master) throw new Error(`${preview.templateId} 缺少冻结母版`);
  if (preview.masterSha256 === master.sha256) continue;
  preview.masterSha256 = master.sha256;
  updated += 1;
  if (preview.metadata) {
    const metadataPath = path.resolve(import.meta.dirname, "../..", preview.metadata);
    const metadata = await readJson(metadataPath);
    metadata.masterSha256 = master.sha256;
    metadata.currentFrozenMasterPath = master.path;
    await writeJson(metadataPath, metadata);
  }
  console.log(`已同步 ${preview.templateId} 的冻结母版关联`);
}
publicIndex.updatedAt = "2026-08-20T14:30:00+08:00";
await writeJson(PUBLIC_INDEX_PATH, publicIndex);
console.log(`公开图母版关联同步完成: ${updated} 项`);
