/**
 * 使用 lingsuan 图生图验证冻结母版的猫/狗迁移，并生成表情九宫格母版。
 *
 * 用法：
 *   node tools/imagegen/generate-reference-validation.mjs all
 *   node tools/imagegen/generate-reference-validation.mjs migrations
 *   node tools/imagegen/generate-reference-validation.mjs expression-grid
 *   node tools/imagegen/generate-reference-validation.mjs <job-id>
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildMigrationPrompt,
  expressionGridJob,
  migrationJobs,
  outputSpecs,
  relativeToRoot
} from "./reference-template-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const VALIDATION = path.join(REFERENCE_ROOT, "validation");
const VALIDATION_RAW = path.join(VALIDATION, "raw");
const VALIDATION_META = path.join(VALIDATION, "metadata");
const MASTERS = path.join(REFERENCE_ROOT, "masters");
const MASTER_RAW = path.join(MASTERS, "raw");
const MASTER_META = path.join(MASTERS, "metadata");
const TARGET = process.argv[2] || "all";
const FORCE = process.argv.includes("--force");
const CONCURRENCY = Math.max(1, Math.min(20, Number(process.env.REFERENCE_VALIDATION_CONCURRENCY || 1)));

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function hashFile(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function isValidExistingOutput(file, output) {
  if (!await exists(file)) return false;
  try {
    const body = await readFile(file);
    const actual = await dimensions(body);
    return actual.width === output.width
      && actual.height === output.height
      && await hasUsableVisualContent(body);
  } catch {
    return false;
  }
}

async function verifyFrozenMasters(jobs) {
  const index = JSON.parse(await readFile(path.join(MASTERS, "index.json"), "utf8"));
  if (index.status !== "approved-frozen-master-set") {
    throw new Error("冻结母版索引状态无效");
  }
  const byId = new Map(index.templates.map((item) => [item.templateId, item]));
  for (const job of jobs) {
    const item = byId.get(job.template.id);
    if (!item) throw new Error(`冻结母版索引缺少 ${job.template.id}`);
    if (item.path !== relativeToRoot(job.template.masterPath)) {
      throw new Error(`冻结母版路径不匹配 ${job.template.id}`);
    }
    const actualHash = await hashFile(job.template.masterPath);
    if (actualHash !== item.sha256) {
      throw new Error(`冻结母版哈希不匹配 ${job.template.id}`);
    }
  }
}

async function generateMigration(config, job) {
  const output = outputSpecs[job.template.orientation];
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_${output.ratio}_${job.version}`;
  const finalPath = path.join(VALIDATION, `${basename}.png`);
  if (!FORCE && await isValidExistingOutput(finalPath, output)) {
    console.log(`跳过 ${job.id}：验证图已存在`);
    return;
  }

  const prompt = buildMigrationPrompt(job);
  const imagePaths = [job.template.masterPath, job.pet.path];
  console.log(`生成迁移 ${job.id}...`);
  const result = await edit(config, {
    imagePaths,
    prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  if (!await hasUsableVisualContent(result.buffer)) {
    throw new Error(`lingsuan 返回无有效视觉内容：${job.id}`);
  }
  const rawPath = path.join(VALIDATION_RAW, `${basename}.png`);
  const final = await fit(result.buffer, job.template.orientation, { anchor: job.template.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`输出尺寸错误 ${actual.width}x${actual.height}，要求 ${output.size}`);
  }
  const inputHashes = await Promise.all(imagePaths.map(hashFile));
  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  const outputSha256 = createHash("sha256").update(final).digest("hex");
  await writeFile(path.join(VALIDATION_META, `${basename}.json`), `${JSON.stringify({
    jobId: job.id,
    templateId: job.template.id,
    status: "generated-pending-joint-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    sourceMaster: {
      role: "self-owned-frozen-master",
      path: relativeToRoot(job.template.masterPath),
      sha256: inputHashes[0]
    },
    petIdentityReference: {
      role: "new-pet-identity-reference",
      identityId: job.identityId,
      species: job.pet.species,
      breed: job.pet.breed,
      path: relativeToRoot(job.pet.path),
      sha256: inputHashes[1]
    },
    runtimeThirdPartyEffectReferenceIncluded: false,
    inputFidelity: "high",
    orientation: job.template.orientation,
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    output: { path: relativeToRoot(finalPath), sha256: outputSha256 },
    quality: "high",
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    review: {
      state: "pending-human-review",
      checks: {
        petIdentity: null,
        cuteness: null,
        masterComposition: null,
        anatomy: null,
        text: null,
        dimensions: "pass"
      },
      findings: []
    },
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`完成迁移 ${relativeToRoot(finalPath)}`);
}

async function generateExpressionGrid(config) {
  const job = expressionGridJob;
  const output = outputSpecs[job.orientation];
  const finalPath = path.join(MASTERS, job.outputName);
  if (!FORCE && await isValidExistingOutput(finalPath, output)) {
    console.log("跳过 expression-grid：母版已存在");
    return;
  }

  const imagePaths = [job.effectReferencePath, job.pet.path];
  console.log("生成表情九宫格母版...");
  const result = await edit(config, {
    imagePaths,
    prompt: job.prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  if (!await hasUsableVisualContent(result.buffer)) {
    throw new Error("lingsuan 返回无有效视觉内容：expression-grid");
  }
  const rawPath = path.join(MASTER_RAW, job.outputName);
  const final = await fit(result.buffer, job.orientation, { anchor: job.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`表情九宫格输出尺寸错误 ${actual.width}x${actual.height}，要求 ${output.size}`);
  }
  const inputHashes = await Promise.all(imagePaths.map(hashFile));
  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  const outputSha256 = createHash("sha256").update(final).digest("hex");
  await writeFile(path.join(MASTER_META, `${path.parse(job.outputName).name}.json`), `${JSON.stringify({
    templateId: job.templateId,
    status: "master-candidate-pending-joint-approval",
    category: job.title,
    subject: "cream-longhair-cat",
    breed: job.pet.breed,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "third-party-effect-reference-internal-master-production-only", path: relativeToRoot(imagePaths[0]), sha256: inputHashes[0] },
      { role: "pet-identity-reference", path: relativeToRoot(imagePaths[1]), sha256: inputHashes[1] }
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    inputFidelity: "high",
    orientation: job.orientation,
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    output: { path: relativeToRoot(finalPath), sha256: outputSha256 },
    quality: "high",
    prompt: job.prompt,
    revisedPrompt: result.revisedPrompt || null,
    review: {
      state: "pending-human-review",
      checks: {
        samePetAcrossNineCells: null,
        nineDistinctExpressions: null,
        cuteness: null,
        anatomy: null,
        noText: null,
        dimensions: "pass"
      },
      findings: []
    },
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`完成九宫格 ${relativeToRoot(finalPath)}`);
}

if (!["all", "migrations", "expression-grid"].includes(TARGET) && !migrationJobs.some((job) => job.id === TARGET)) {
  throw new Error(`未知任务 ${TARGET}`);
}

await Promise.all([
  mkdir(VALIDATION, { recursive: true }),
  mkdir(VALIDATION_RAW, { recursive: true }),
  mkdir(VALIDATION_META, { recursive: true }),
  mkdir(MASTERS, { recursive: true }),
  mkdir(MASTER_RAW, { recursive: true }),
  mkdir(MASTER_META, { recursive: true })
]);

const config = await loadEnv();
if (TARGET === "all" || TARGET === "expression-grid") await generateExpressionGrid(config);

const selected = TARGET === "all" || TARGET === "migrations"
  ? migrationJobs
  : migrationJobs.filter((job) => job.id === TARGET);

if (selected.length) await verifyFrozenMasters(selected);

let cursor = 0;
const workers = Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
  while (cursor < selected.length) {
    const index = cursor;
    cursor += 1;
    await generateMigration(config, selected[index]);
  }
});
await Promise.all(workers);
