/** 仅冻结用户已批准的 01 夸张表情头像，不触碰其他待审批候选。 */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATE_NAME = "exaggerated-expression_ragdoll-cat_9x16_v02.png";
const CANDIDATE = path.join(REFERENCE_ROOT, "candidates", CANDIDATE_NAME);
const SOURCE_META = path.join(REFERENCE_ROOT, "metadata", `${path.parse(CANDIDATE_NAME).name}.json`);
const MASTER = path.join(REFERENCE_ROOT, "masters", CANDIDATE_NAME);
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata", `${path.parse(CANDIDATE_NAME).name}.json`);
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-13T00:00:00.000+08:00";

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const body = await readFile(CANDIDATE);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error("夸张表情头像尺寸不符合 720x1280");
if (!await hasUsableVisualContent(body)) throw new Error("夸张表情头像无有效视觉内容");
const digest = createHash("sha256").update(body).digest("hex");

const metadata = JSON.parse(await readFile(SOURCE_META, "utf8"));
if (metadata.templateId !== "exaggerated-expression") throw new Error("候选模板 ID 不匹配");
if (metadata.output?.sha256 !== digest) throw new Error("候选哈希与元数据不一致");
if (metadata.review?.state !== "prechecked-pending-user-approval") throw new Error("候选尚未完成预审");
if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
  throw new Error("候选仍有未通过的预审项");
}

await mkdir(path.dirname(MASTER), { recursive: true });
await mkdir(path.dirname(MASTER_META), { recursive: true });
await copyFile(CANDIDATE, MASTER);
const frozen = {
  ...metadata,
  status: "approved-frozen-master",
  candidatePath: relativeToRoot(CANDIDATE),
  masterPath: relativeToRoot(MASTER),
  masterSha256: digest,
  approval: {
    state: "approved-and-frozen",
    approvedBy: "user",
    approvedAt: APPROVED_AT,
    note: "用户确认 01 夸张表情头像效果通过并要求保存母版。运行时仅使用自有母版和用户宠物身份图。"
  },
  review: {
    ...metadata.review,
    state: "approved-by-user",
    finalApproval: "approved",
    approvedAt: APPROVED_AT
  }
};
await writeFile(SOURCE_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
await writeFile(MASTER_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");

const index = JSON.parse(await readFile(INDEX, "utf8"));
const entry = {
  templateId: "exaggerated-expression",
  title: "夸张表情头像",
  orientation: "portrait",
  size: "720x1280",
  path: relativeToRoot(MASTER),
  sha256: digest,
  metadata: relativeToRoot(MASTER_META),
  approvedAt: APPROVED_AT
};
const at = index.templates.findIndex((item) => item.templateId === entry.templateId);
if (at >= 0) index.templates[at] = entry;
else index.templates.push(entry);
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`已冻结夸张表情头像母版：${entry.path}`);
