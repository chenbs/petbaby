/**
 * 双主体母版候选：第三方效果参考 + 授权主人身份图 + 自有宠物身份图。
 *
 * 用法：
 *   node tools/imagegen/generate-dual-subject-masters.mjs fish-chase --probe --concurrency=1
 *   node tools/imagegen/generate-dual-subject-masters.mjs all --concurrency=4
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildDualMasterPrompt,
  dualMasterBasename,
  dualSubjectJobs,
  relativeToRoot,
  REFERENCE_ROOT
} from "./dual-subject-prompts.mjs";

const TARGET = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const PROBE = process.argv.includes("--probe");
const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
const CONCURRENCY = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || 1)));
const DUAL_ROOT = path.join(REFERENCE_ROOT, "dual-subject");
const OUT = path.join(DUAL_ROOT, "candidates");
const RAW = path.join(OUT, "raw");
const META = path.join(DUAL_ROOT, "metadata");
const PROBE_OUT = path.join(DUAL_ROOT, "probe");

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function run(job, config) {
  const basename = dualMasterBasename(job);
  const finalPath = PROBE ? path.join(PROBE_OUT, `${basename}-probe.png`) : path.join(OUT, `${basename}.png`);
  const rawPath = PROBE ? path.join(PROBE_OUT, "raw", `${basename}-probe.png`) : path.join(RAW, `${basename}.png`);
  const metadataPath = PROBE ? path.join(PROBE_OUT, `${basename}-probe.json`) : path.join(META, `${basename}.json`);
  if (!FORCE && await exists(finalPath)) {
    console.log(`跳过 ${job.title}：${PROBE ? "探针" : "候选"}已存在`);
    return;
  }

  const inputs = [
    { role: "third-party-effect-reference-internal-master-production-only", path: job.effectReference },
    { role: "authorized-owner-identity-reference-internal-only", path: job.owner.path },
    { role: "self-owned-pet-identity-reference", path: job.pet.path }
  ];
  const prompt = buildDualMasterPrompt(job);
  const startedAt = Date.now();
  const result = await edit(config, {
    imagePaths: inputs.map((input) => input.path),
    prompt,
    size: "720x1280",
    quality: "high",
    outputFormat: "png",
    inputFidelity: "high"
  });
  const final = await fit(result.buffer, "portrait", { anchor: job.anchor, format: "png" });
  const actual = await dimensions(final);
  if (actual.width !== 720 || actual.height !== 1280) throw new Error(`${job.title} 输出尺寸错误 ${actual.width}x${actual.height}`);
  if (!await hasUsableVisualContent(final)) throw new Error(`${job.title} 输出画面无有效内容`);

  await mkdir(path.dirname(finalPath), { recursive: true });
  await mkdir(path.dirname(rawPath), { recursive: true });
  await mkdir(path.dirname(metadataPath), { recursive: true });
  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.id,
    title: job.title,
    entryId: job.entryId,
    version: job.version,
    status: PROBE ? "three-reference-technical-probe" : "dual-subject-master-candidate-pending-user-approval",
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    requestOrder: ["effect-reference", "owner-identity", "pet-identity"],
    inputs: await Promise.all(inputs.map(async (input) => ({ role: input.role, path: relativeToRoot(input.path), sha256: await sha256(input.path) }))),
    derivedEffectReference: job.effectSource ? {
      source: relativeToRoot(job.effectSource),
      sourceSha256: await sha256(job.effectSource),
      normalizedGuide: relativeToRoot(job.effectReference),
      method: "local-aspect-normalization-only-no-model-call"
    } : null,
    runtimeThirdPartyEffectReferenceIncluded: false,
    ownerPublicSampleAllowed: false,
    sceneChangeBudget: "0%",
    inputFidelity: "high",
    requestedSize: "720x1280",
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    elapsedMs: Date.now() - startedAt,
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    automatedChecks: { dimensions: "pass", visualContent: "pass", inputCount: 3, inputRoleOrder: "pass" },
    visualReview: { state: "pending-user", failureChecks: job.failureChecks },
    generatedAt: new Date().toISOString(),
    output: { path: relativeToRoot(finalPath), rawPath: relativeToRoot(rawPath), sha256: createHash("sha256").update(final).digest("hex") }
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.title}: ${relativeToRoot(finalPath)}`);
}

if (TARGET !== "all" && !dualSubjectJobs.some((job) => job.id === TARGET)) throw new Error(`未知双主体模板 ${TARGET}`);
if (PROBE && TARGET !== "fish-chase") throw new Error("三参考探针固定使用 fish-chase");
const selected = TARGET === "all" ? dualSubjectJobs : dualSubjectJobs.filter((job) => job.id === TARGET);
for (const job of selected) {
  for (const input of [job.effectReference, job.owner.path, job.pet.path]) {
    if (!await exists(input)) throw new Error(`${job.title} 缺输入 ${input}`);
  }
}

const config = await loadEnv();
let cursor = 0;
async function worker() {
  while (cursor < selected.length) {
    const job = selected[cursor];
    cursor += 1;
    await run(job, config);
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () => worker()));
