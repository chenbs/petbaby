/** 校验第二批 10 张运行时迁移图及其双输入证据，不修改任何元数据。 */
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { secondBatchValidationJobs } from "./reference-second-batch-validation-prompts.mjs";
import { relativeToRoot } from "./reference-template-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const OUTPUT_ROOT = path.join(REFERENCE_ROOT, "validation-second-batch");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const INDEX_PATH = path.join(REFERENCE_ROOT, "masters", "index.json");

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function fileHash(file) {
  return sha256(await readFile(file));
}

const index = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const frozen = new Map(index.templates.map((item) => [item.templateId, item]));

for (const job of secondBatchValidationJobs) {
  const basename = `${job.template.id}_${job.variant}_${job.identityId}_9x16_${job.version}`;
  const outputPath = path.join(OUTPUT_ROOT, `${basename}.png`);
  const metadataPath = path.join(METADATA_ROOT, `${basename}.json`);
  const [body, metadata] = await Promise.all([
    readFile(outputPath),
    readFile(metadataPath, "utf8").then(JSON.parse),
  ]);
  const actual = await dimensions(body);
  if (actual.width !== 720 || actual.height !== 1280) {
    throw new Error(`${basename}: 输出尺寸 ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(body)) throw new Error(`${basename}: 画面无有效内容`);
  if (metadata.output?.sha256 !== sha256(body)) throw new Error(`${basename}: 输出哈希不一致`);
  if (metadata.output?.path !== relativeToRoot(outputPath)) throw new Error(`${basename}: 输出路径不一致`);
  if (metadata.endpoint !== "/v1/images/edits") throw new Error(`${basename}: 未走图生图端点`);
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) {
    throw new Error(`${basename}: 运行时混入第三方效果参考`);
  }
  if (metadata.sceneChangeBudget !== "0%") throw new Error(`${basename}: 场景变更预算不是 0%`);
  if (metadata.requestedSize !== "720x1280" || metadata.outputSize !== "720x1280") {
    throw new Error(`${basename}: 请求或输出尺寸证据不一致`);
  }
  if (metadata.status !== "approved-runtime-validation") throw new Error(`${basename}: 未登记为已批准迁移图`);
  if (metadata.review?.state !== "approved-by-user" || metadata.review?.finalApproval !== "approved") {
    throw new Error(`${basename}: 用户审批状态不完整`);
  }
  if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
    throw new Error(`${basename}: 仍有未通过的视觉检查项`);
  }
  if (!Array.isArray(metadata.inputs) || metadata.inputs.length !== 2) {
    throw new Error(`${basename}: 输入数量不是 2`);
  }

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
  console.log(`通过 ${basename}: 720x1280 / 2 个输入哈希一致 / 用户已批准 / 未含第三方效果参考`);
}

console.log(`第二批运行时迁移结案校验通过：${secondBatchValidationJobs.length}/10`);
