/** Validate third-batch runtime outputs and their exact two-input evidence without editing metadata. */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { relativeToRoot } from "./reference-template-prompts.mjs";
import { thirdBatchValidationJobs } from "./reference-third-batch-validation-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-third-batch");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const INDEX_PATH = path.join(REFERENCE_ROOT, "masters", "index.json");
const ALLOW_MISSING = process.argv.includes("--allow-missing");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function fileHash(file) {
  return sha256(await readFile(file));
}

const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const frozen = new Map(index.templates.map((item) => [item.templateId, item]));
const missing = [];
let audited = 0;

for (const job of thirdBatchValidationJobs) {
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_9x16_${job.version}`;
  const outputPath = path.join(OUTPUT_ROOT, `${basename}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${basename}.json`);
  let body;
  let metadata;
  try {
    [body, metadata] = await Promise.all([
      readFile(outputPath),
      readFile(metadataPath, "utf8").then(JSON.parse)
    ]);
  } catch (error) {
    if (!ALLOW_MISSING || error?.code !== "ENOENT") throw error;
    missing.push(job.id);
    console.log(`缺失 ${basename}: 上游生成未成功`);
    continue;
  }
  const actual = await dimensions(body);
  if (actual.width !== 720 || actual.height !== 1280) throw new Error(`${basename}: 输出尺寸 ${actual.width}x${actual.height}`);
  if (!await hasUsableVisualContent(body)) throw new Error(`${basename}: 画面无有效内容`);
  if (metadata.output?.sha256 !== sha256(body)) throw new Error(`${basename}: 输出哈希不一致`);
  if (metadata.output?.path !== relativeToRoot(outputPath)) throw new Error(`${basename}: 输出路径不一致`);
  if (metadata.endpoint !== "/v1/images/edits") throw new Error(`${basename}: 未走图生图端点`);
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error(`${basename}: 运行时混入第三方效果参考`);
  if (metadata.sceneChangeBudget !== "0%") throw new Error(`${basename}: 场景变更预算不是 0%`);
  if (metadata.inputFidelity !== "high" || metadata.quality !== "high") throw new Error(`${basename}: 质量参数不完整`);
  if (metadata.requestedSize !== "720x1280" || metadata.outputSize !== "720x1280") throw new Error(`${basename}: 尺寸证据不一致`);
  const pending = metadata.status === "generated-pending-user-approval"
    && metadata.review?.state === "pending-human-review"
    && metadata.review?.finalApproval === "pending-user";
  const approved = metadata.status === "approved-runtime-validation"
    && metadata.review?.state === "approved-by-user"
    && metadata.review?.finalApproval === "approved"
    && Object.values(metadata.review?.checks || {}).every((value) => value === "pass");
  if (!pending && !approved) {
    throw new Error(`${basename}: 审批状态不完整`);
  }
  if (metadata.maskIncluded !== false || metadata.coordinatePatchIncluded !== false) throw new Error(`${basename}: 使用了遮罩或坐标补丁`);
  if (metadata.queue?.maxRetriesPerTask !== 3 || metadata.queue?.maxAttemptsPerTask !== 4) throw new Error(`${basename}: 重试证据不一致`);
  if (metadata.queue?.configuredConcurrency < 1 || metadata.queue?.configuredConcurrency > 20) throw new Error(`${basename}: 队列并发越界`);
  if (!Array.isArray(metadata.inputs) || metadata.inputs.length !== 2) throw new Error(`${basename}: 输入数量不是 2`);

  const masterInput = metadata.inputs[0];
  const identityInput = metadata.inputs[1];
  if (masterInput.role !== "self-owned-frozen-master") throw new Error(`${basename}: 输入 1 不是冻结母版`);
  if (identityInput.role !== "new-pet-identity-reference") throw new Error(`${basename}: 输入 2 不是身份图`);
  if (masterInput.path !== relativeToRoot(job.template.masterPath)) throw new Error(`${basename}: 母版路径错误`);
  if (identityInput.path !== relativeToRoot(job.pet.path)) throw new Error(`${basename}: 身份图路径错误`);
  if (masterInput.sha256 !== await fileHash(job.template.masterPath)) throw new Error(`${basename}: 母版输入哈希错误`);
  if (identityInput.sha256 !== await fileHash(job.pet.path)) throw new Error(`${basename}: 身份图输入哈希错误`);

  const frozenEntry = frozen.get(job.template.id);
  if (!frozenEntry) throw new Error(`${basename}: 冻结索引缺少母版`);
  if (frozenEntry.path !== masterInput.path || frozenEntry.sha256 !== masterInput.sha256) {
    throw new Error(`${basename}: 母版输入与冻结索引不一致`);
  }
  console.log(`通过 ${basename}: 720x1280 / 双输入哈希一致 / ${approved ? "用户已批准" : "待用户审批"} / 未含第三方效果参考`);
  audited += 1;
}

console.log(`第三批运行时迁移技术审计通过：${audited}/14，缺失 ${missing.length}/14`);
if (missing.length) console.log(`缺失任务：${missing.join(", ")}`);
