/** Generate cat/dog runtime migrations for the five active second-batch masters. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { outputSpecs, relativeToRoot } from "./reference-template-prompts.mjs";
import {
  buildSecondBatchValidationPrompt,
  secondBatchValidationJobs
} from "./reference-second-batch-validation-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-second-batch");
const RAW = path.join(OUTPUT_ROOT, "raw");
const META = path.join(OUTPUT_ROOT, "metadata");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const TARGET = process.argv.find((item, index) => index > 1 && !item.startsWith("--")) || "all";
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

async function validExisting(file) {
  if (!await exists(file)) return false;
  const body = await readFile(file);
  const actual = await dimensions(body);
  return actual.width === 720 && actual.height === 1280 && await hasUsableVisualContent(body);
}

async function verifyInputs(jobs) {
  const index = JSON.parse(await readFile(INDEX, "utf8"));
  const frozen = new Map(index.templates.map((item) => [item.templateId, item]));
  for (const job of jobs) {
    const entry = frozen.get(job.template.id);
    if (!entry) throw new Error(`冻结索引缺少 ${job.template.id}`);
    if (entry.path !== relativeToRoot(job.template.masterPath)) throw new Error(`母版路径不匹配 ${job.template.id}`);
    if (entry.sha256 !== await hashFile(job.template.masterPath)) throw new Error(`母版哈希不匹配 ${job.template.id}`);
    await access(job.pet.path);
  }
}

async function generateJob(config, job) {
  const output = outputSpecs.portrait;
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_${output.ratio}_${job.version}`;
  const finalPath = path.join(OUTPUT_ROOT, `${basename}.png`);
  const rawPath = path.join(RAW, `${basename}.png`);
  const metadataPath = path.join(META, `${basename}.json`);
  if (!FORCE && await validExisting(finalPath) && await exists(metadataPath)) {
    console.log(`跳过 ${job.id}：有效验证图已存在`);
    return;
  }

  const imagePaths = [job.template.masterPath, job.pet.path];
  const inputHashes = await Promise.all(imagePaths.map(hashFile));
  const prompt = buildSecondBatchValidationPrompt(job);
  console.log(`开始 ${job.id}`);
  const result = await edit(config, {
    imagePaths,
    prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.id}: lingsuan 返回无有效画面`);

  const final = await fit(result.buffer, "portrait", { anchor: job.template.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`${job.id}: 输出尺寸 ${actual.width}x${actual.height}`);
  }
  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  const outputHash = createHash("sha256").update(final).digest("hex");
  await writeFile(metadataPath, `${JSON.stringify({
    jobId: job.id,
    templateId: job.template.id,
    title: job.template.title,
    status: "generated-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "self-owned-frozen-master", path: relativeToRoot(imagePaths[0]), sha256: inputHashes[0] },
      {
        role: "new-pet-identity-reference",
        identityId: job.identityId,
        species: job.pet.species,
        breed: job.pet.breed,
        path: relativeToRoot(job.pet.path),
        sha256: inputHashes[1]
      }
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    inputFidelity: "high",
    orientation: "portrait",
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    output: { path: relativeToRoot(finalPath), sha256: outputHash },
    review: {
      state: "pending-human-review",
      checks: {
        petIdentity: null,
        adultAgeAndProportions: null,
        masterPoseAndExpression: null,
        masterStyleAndBrushwork: null,
        sceneAndComposition: null,
        anatomyAndContacts: null,
        textAndRights: null,
        dimensions: "pass"
      },
      findings: [],
      finalApproval: "pending-user"
    },
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.id}: ${relativeToRoot(finalPath)}`);
}

if (TARGET !== "all" && !secondBatchValidationJobs.some((job) => job.id === TARGET)) {
  throw new Error(`未知任务 ${TARGET}`);
}

await Promise.all([
  mkdir(OUTPUT_ROOT, { recursive: true }),
  mkdir(RAW, { recursive: true }),
  mkdir(META, { recursive: true })
]);

const selected = TARGET === "all"
  ? secondBatchValidationJobs
  : secondBatchValidationJobs.filter((job) => job.id === TARGET);
await verifyInputs(selected);
const config = await loadEnv();

let cursor = 0;
const failures = [];
const workers = Array.from({ length: Math.min(CONCURRENCY, selected.length) }, async () => {
  while (cursor < selected.length) {
    const at = cursor;
    cursor += 1;
    try {
      await generateJob(config, selected[at]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ id: selected[at].id, message });
      console.error(`失败 ${selected[at].id}: ${message}`);
    }
  }
});
await Promise.all(workers);
console.log(`第二批迁移生成结束：成功 ${selected.length - failures.length} 张，失败 ${failures.length} 张`);
if (failures.length) {
  for (const failure of failures) console.error(`待补跑 ${failure.id}: ${failure.message}`);
  process.exitCode = 1;
}
