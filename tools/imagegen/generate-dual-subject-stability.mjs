/** 每个双主体模板 4 位主人 x 5 只宠物，共 20 组运行时输入验证。 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildDualRuntimePrompt,
  dualMasterBasename,
  dualSubjectJobs,
  ownerReferences,
  relativeToRoot,
  REFERENCE_ROOT,
  stabilityPets
} from "./dual-subject-prompts.mjs";

const TARGET = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
const CONCURRENCY = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || 20)));
const DUAL_ROOT = path.join(REFERENCE_ROOT, "dual-subject");
const CANDIDATES = path.join(DUAL_ROOT, "candidates");
const OUT = path.join(DUAL_ROOT, "stability");

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

if (TARGET !== "all" && !dualSubjectJobs.some((job) => job.id === TARGET)) throw new Error(`未知双主体模板 ${TARGET}`);
const selectedTemplates = TARGET === "all" ? dualSubjectJobs : dualSubjectJobs.filter((job) => job.id === TARGET);
const matrix = selectedTemplates.flatMap((job) => ownerReferences.flatMap((owner) => stabilityPets.map((pet) => ({ job, owner, pet }))));
for (const item of matrix) {
  item.masterPath = path.join(CANDIDATES, `${dualMasterBasename(item.job)}.png`);
  for (const input of [item.masterPath, item.owner.path, item.pet.path]) {
    if (!await exists(input)) throw new Error(`${item.job.title} 缺运行时输入 ${input}`);
  }
}

const config = await loadEnv();
const records = [];
let cursor = 0;
async function run(item) {
  const id = `${item.job.id}_${item.owner.id}_${item.pet.id}_9x16_v01`;
  const outputPath = path.join(OUT, item.job.id, `${id}.png`);
  const metadataPath = path.join(OUT, item.job.id, "metadata", `${id}.json`);
  if (!FORCE && await exists(outputPath)) {
    records.push({ templateId: item.job.id, id, status: "skipped-existing", outputPath, metadataPath });
    return;
  }

  const inputs = [
    { role: "self-owned-master-candidate-runtime-simulation", path: item.masterPath },
    { role: "authorized-owner-identity-reference-internal-only", path: item.owner.path },
    { role: "self-owned-pet-identity-reference", path: item.pet.path }
  ];
  const prompt = buildDualRuntimePrompt(item.job);
  const startedAt = Date.now();
  const result = await edit(config, {
    imagePaths: inputs.map((input) => input.path),
    prompt,
    size: "720x1280",
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  const final = await fit(result.buffer, "portrait", { anchor: item.job.anchor, format: "png" });
  const actual = await dimensions(final);
  const visualContent = await hasUsableVisualContent(final);
  if (actual.width !== 720 || actual.height !== 1280) throw new Error(`${id} 输出尺寸错误 ${actual.width}x${actual.height}`);
  if (!visualContent) throw new Error(`${id} 输出画面无有效内容`);

  await mkdir(path.dirname(outputPath), { recursive: true });
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(outputPath, final);
  await writeFile(metadataPath, `${JSON.stringify({
    id,
    templateId: item.job.id,
    title: item.job.title,
    ownerId: item.owner.id,
    petId: item.pet.id,
    status: "engineering-stability-output-pending-human-review",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    requestOrder: ["self-owned-master", "owner-identity", "pet-identity"],
    inputs: await Promise.all(inputs.map(async (input) => ({ role: input.role, path: relativeToRoot(input.path), sha256: await sha256(input.path) }))),
    thirdPartyEffectReferenceIncluded: false,
    inputFidelity: "high",
    requestedSize: "720x1280",
    outputSize: `${actual.width}x${actual.height}`,
    elapsedMs: Date.now() - startedAt,
    automatedChecks: { dimensions: "pass", visualContent: "pass", inputCount: 3, roleOrder: "pass", thirdPartyReferenceExcluded: "pass" },
    humanChecks: Object.fromEntries(item.job.failureChecks.map((check) => [check, "pending"])),
    prompt,
    generatedAt: new Date().toISOString(),
    output: { path: relativeToRoot(outputPath), sha256: createHash("sha256").update(final).digest("hex") }
  }, null, 2)}\n`, "utf8");
  records.push({ templateId: item.job.id, id, status: "generated", outputPath, metadataPath });
  console.log(`完成 ${id}`);
}

async function worker() {
  while (cursor < matrix.length) {
    const item = matrix[cursor];
    cursor += 1;
    try {
      await run(item);
    } catch (error) {
      const id = `${item.job.id}_${item.owner.id}_${item.pet.id}_9x16_v01`;
      records.push({
        templateId: item.job.id,
        id,
        status: "failed-after-three-retries",
        error: error instanceof Error ? error.message : String(error)
      });
      console.error(`失败 ${id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
await mkdir(OUT, { recursive: true });
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, matrix.length) }, () => worker()));

const summary = selectedTemplates.map((job) => {
  const items = records.filter((record) => record.templateId === job.id);
  return {
    templateId: job.id,
    expected: 20,
    generated: items.filter((item) => item.status === "generated").length,
    existing: items.filter((item) => item.status === "skipped-existing").length,
    failed: items.filter((item) => item.status === "failed-after-three-retries").length
  };
});
await writeFile(path.join(OUT, "run-summary.json"), `${JSON.stringify({
  status: "engineering-stability-run-pending-human-review",
  concurrencyLimit: CONCURRENCY,
  retriesPerTask: 3,
  totalExpected: matrix.length,
  ownerIdentityCount: ownerReferences.length,
  publicReleaseOwnerThreshold: 12,
  publicReleaseOwnerThresholdMet: ownerReferences.length >= 12,
  petIdentityCount: stabilityPets.length,
  templates: summary,
  generatedAt: new Date().toISOString()
}, null, 2)}\n`, "utf8");
console.log(JSON.stringify(summary));
