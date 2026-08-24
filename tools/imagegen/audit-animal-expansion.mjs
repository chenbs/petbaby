import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { animalJobs, animalRelative } from "./animal-expansion-catalog.mjs";
import { expansionOutputSpecs } from "./reference-expansion-catalog.mjs";

const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "animal");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");
const failures = [];
const seenSources = new Set();
const seenTemplates = new Set();

for (const job of animalJobs) {
  const spec = expansionOutputSpecs[job.orientation];
  const base = `${job.templateId}_${job.identityId}_${spec.ratio}_${job.version}`;
  const candidate = path.join(CANDIDATE_ROOT, `${base}.png`);
  const metadata = path.join(METADATA_ROOT, `${base}.json`);
  try {
    await access(candidate);
    await access(metadata);
    const body = await readFile(candidate);
    const actual = await dimensions(body);
    if (actual.width !== spec.width || actual.height !== spec.height) throw new Error(`尺寸 ${actual.width}x${actual.height}`);
    if (!await hasUsableVisualContent(body)) throw new Error("无有效画面");
    const record = JSON.parse(await readFile(metadata, "utf8"));
    if (record.templateId !== job.templateId || record.entryId !== job.entryId) throw new Error("模板或入口元数据不匹配");
    if (record.inputs?.[0]?.role !== "one-time-third-party-effect-reference") throw new Error("效果参考角色错误");
    if (record.inputs?.[1]?.role !== "self-owned-pet-identity-reference") throw new Error("宠物身份角色错误");
    if (record.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error("运行时第三方参考标记错误");
    if (record.sceneChangeBudget !== "0%") throw new Error("场景预算错误");
    if (record.queue?.maxRetriesPerTask !== 3 || record.queue?.maxAttemptsPerTask !== 4) throw new Error("重试元数据错误");
    if (seenSources.has(job.sourceFile)) throw new Error("效果图未保持逐图唯一");
    if (seenTemplates.has(job.templateId)) throw new Error("templateId 重复");
    seenSources.add(job.sourceFile);
    seenTemplates.add(job.templateId);
  } catch (error) {
    failures.push({ templateId: job.templateId, message: error instanceof Error ? error.message : String(error) });
  }
}

if (animalJobs.length !== 24) failures.push({ templateId: "catalog", message: `台账数量为 ${animalJobs.length}，应为 24` });
if (seenSources.size !== animalJobs.length) failures.push({ templateId: "catalog", message: `效果图唯一数为 ${seenSources.size}` });
if (seenTemplates.size !== animalJobs.length) failures.push({ templateId: "catalog", message: `模板唯一数为 ${seenTemplates.size}` });

if (failures.length) {
  for (const failure of failures) console.error(`失败 ${failure.templateId}: ${failure.message}`);
  console.error(`动物扩展审计：${animalJobs.length - failures.length}/${animalJobs.length} 通过`);
  process.exitCode = 1;
} else {
  console.log(`动物扩展审计：${animalJobs.length}/${animalJobs.length} 通过，尺寸、入口、角色顺序、0% 场景预算、唯一性和重试元数据均正确`);
}
console.log(`审计目录：${animalRelative(OUTPUT_ROOT)}`);
