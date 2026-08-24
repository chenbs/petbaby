import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { animalJobs, animalRelative } from "./animal-expansion-catalog.mjs";
import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const MASTER_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "masters");
const INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const APPROVAL_PATH = path.join(OUTPUT_ROOT, "approved-v05.json");
const approvedVersions = new Map([
  ["animal-fantasy-double-exposure", "eastern-myth-v02"]
]);
const failures = [];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

const masterIndex = JSON.parse(await readFile(INDEX_PATH, "utf8"));
const approval = JSON.parse(await readFile(APPROVAL_PATH, "utf8"));
if (approval.approvedCount !== 24 || approval.pendingRerun?.length !== 0) {
  failures.push({ templateId: "approval-index", message: "动物批准清单不是 24 张已批准、0 张待审核" });
}

for (const job of animalJobs.filter((item) => approvedVersions.has(item.templateId))) {
  const spec = expansionOutputSpecs[job.orientation];
  const version = approvedVersions.get(job.templateId);
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${version}`;
  const metadataPath = path.join(METADATA_ROOT, `${base}.json`);
  const masterPath = path.join(MASTER_ROOT, `${base}.webp`);
  try {
    await Promise.all([access(metadataPath), access(masterPath)]);
    const masterBody = await readFile(masterPath);
    const record = JSON.parse(await readFile(metadataPath, "utf8"));
    const actual = await dimensions(masterBody);
    if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`尺寸 ${actual.width}x${actual.height}`);
    if (!await hasUsableVisualContent(masterBody)) throw new Error("无有效画面");
    if (record.templateId !== job.templateId || record.version !== version) throw new Error("模板或版本不匹配");
    if (record.provider !== "lingsuan" || record.endpoint !== "/v1/images/edits") throw new Error("未使用 lingsuan 图生图");
    if (!record.output?.sha256) throw new Error("缺少历史输出哈希");
    if (record.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error("运行时第三方参考标记错误");
    if (record.maskIncluded !== false || record.coordinatePatchIncluded !== false) throw new Error("存在逐图遮罩或坐标补丁");
    if (record.queue?.maxRetriesPerTask !== 3 || record.queue?.maxAttemptsPerTask !== 4) throw new Error("重试元数据错误");
    if (record.status !== "approved-frozen-master" || record.review?.finalApproval !== "approved") throw new Error("冻结审批状态错误");
    if (record.masterSha256 !== sha256(masterBody)) throw new Error("冻结母版哈希不一致");
    const indexed = masterIndex.templates.find((item) => item.templateId === job.templateId);
    if (indexed?.version !== undefined) throw new Error("母版索引不应重复存版本字段");
    if (indexed?.path !== animalRelative(masterPath) || indexed?.sha256 !== sha256(masterBody)) throw new Error("冻结母版索引不一致");

    if (record.remediation !== "double-exposure-face-background-transition-refinement") throw new Error("未使用双重曝光过渡修复流程");
    if (record.inputs?.length !== 2) throw new Error("过渡修复输入数量错误");
    if (record.inputs?.[0]?.role !== "self-owned-eastern-myth-v01-edit-target") throw new Error("当前成图输入角色错误");
    if (record.inputs?.[1]?.role !== "one-time-third-party-double-exposure-blending-method-reference") throw new Error("融合方式参考角色错误");
    if (record.rawPetIdentityIncluded !== false) throw new Error("过渡修复重新引入了写实宠物照");
    if (record.userBackgroundInheritedFromSource !== true) throw new Error("未继承用户东方背景");
    if (record.sceneChangeBudget !== "0%-transition-only") throw new Error("场景变更预算错误");
    if (record.allowedChange !== "internal-face-to-scene-transition-only") throw new Error("允许变更范围错误");
    if (!record.blendContract?.remove?.includes("hard-internal-mask-edge")) throw new Error("未约束消除内部硬边");
    if (!record.prompt?.includes("Image 2 is only a blending-method reference")) throw new Error("未限制效果图只提供融合方式");
    if (record.approval?.approvedBy !== "user") throw new Error("缺少用户批准证据");
  } catch (error) {
    failures.push({ templateId: job.templateId, message: error instanceof Error ? error.message : String(error) });
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`失败 ${failure.templateId}: ${failure.message}`);
  process.exitCode = 1;
} else {
  console.log("动物最终修订审计：1/1 通过，eastern-myth-v02 WebP 冻结母版、索引、东方背景继承、无写实宠物照回注和用户审批证据均一致");
}
console.log(`审计目录：${animalRelative(OUTPUT_ROOT)}`);
