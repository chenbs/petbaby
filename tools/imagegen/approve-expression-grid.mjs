import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";
import { relativeToRoot } from "./reference-template-prompts.mjs";

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const MASTERS = path.join(REFERENCE_ROOT, "masters");
const NAME = "pet-expression-grid_cream-cat_9x16_v01.png";
const FILE = path.join(MASTERS, NAME);
const META = path.join(MASTERS, "metadata", `${path.parse(NAME).name}.json`);
const INDEX = path.join(MASTERS, "index.json");
const APPROVED_AT = "2026-08-13T00:00:00.000+08:00";

const body = await readFile(FILE);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error("九宫格尺寸不符合 720x1280");
if (!await hasUsableVisualContent(body)) throw new Error("九宫格无有效视觉内容");
const digest = createHash("sha256").update(body).digest("hex");

const metadata = JSON.parse(await readFile(META, "utf8"));
metadata.status = "approved-frozen-master";
metadata.masterPath = relativeToRoot(FILE);
metadata.masterSha256 = digest;
metadata.approval = {
  state: "approved-and-frozen",
  approvedBy: "user",
  approvedAt: APPROVED_AT,
  note: "用户确认九宫格保持当前版本，不再修改。"
};
metadata.review = {
  ...metadata.review,
  state: "approved-by-user",
  checks: Object.fromEntries(Object.keys(metadata.review?.checks || {}).map((key) => [key, "pass"])),
  findings: [],
  finalApproval: "approved",
  approvedAt: APPROVED_AT
};
await writeFile(META, `${JSON.stringify(metadata, null, 2)}\n`, "utf8");

const index = JSON.parse(await readFile(INDEX, "utf8"));
const entry = {
  templateId: "pet-expression-grid",
  title: "今日表情九宫格",
  orientation: "portrait",
  size: "720x1280",
  path: relativeToRoot(FILE),
  sha256: digest,
  metadata: relativeToRoot(META),
  approvedAt: APPROVED_AT
};
const at = index.templates.findIndex((item) => item.templateId === entry.templateId);
if (at >= 0) index.templates[at] = entry;
else index.templates.push(entry);
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`已冻结九宫格母版：${entry.path}`);
