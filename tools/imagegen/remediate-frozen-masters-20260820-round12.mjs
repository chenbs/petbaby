/** Regenerate 59/63/64 from their original effect references, never frozen masters. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildExpansionPrompt,
  expansionJobs,
  expansionOutputSpecs,
  relativeToRoot,
} from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");
const RUN_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "remediation-20260820-round12");
const CANDIDATE_ROOT = path.join(RUN_ROOT, "master-candidates");
const RAW_ROOT = path.join(RUN_ROOT, "raw");
const METADATA_ROOT = path.join(RUN_ROOT, "metadata");
const TEMP_ROOT = path.join(ROOT, ".tmp", "remediation-20260820-round12-inputs");
const target = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const targetIds = ["action-giant-companion", "character-snow-leopard", "character-white-tiger"];
if (target !== "all" && !targetIds.includes(target)) throw new Error(`未知返工模板: ${target}`);

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function prepareInput(source, label) {
  const output = path.join(TEMP_ROOT, `${label}.jpg`);
  const body = await sharp(source, { failOn: "error" })
    .rotate()
    .resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#ffffff" })
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  if (body.byteLength >= 512 * 1024) throw new Error(`${label} 压缩后仍有 ${body.byteLength} bytes`);
  await writeFile(output, body);
  return { path: output, body };
}

async function runJob(config, job) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const candidate = path.join(CANDIDATE_ROOT, `${base}.png`);
  const raw = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  if (!FORCE && await exists(candidate) && await exists(metadataPath)) {
    console.log(`跳过 ${job.templateId}: 已存在`);
    return;
  }

  const effect = await prepareInput(job.effectReferencePath, `${job.templateId}-original-effect`);
  const identity = await prepareInput(job.identity.path, `${job.templateId}-identity`);
  const requestBytes = effect.body.byteLength + identity.body.byteLength;
  if (requestBytes >= 1024 * 1024) throw new Error(`${job.templateId} 输入合计超过 1MB`);
  const prompt = [
    buildExpansionPrompt(job),
    "Input audit: Image 1 is the untouched original effect reference and Image 2 is the self-owned pet identity reference.",
    "No frozen master, public preview, generated candidate, contact sheet or comparison sheet is present in this request.",
  ].join(" ");
  console.log(`开始 ${job.templateId} (${requestBytes} input bytes)`);
  const result = await edit(config, {
    imagePaths: [effect.path, identity.path],
    prompt,
    size: spec.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high",
    maxRetries: 1,
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.templateId} 返回空图`);
  const final = await fit(result.buffer, job.orientation, { anchor: 0.5, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== spec.width || actual.height !== spec.height) {
    throw new Error(`${job.templateId} 尺寸错误: ${actual.width}x${actual.height}`);
  }
  await writeFile(raw, result.buffer);
  await writeFile(candidate, final);
  await writeJson(metadataPath, {
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    version: job.version,
    status: "replacement-master-candidate-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    sourceEffectFile: relativeToRoot(job.effectReferencePath),
    inputs: [
      { role: "one-time-original-third-party-effect-reference", path: relativeToRoot(job.effectReferencePath), sha256: sha256(await readFile(job.effectReferencePath)), requestPath: relativeToRoot(effect.path), requestBytes: effect.body.byteLength },
      { role: "self-owned-pet-identity-reference", identityId: job.identityId, path: relativeToRoot(job.identity.path), sha256: sha256(await readFile(job.identity.path)), requestPath: relativeToRoot(identity.path), requestBytes: identity.body.byteLength },
    ],
    forbiddenInputsVerifiedAbsent: ["frozen-master", "public-preview", "previous-candidate", "comparison-sheet", "contact-sheet"],
    inputPolicy: { serial: true, maxImages: 2, maxLongestEdge: 1200, jpegQuality: 82, combinedBytesBelow: 1048576 },
    orientation: job.orientation,
    requestedSize: spec.size,
    outputSize: `${actual.width}x${actual.height}`,
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    output: { path: relativeToRoot(candidate), rawPath: relativeToRoot(raw), sha256: sha256(final) },
    review: { state: "pending-user-review", finalApproval: "pending-user", findings: [] },
    generatedAt: new Date().toISOString(),
  });
  console.log(`完成 ${job.templateId}`);
}

await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true }),
  mkdir(TEMP_ROOT, { recursive: true }),
]);
const config = await loadEnv();
if (config.concurrency !== 1) throw new Error(`本批次必须串行，当前并发为 ${config.concurrency}`);
const selected = target === "all" ? targetIds : [target];
for (const templateId of selected) {
  const job = expansionJobs.find((item) => item.templateId === templateId);
  if (!job) throw new Error(`缺少模板 ${templateId}`);
  await runJob(config, job);
}
await writeJson(path.join(RUN_ROOT, "index.json"), {
  status: "pending-user-review",
  provider: "lingsuan",
  generatedAt: new Date().toISOString(),
  templateIds: selected,
  sourcePolicy: "original-effect-reference-plus-self-owned-pet-identity-only",
  forbiddenInputs: ["frozen-master", "public-preview", "previous-candidate", "comparison-sheet", "contact-sheet"],
});
console.log("第 12 轮冻结母版返工生成完成");
