/** Generate self-owned candidates for the 24 effect references in example/animal. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { animalJobs, buildAnimalPrompt, animalRelative } from "./animal-expansion-catalog.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const MAX_RETRIES = 3;
const args = process.argv.slice(2);
const target = args.find((item) => !item.startsWith("--")) || "all";
const force = args.includes("--force");
const concurrencyArgument = args.find((item) => item.startsWith("--concurrency="));
const workerConcurrency = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || process.env.LINGSUAN_IMAGE_CONCURRENCY || 20)));

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function hashFile(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function validExisting(file, spec) {
  if (!await exists(file)) return false;
  const body = await readFile(file);
  const actual = await dimensions(body);
  return actual.width === spec.width && actual.height === spec.height && await hasUsableVisualContent(body);
}

function selectedJobs() {
  if (target === "all") return animalJobs;
  const ids = target.split(",").filter(Boolean);
  const unknown = ids.filter((id) => !animalJobs.some((job) => job.templateId === id));
  if (unknown.length) throw new Error(`未知动物扩展模板: ${unknown.join(", ")}`);
  return animalJobs.filter((job) => ids.includes(job.templateId));
}

async function verifyJobInputs(job) {
  await access(job.effectReferencePath);
  await access(job.identity.path);
}

async function generateAttempt(config, job, output, paths, prompt, attempt) {
  const result = await edit(config, {
    imagePaths: paths,
    prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high",
    maxRetries: 0
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error("lingsuan 返回无有效画面");
  const final = await fit(result.buffer, job.orientation, { anchor: 0.38, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) throw new Error(`输出尺寸 ${actual.width}x${actual.height}`);
  return { result, final, actual, attempt };
}

async function generateJob(config, job) {
  const output = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${output.ratio}_${job.version}`;
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const rawPath = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  if (!force && await validExisting(candidatePath, output) && await exists(metadataPath)) {
    console.log(`跳过 ${job.templateId}: 已有有效候选`);
    return { status: "skipped", attempts: 0 };
  }

  const paths = [job.effectReferencePath, job.identity.path];
  const inputHashes = await Promise.all(paths.map(hashFile));
  const prompt = buildAnimalPrompt(job);
  let generated;
  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES + 1; attempt += 1) {
    try {
      console.log(`开始 ${job.templateId} (${job.identityId}) 尝试 ${attempt}/${MAX_RETRIES + 1}`);
      generated = await generateAttempt(config, job, output, paths, prompt, attempt);
      break;
    } catch (error) {
      lastError = error;
      if (attempt <= MAX_RETRIES) {
        console.error(`重试 ${job.templateId}: ${error instanceof Error ? error.message : String(error)}`);
        await new Promise((resolve) => setTimeout(resolve, 2000 * attempt));
      }
    }
  }
  if (!generated) throw lastError;

  await writeFile(rawPath, generated.result.buffer);
  await writeFile(candidatePath, generated.final);
  const outputHash = createHash("sha256").update(generated.final).digest("hex");
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    sourceEffectFile: animalRelative(job.effectReferencePath),
    status: "generated-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "one-time-third-party-effect-reference", path: animalRelative(paths[0]), sha256: inputHashes[0] },
      { role: "self-owned-pet-identity-reference", identityId: job.identityId, species: job.identity.species, breed: job.identity.breed, path: animalRelative(paths[1]), sha256: inputHashes[1] }
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    queue: { configuredConcurrency: config.concurrency, localWorkerConcurrency: workerConcurrency, maxRetriesPerTask: MAX_RETRIES, maxAttemptsPerTask: MAX_RETRIES + 1 },
    maskIncluded: false,
    coordinatePatchIncluded: false,
    inputFidelity: "high",
    orientation: job.orientation,
    requestedSize: output.size,
    outputSize: `${generated.actual.width}x${generated.actual.height}`,
    quality: "high",
    prompt,
    revisedPrompt: generated.result.revisedPrompt || null,
    output: { path: animalRelative(candidatePath), sha256: outputHash },
    review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
    generationAttempts: generated.attempt,
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.templateId}: ${animalRelative(candidatePath)}`);
  return { status: "generated", attempts: generated.attempt };
}

const jobs = selectedJobs();
await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true })
]);
await Promise.all(jobs.map(verifyJobInputs));
const config = await loadEnv();
if (config.concurrency !== workerConcurrency) throw new Error(`共享队列并发 ${config.concurrency} 与本次任务池 ${workerConcurrency} 不一致，请使用 --concurrency=${workerConcurrency}`);

let cursor = 0;
const failures = [];
const workers = Array.from({ length: Math.min(workerConcurrency, jobs.length) }, async () => {
  while (cursor < jobs.length) {
    const index = cursor;
    cursor += 1;
    try { await generateJob(config, jobs[index]); }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      failures.push({ templateId: jobs[index].templateId, message });
      console.error(`失败 ${jobs[index].templateId}: ${message}`);
    }
  }
});
await Promise.all(workers);
console.log(`动物扩展候选生成结束：成功 ${jobs.length - failures.length}，失败 ${failures.length}，并发 ${config.concurrency}，单任务最多重试 ${MAX_RETRIES} 次`);
if (failures.length) {
  for (const failure of failures) console.error(`待补跑 ${failure.templateId}: ${failure.message}`);
  process.exitCode = 1;
}
