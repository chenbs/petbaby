import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { expansionJobs, expansionOutputSpecs, relativeToRoot } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT_ROOT = path.join(import.meta.dirname, "out", "reference-v1", "expansion");
const CANDIDATE_ROOT = path.join(OUTPUT_ROOT, "candidates");
const METADATA_ROOT = path.join(OUTPUT_ROOT, "metadata");

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

const failures = [];
for (const job of expansionJobs) {
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
    const record = await readJson(metadata);
    if (record.templateId !== job.templateId || record.entryId !== job.entryId) throw new Error("模板或入口元数据不匹配");
    if (record.inputs?.[0]?.role !== "one-time-third-party-effect-reference") throw new Error("效果参考角色错误");
    if (record.inputs?.[1]?.role !== "self-owned-pet-identity-reference") throw new Error("宠物身份角色错误");
    if (record.runtimeThirdPartyEffectReferenceIncluded !== false) throw new Error("运行时第三方参考标记错误");
    if (record.sceneChangeBudget !== "0%") throw new Error("场景变更预算错误");
    if (record.queue?.maxRetriesPerTask !== 3 || record.queue?.maxAttemptsPerTask !== 4) throw new Error("重试策略元数据错误");
  } catch (error) {
    failures.push({ templateId: job.templateId, message: error instanceof Error ? error.message : String(error) });
  }
}

if (failures.length) {
  for (const failure of failures) console.error(`失败 ${failure.templateId}: ${failure.message}`);
  console.error(`扩展候选审计：${expansionJobs.length - failures.length}/${expansionJobs.length} 通过`);
  process.exitCode = 1;
} else {
  console.log(`扩展候选审计：${expansionJobs.length}/${expansionJobs.length} 通过，尺寸、入口、角色顺序、0% 场景预算和重试元数据均正确`);
}

console.log(`审计目录：${relativeToRoot(OUTPUT_ROOT)}`);
