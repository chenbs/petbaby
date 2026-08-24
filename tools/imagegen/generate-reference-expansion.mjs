/** Generate the 38 newly split template candidates from the 65-image matrix. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildExpansionPrompt,
  expansionJobs,
  expansionOutputSpecs,
  relativeToRoot
} from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "expansion");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const RAW_ROOT = path.join(OUTPUT_ROOT, "raw");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const args = process.argv.slice(2);
const target = args.find((item) => !item.startsWith("--")) || "all";
const force = args.includes("--force");
const concurrencyArgument = args.find((item) => item.startsWith("--concurrency="));
const workerConcurrency = Math.max(1, Math.min(20, Number(
  concurrencyArgument?.split("=")[1] || process.env.LINGSUAN_IMAGE_CONCURRENCY || 20
)));

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
  if (target === "all") return expansionJobs;
  const ids = target.split(",").filter(Boolean);
  const unknown = ids.filter((id) => !expansionJobs.some((job) => job.templateId === id));
  if (unknown.length) throw new Error(`未知扩展模板: ${unknown.join(", ")}`);
  return expansionJobs.filter((job) => ids.includes(job.templateId));
}

async function verifyJobInputs(job) {
  await access(job.effectReferencePath);
  await access(job.identity.path);
}

async function generateJob(config, job) {
  const output = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${output.ratio}_${job.version}`;
  const candidatePath = path.join(CANDIDATE_ROOT, `${base}.png`);
  const rawPath = path.join(RAW_ROOT, `${base}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  if (!force && await validExisting(candidatePath, output) && await exists(metadataPath)) {
    console.log(`跳过 ${job.templateId}: 已有有效候选`);
    return;
  }

  const imagePaths = [job.effectReferencePath, job.identity.path];
  const inputHashes = await Promise.all(imagePaths.map(hashFile));
  const prompt = buildExpansionPrompt(job);
  console.log(`开始 ${job.templateId} (${job.identityId})`);
  const result = await edit(config, {
    imagePaths,
    prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${job.templateId}: lingsuan 返回无有效画面`);

  const final = await fit(result.buffer, job.orientation, { anchor: 0.38, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`${job.templateId}: 输出尺寸 ${actual.width}x${actual.height}`);
  }
  await writeFile(rawPath, result.buffer);
  await writeFile(candidatePath, final);
  const outputHash = createHash("sha256").update(final).digest("hex");
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    sourceEffectFile: relativeToRoot(job.effectReferencePath),
    status: "generated-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: [
      { role: "one-time-third-party-effect-reference", path: relativeToRoot(imagePaths[0]), sha256: inputHashes[0] },
      { role: "self-owned-pet-identity-reference", identityId: job.identityId, species: job.identity.species, breed: job.identity.breed, path: relativeToRoot(imagePaths[1]), sha256: inputHashes[1] }
    ],
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    queue: { configuredConcurrency: config.concurrency, localWorkerConcurrency: workerConcurrency, maxRetriesPerTask: 3, maxAttemptsPerTask: 4 },
    maskIncluded: false,
    coordinatePatchIncluded: false,
    inputFidelity: "high",
    orientation: job.orientation,
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    output: { path: relativeToRoot(candidatePath), sha256: outputHash },
    review: { state: "pending-human-review", finalApproval: "pending-user", findings: [] },
    generatedAt: new Date().toISOString()
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.templateId}: ${relativeToRoot(candidatePath)}`);
}

const jobs = selectedJobs();
await Promise.all([
  mkdir(CANDIDATE_ROOT, { recursive: true }),
  mkdir(RAW_ROOT, { recursive: true }),
  mkdir(METADATA_ROOT, { recursive: true })
]);
await Promise.all(jobs.map(verifyJobInputs));
const config = await loadEnv();
if (config.concurrency !== workerConcurrency) {
  throw new Error(`共享队列并发 ${config.concurrency} 与本次任务池 ${workerConcurrency} 不一致，请使用 --concurrency=${workerConcurrency}`);
}

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
console.log(`扩展模板候选生成结束：成功 ${jobs.length - failures.length}，失败 ${failures.length}，并发 ${config.concurrency}，单任务最多重试 3 次`);
if (failures.length) {
  for (const failure of failures) console.error(`待补跑 ${failure.templateId}: ${failure.message}`);
  process.exitCode = 1;
}
