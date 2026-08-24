/**
 * 第三批 7 张单宠母版候选：第三方效果参考 + 自有宠物身份图 -> lingsuan 图生图。
 *
 * 用法：
 *   node tools/imagegen/generate-reference-third-batch.mjs all --concurrency=7
 *   node tools/imagegen/generate-reference-third-batch.mjs ink-portrait --force
 */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import { auditOutsideMaskLock, lockOutsideMask } from "./masked-composite.mjs";
import {
  buildThirdBatchPrompt,
  relativeToRoot,
  thirdBatchBasename,
  thirdBatchJobs,
  thirdBatchOutputSpecs
} from "./reference-third-batch-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUT = path.join(REFERENCE_ROOT, "candidates");
const RAW = path.join(OUT, "raw");
const META = path.join(REFERENCE_ROOT, "metadata");
const TARGET = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const FORCE = process.argv.includes("--force");
const concurrencyArgument = process.argv.find((item) => item.startsWith("--concurrency="));
const CONCURRENCY = Math.max(1, Math.min(20, Number(concurrencyArgument?.split("=")[1] || 1)));

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function requestInputs(job) {
  const identityReference = job.identityReference || job.pet.path;
  if (job.editTarget) {
    return [
      { role: "self-owned-candidate-edit-target", path: job.editTarget },
      { role: "third-party-effect-reference-style-only", path: job.effectReference },
      job.editGuide
        ? { role: job.editGuideRole, path: job.editGuide }
        : { role: job.identityReferenceRole || (job.identityReference ? "derived-pet-identity-reference-from-prior-candidate" : "pet-identity-reference"), path: identityReference }
    ];
  }
  return [
    { role: "third-party-effect-reference-internal-master-production-only", path: job.effectReference },
    { role: job.identityReferenceRole || (job.identityReference ? "derived-pet-identity-reference-from-prior-candidate" : "pet-identity-reference"), path: identityReference }
  ];
}

async function run(job, config) {
  const output = thirdBatchOutputSpecs[job.orientation];
  const basename = thirdBatchBasename(job);
  const finalPath = path.join(OUT, `${basename}.png`);
  const rawPath = path.join(RAW, `${basename}.png`);
  const metadataPath = path.join(META, `${basename}.json`);
  if (!FORCE && await exists(finalPath)) {
    console.log(`跳过 ${job.title}：候选已存在`);
    return { job, skipped: true, finalPath, metadataPath };
  }

  console.log(`开始 ${job.title} / ${job.pet.breedZh}`);
  const prompt = job.promptMetadataPath
    ? JSON.parse(await readFile(job.promptMetadataPath, "utf8")).prompt
    : buildThirdBatchPrompt(job);
  const identityReference = job.identityReference || job.pet.path;
  const inputs = requestInputs(job);
  const inputHashes = await Promise.all(inputs.map((input) => sha256(input.path)));
  const result = await edit(config, {
    imagePaths: inputs.map((input) => input.path),
    maskPath: job.maskPath || "",
    prompt,
    size: output.size,
    quality: "high",
    outputFormat: "png",
    inputFidelity: job.inputFidelity ?? "high"
  });
  const fitted = await fit(result.buffer, job.orientation, { anchor: job.anchor, format: "png" });
  const final = job.editTarget && job.maskPath
    ? await lockOutsideMask({ basePath: job.editTarget, edited: fitted, maskPath: job.maskPath })
    : fitted;
  const pixelAudit = job.editTarget && job.maskPath
    ? await auditOutsideMaskLock({ basePath: job.editTarget, outputPath: final, maskPath: job.maskPath })
    : null;
  if (pixelAudit && (pixelAudit.outsideChanged !== 0 || pixelAudit.insideChanged === 0)) {
    throw new Error(`${job.title} 遮罩像素锁定失败: ${JSON.stringify(pixelAudit)}`);
  }
  const actual = await dimensions(final);
  if (actual.width !== output.width || actual.height !== output.height) {
    throw new Error(`${job.title} 输出尺寸错误 ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(final)) throw new Error(`${job.title} 输出画面无有效内容`);

  await writeFile(rawPath, result.buffer);
  await writeFile(finalPath, final);
  await writeFile(metadataPath, `${JSON.stringify({
    templateId: job.id,
    title: job.title,
    entryId: job.entryId,
    status: "master-candidate-pending-user-approval",
    version: job.version,
    subject: job.subjectId,
    breed: job.pet.breedZh,
    selectionRationale: job.rationale,
    provider: "lingsuan",
    model: config.model,
    endpoint: "/v1/images/edits",
    inputs: inputs.map((input, index) => ({
      role: input.role,
      path: relativeToRoot(input.path),
      sha256: inputHashes[index]
    })),
    mask: job.maskPath ? {
      role: job.maskRole || "transparent-eye-and-brow-edit-mask",
      path: relativeToRoot(job.maskPath),
      sha256: await sha256(job.maskPath)
    } : null,
    maskedComposite: job.editTarget && job.maskPath ? {
      outsideMaskLockedToEditTarget: true,
      editTarget: relativeToRoot(job.editTarget),
      method: "local-rgba-composite-after-lingsuan-edit",
      pixelAudit
    } : null,
    identityProvenance: job.editGuide ? {
      originalPetIdentityPath: relativeToRoot(job.pet.path),
      editGuide: relativeToRoot(job.editGuide)
    } : job.identityReference ? {
      originalPetIdentityPath: relativeToRoot(job.pet.path),
      derivedIdentityReference: relativeToRoot(job.identityReference)
    } : null,
    runtimeThirdPartyEffectReferenceIncluded: false,
    sceneChangeBudget: "0%",
    inputFidelity: job.inputFidelity || "not-sent",
    orientation: job.orientation,
    requestedSize: output.size,
    outputSize: `${actual.width}x${actual.height}`,
    quality: "high",
    prompt,
    revisedPrompt: result.revisedPrompt || null,
    review: {
      state: "pending-visual-precheck",
      checks: {
        petIdentity: "pending",
        adultAgeAndCuteness: "pending",
        poseExpressionAndAction: "pending",
        sceneComposition: "pending",
        faceAndMediumConsistency: "pending",
        anatomyAndContacts: "pending",
        textAndRights: "pending",
        dimensions: "pass"
      },
      findings: [],
      finalApproval: "pending-user"
    },
    generatedAt: new Date().toISOString(),
    output: {
      path: relativeToRoot(finalPath),
      rawPath: relativeToRoot(rawPath),
      sha256: createHash("sha256").update(final).digest("hex")
    }
  }, null, 2)}\n`, "utf8");
  console.log(`完成 ${job.title}: ${relativeToRoot(finalPath)}`);
  return { job, skipped: false, finalPath, metadataPath };
}

if (TARGET !== "all" && !thirdBatchJobs.some((job) => job.id === TARGET)) {
  throw new Error(`未知第三批模板 ${TARGET}`);
}

await mkdir(OUT, { recursive: true });
await mkdir(RAW, { recursive: true });
await mkdir(META, { recursive: true });

const masterIndex = JSON.parse(await readFile(path.join(REFERENCE_ROOT, "masters", "index.json"), "utf8"));
const frozenTemplateIds = new Set(masterIndex.templates.map((item) => item.templateId));
const requested = TARGET === "all" ? thirdBatchJobs : thirdBatchJobs.filter((job) => job.id === TARGET);
const selected = requested.filter((job) => !frozenTemplateIds.has(job.id));
for (const job of requested.filter((item) => frozenTemplateIds.has(item.id))) {
  console.log(`跳过已冻结 ${job.title}：母版受保护，不重新生成`);
}
for (const job of selected) {
  for (const input of [...requestInputs(job).map((item) => item.path), ...(job.maskPath ? [job.maskPath] : [])]) {
    if (!await exists(input)) throw new Error(`${job.title} 缺输入 ${input}`);
  }
}

const config = selected.length ? await loadEnv() : null;
let cursor = 0;
const results = [];
async function worker() {
  while (cursor < selected.length) {
    const job = selected[cursor];
    cursor += 1;
    results.push(await run(job, config));
  }
}
await Promise.all(Array.from({ length: Math.min(CONCURRENCY, selected.length) }, () => worker()));

console.log(`第三批完成：${results.filter((item) => !item.skipped).length} 张新生成，${results.filter((item) => item.skipped).length} 张跳过`);
