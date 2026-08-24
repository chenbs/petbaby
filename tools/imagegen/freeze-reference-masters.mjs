import { createHash } from "node:crypto";
import { access, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { referenceTemplates, relativeToRoot } from "./reference-template-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const META = path.join(REFERENCE_ROOT, "metadata");
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata");
const APPROVED_AT = "2026-08-13T00:00:00.000+08:00";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

await mkdir(path.join(REFERENCE_ROOT, "masters"), { recursive: true });
await mkdir(MASTER_META, { recursive: true });

async function readExistingIndex() {
  const file = path.join(REFERENCE_ROOT, "masters", "index.json");
  try {
    await access(file);
    const current = JSON.parse(await readFile(file, "utf8"));
    return Array.isArray(current.templates) ? current.templates : [];
  } catch {
    return [];
  }
}

const existingIndex = await readExistingIndex();
const index = [];
for (const template of referenceTemplates) {
  const candidateBody = await readFile(template.candidatePath);
  await copyFile(template.candidatePath, template.masterPath);
  const sourceMetaName = `${path.parse(template.candidate).name}.json`;
  const sourceMetaPath = path.join(META, sourceMetaName);
  const sourceMeta = JSON.parse(await readFile(sourceMetaPath, "utf8"));
  const frozen = {
    ...sourceMeta,
    status: "approved-frozen-master",
    candidatePath: relativeToRoot(template.candidatePath),
    masterPath: relativeToRoot(template.masterPath),
    masterSha256: sha256(candidateBody),
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: "用户已审批通过；此后运行时仅使用自有母版和用户宠物身份图。"
    },
    review: {
      state: "approved-by-user",
      score: null,
      findings: []
    }
  };
  await writeFile(sourceMetaPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  await writeFile(path.join(MASTER_META, sourceMetaName), `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  index.push({
    templateId: template.id,
    title: template.title,
    orientation: template.orientation,
    size: template.size,
    path: relativeToRoot(template.masterPath),
    sha256: frozen.masterSha256,
    metadata: relativeToRoot(path.join(MASTER_META, sourceMetaName)),
    approvedAt: APPROVED_AT
  });
  console.log(`已冻结 ${template.id}: ${relativeToRoot(template.masterPath)}`);
}

const baseIds = new Set(index.map((item) => item.templateId));
index.push(...existingIndex.filter((item) => !baseIds.has(item.templateId)));

await writeFile(path.join(REFERENCE_ROOT, "masters", "index.json"), `${JSON.stringify({
  status: "approved-frozen-master-set",
  approvedAt: APPROVED_AT,
  runtimeInputs: ["self-owned-frozen-master", "user-pet-identity-reference"],
  excludesAtRuntime: ["third-party-effect-reference"],
  templates: index
}, null, 2)}\n`, "utf8");

console.log(`已写入 ${path.relative(ROOT, path.join(REFERENCE_ROOT, "masters", "index.json"))}`);
