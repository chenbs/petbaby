/** Generate three serial runtime simulations for each public-preview master candidate. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";
import {
  buildStabilityPrompt,
  candidateBasename,
  PROMOTION_ROOT,
  promotionJobs,
  relativeToRoot,
  ROOT,
  stabilityIdentities,
} from "./public-preview-master-promotion-catalog.mjs";

const CANDIDATE_ROOT = path.join(PROMOTION_ROOT, "candidates");
const API_INPUT_ROOT = path.join(PROMOTION_ROOT, "api-inputs");
const STABILITY_ROOT = path.join(PROMOTION_ROOT, "stability");
const PROMOTION_INDEX_PATH = path.join(PROMOTION_ROOT, "index.json");
const FORCE = process.argv.includes("--force");
const targetArgument = process.argv.slice(2).find((item) => !item.startsWith("--")) || "all";
const targetIds = targetArgument === "all" ? [] : targetArgument.split(",").filter(Boolean);

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

if (!await exists(PROMOTION_INDEX_PATH)) {
  throw new Error("请先运行 prepare-public-preview-master-candidates.mjs");
}
if (targetIds.some((id) => !promotionJobs.some((job) => job.templateId === id))) {
  throw new Error(`未知模板：${targetIds.filter((id) => !promotionJobs.some((job) => job.templateId === id)).join(", ")}`);
}

const promotionIndex = JSON.parse(await readFile(PROMOTION_INDEX_PATH, "utf8"));
const recordById = new Map(promotionIndex.templates.map((item) => [item.templateId, item]));
const selectedJobs = targetArgument === "all"
  ? promotionJobs
  : promotionJobs.filter((job) => targetIds.includes(job.templateId));

process.env.LINGSUAN_IMAGE_CONCURRENCY = "1";
const config = await loadEnv();
if (config.concurrency !== 1) throw new Error(`本批稳定性验证必须串行，实际并发为 ${config.concurrency}`);

const generatedRecords = [];
for (const job of selectedJobs) {
  const record = recordById.get(job.templateId);
  if (!record) throw new Error(`${job.templateId} 缺少候选索引`);
  const candidatePath = path.join(ROOT, record.candidatePath);
  const candidateBody = await readFile(candidatePath);
  if (sha256(candidateBody) !== record.candidateSha256) throw new Error(`${job.templateId} 候选哈希不匹配`);
  const candidateApiPath = path.join(ROOT, record.candidateApiInputPath);
  const candidateApiBody = await readFile(candidateApiPath);

  for (const identity of stabilityIdentities) {
    const identityRecord = promotionIndex.identities.find((item) => item.id === identity.id);
    if (!identityRecord) throw new Error(`${identity.id} 缺少压缩身份图索引`);
    const identityApiPath = path.join(ROOT, identityRecord.apiInputPath);
    const identityApiBody = await readFile(identityApiPath);
    const combinedInputBytes = candidateApiBody.byteLength + identityApiBody.byteLength;
    if (combinedInputBytes >= 1_000_000) throw new Error(`${job.templateId}/${identity.id} 输入合计 ${combinedInputBytes} 字节，超过限制`);

    const id = `${job.templateId}_${identity.id}_stability-v01`;
    const outputRoot = path.join(STABILITY_ROOT, job.templateId);
    const outputPath = path.join(outputRoot, `${id}.png`);
    const rawPath = path.join(outputRoot, "raw", `${id}.png`);
    const metadataPath = path.join(outputRoot, "metadata", `${id}.json`);
    await Promise.all([
      mkdir(outputRoot, { recursive: true }),
      mkdir(path.dirname(rawPath), { recursive: true }),
      mkdir(path.dirname(metadataPath), { recursive: true }),
    ]);

    if (!FORCE && await exists(outputPath) && await exists(metadataPath)) {
      const existing = await readFile(outputPath);
      const actual = await dimensions(existing);
      if (`${actual.width}x${actual.height}` === record.size && await hasUsableVisualContent(existing)) {
        generatedRecords.push({ templateId: job.templateId, identityId: identity.id, id, status: "skipped-existing", outputPath: relativeToRoot(outputPath), metadataPath: relativeToRoot(metadataPath) });
        console.log(`跳过已有结果 ${id}`);
        continue;
      }
    }

    const prompt = buildStabilityPrompt(job, identity, record.size);
    console.log(`开始 ${job.sequence}. ${job.title} / ${identity.label}（输入 ${combinedInputBytes} 字节）`);
    const startedAt = Date.now();
    const result = await edit(config, {
      imagePaths: [candidateApiPath, identityApiPath],
      prompt,
      size: record.size,
      quality: "high",
      outputFormat: "png",
      inputFidelity: "high",
      maxRetries: 3,
    });
    if (!await hasUsableVisualContent(result.buffer)) throw new Error(`${id} 灵算返回空白或无效画面`);
    const final = await fit(result.buffer, record.orientation, { anchor: 0.5, format: "png" });
    const actual = await dimensions(final);
    if (`${actual.width}x${actual.height}` !== record.size) throw new Error(`${id} 输出尺寸错误：${actual.width}x${actual.height}`);
    await writeFile(rawPath, result.buffer);
    await writeFile(outputPath, final);
    const metadata = {
      id,
      templateId: job.templateId,
      title: job.title,
      sequence: job.sequence,
      identityId: identity.id,
      identityLabel: identity.label,
      species: identity.species,
      breed: identity.breed,
      status: "generated-pending-human-review",
      provider: "lingsuan",
      model: config.model,
      endpoint: "/v1/images/edits",
      requestPolicy: {
        concurrency: 1,
        outputsPerRequest: 1,
        inputCount: 2,
        combinedInputBytes,
        maxCombinedInputBytesExclusive: 1_000_000,
        maxInputEdge: 1200,
        comparisonSheetIncluded: false,
      },
      inputs: [
        { role: "compressed-public-preview-master-candidate", path: relativeToRoot(candidateApiPath), sha256: sha256(candidateApiBody), bytes: candidateApiBody.byteLength, sourceCandidatePath: record.candidatePath, sourceCandidateSha256: record.candidateSha256 },
        { role: "compressed-pet-identity-reference", path: relativeToRoot(identityApiPath), sha256: sha256(identityApiBody), bytes: identityApiBody.byteLength, sourcePath: relativeToRoot(identity.path) },
      ],
      runtimeThirdPartyEffectReferenceIncluded: false,
      prompt,
      revisedPrompt: result.revisedPrompt || null,
      output: { path: relativeToRoot(outputPath), sha256: sha256(final), size: record.size },
      rawOutputPath: relativeToRoot(rawPath),
      automatedChecks: { dimensions: "pass", visualContent: "pass", inputCount: "pass", inputBytes: "pass", requestSerial: "pass" },
      humanChecks: {
        petIdentity: "pending",
        compositionAndCrop: "pending",
        poseExpressionAndGaze: "pending",
        clothingPropsAndText: "pending",
        styleAndPalette: "pending",
        anatomy: "pending",
      },
      finalApproval: "pending-user",
      elapsedMs: Date.now() - startedAt,
      generatedAt: new Date().toISOString(),
    };
    await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");
    generatedRecords.push({ templateId: job.templateId, identityId: identity.id, id, status: "generated", outputPath: relativeToRoot(outputPath), metadataPath: relativeToRoot(metadataPath) });
    console.log(`完成 ${id}`);
  }
}

const summaryPath = path.join(STABILITY_ROOT, "index.json");
const existingSummary = await exists(summaryPath) ? JSON.parse(await readFile(summaryPath, "utf8")) : { results: [] };
const nextById = new Map(existingSummary.results.map((item) => [item.id, item]));
for (const item of generatedRecords) nextById.set(item.id, item);
await writeFile(summaryPath, `${JSON.stringify({
  status: "generated-pending-human-review",
  provider: "lingsuan",
  requestPolicy: promotionIndex.requestPolicy,
  expectedTotal: promotionJobs.length * stabilityIdentities.length,
  generatedTotal: nextById.size,
  results: [...nextById.values()].sort((a, b) => a.id.localeCompare(b.id)),
  updatedAt: new Date().toISOString(),
}, null, 2)}\n`, "utf8");

console.log(`稳定性生成完成：本次 ${generatedRecords.length} 张，累计 ${nextById.size}/${promotionJobs.length * stabilityIdentities.length} 张`);
