/** 生成第三批剩余待审批项的三列总览；不调用图片模型。用法：node ... --pending-only */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  relativeToRoot,
  thirdBatchBasename,
  thirdBatchJobs
} from "./reference-third-batch-prompts.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const PENDING_ONLY = process.argv.includes("--pending-only");
if (!PENDING_ONLY) throw new Error("v03 是历史审批快照；请使用 --pending-only 生成当前 v04 总览");
const sheetVersion = PENDING_ONLY ? "v04" : "v03";
const OUTPUT = path.join(REFERENCE_ROOT, `third-batch-approval-sheet-${sheetVersion}.png`);
const OUTPUT_META = path.join(REFERENCE_ROOT, `third-batch-approval-sheet-${sheetVersion}.json`);

const tile = { width: 560, height: 700 };
const columns = [45, 650, 1255];
const headerHeight = 115;
const captionHeight = 55;
const rowGap = 35;

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function caption(text) {
  return Buffer.from(`<svg width="${tile.width}" height="${captionHeight}"><rect width="100%" height="100%" fill="#ffffff"/><text x="14" y="35" font-family="Arial, sans-serif" font-size="18" font-weight="700" fill="#1d2220">${text}</text></svg>`);
}

async function tileImage(file) {
  return sharp(file)
    .resize(tile.width, tile.height, { fit: "contain", background: "#ffffff" })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

const composites = [];
const metadata = [];
const records = [];
for (const job of thirdBatchJobs) {
  const basename = thirdBatchBasename(job);
  const candidateMetadata = JSON.parse(await readFile(path.join(REFERENCE_ROOT, "metadata", `${basename}.json`), "utf8"));
  if (!PENDING_ONLY || candidateMetadata.review?.finalApproval === "pending-user") {
    records.push({ job, candidateMetadata, candidate: path.join(CANDIDATES, `${basename}.png`) });
  }
}
if (!records.length) throw new Error("没有符合条件的第三批审批项");

const page = {
  width: 1860,
  height: headerHeight + records.length * (captionHeight + tile.height + rowGap) + 60
};
for (let row = 0; row < records.length; row += 1) {
  const { job, candidateMetadata, candidate } = records[row];
  const top = headerHeight + row * (captionHeight + tile.height + rowGap);
  const identityReference = job.identityReference || job.pet.path;
  const supportingReference = job.editGuide || identityReference;
  const entries = [
    ["EFFECT REFERENCE", job.effectReference],
    [job.editGuide
      ? "SELF-OWNED PUPIL TONE TARGET GUIDE"
      : job.identityReference
        ? `DERIVED PET IDENTITY GUIDE / ${job.subjectId.toUpperCase()}`
        : `PET IDENTITY / ${job.subjectId.toUpperCase()}`, supportingReference],
    [candidateMetadata.review?.finalApproval === "approved"
      ? `APPROVED MASTER ${job.version.toUpperCase()}`
      : `CANDIDATE ${job.version.toUpperCase()}`, candidate]
  ];
  const files = [];
  for (let column = 0; column < entries.length; column += 1) {
    const [role, file] = entries[column];
    const body = await readFile(file);
    files.push({ role, path: relativeToRoot(file), sha256: sha256(body) });
    composites.push({ input: caption(`${String(row + 1).padStart(2, "0")} ${job.id.toUpperCase()} | ${role}`), left: columns[column], top });
    composites.push({ input: await tileImage(file), left: columns[column], top: top + captionHeight });
  }
  metadata.push({
    templateId: job.id,
    title: job.title,
    version: job.version,
    reviewState: candidateMetadata.review?.state,
    finalApproval: candidateMetadata.review?.finalApproval,
    findings: candidateMetadata.review?.findings || [],
    files
  });
}

const header = Buffer.from(`<svg width="${page.width}" height="${headerHeight}"><rect width="100%" height="100%" fill="#1d2925"/><text x="45" y="53" font-family="Arial, sans-serif" font-size="30" font-weight="700" fill="#ffffff">THIRD BATCH PENDING MASTER REVIEW ${sheetVersion.toUpperCase()}</text><text x="45" y="88" font-family="Arial, sans-serif" font-size="18" fill="#cddbd4">Third-party effect reference  |  Self-owned pet identity  |  Lingsuan candidate pending user approval</text></svg>`);
composites.unshift({ input: header, left: 0, top: 0 });

const result = await sharp({ create: { width: page.width, height: page.height, channels: 3, background: "#eef2ef" } })
  .composite(composites)
  .png({ compressionLevel: 9 })
  .toBuffer();
await mkdir(path.dirname(OUTPUT), { recursive: true });
await writeFile(OUTPUT, result);
await writeFile(OUTPUT_META, `${JSON.stringify({
  purpose: PENDING_ONLY
    ? "third-batch-remaining-master-candidate-user-approval"
    : "third-batch-master-candidate-user-approval",
  filter: PENDING_ONLY ? "pending-user-only" : "all-third-batch-items",
  generatedBy: "local-sharp-composite",
  modelCall: false,
  runtimeThirdPartyEffectReferenceIncluded: false,
  output: { path: relativeToRoot(OUTPUT), width: page.width, height: page.height, sha256: sha256(result) },
  items: metadata
}, null, 2)}\n`, "utf8");
console.log(relativeToRoot(OUTPUT));
console.log(relativeToRoot(OUTPUT_META));
