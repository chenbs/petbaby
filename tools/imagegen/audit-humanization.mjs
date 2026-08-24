/** Engineering audit for the pet-to-human approval batch. No model calls. */
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import {
  HUMANIZATION_PROMPT_VERSION,
  HUMANIZATION_ROOT,
  humanizationComparisons,
  humanizationIdentities,
  humanizationTemplates,
  rejectedHumanizationAssets,
  ROOT,
} from "./humanization-catalog.mjs";

throw new Error("PET_HUMAN_SCHEME_RETIRED: 旧宠物人化方案已撤回，历史审计不得作为当前门禁");

const require = createRequire(path.join(ROOT, "apps/platform/package.json"));
const sharp = require("sharp");

function relative(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

async function inspect(file) {
  const body = await readFile(file);
  const metadata = await sharp(body).metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!body.byteLength || metadata.format !== "png") throw new Error(`Invalid PNG: ${relative(file)}`);
  if (width < 720 || height < 720) throw new Error(`Image is too small: ${relative(file)} (${width}x${height})`);
  return { path: relative(file), bytes: body.byteLength, width, height, sha256: sha256(body) };
}

if (humanizationTemplates.length !== 12) throw new Error("Expected exactly 12 pending templates");
if (humanizationIdentities.length !== 12) throw new Error("Expected exactly 12 identity cards");
if (new Set(humanizationTemplates.map((item) => item.templateId)).size !== 12) throw new Error("Duplicate templateId");
if (new Set(humanizationTemplates.map((item) => item.identityId)).size !== 12) throw new Error("Each probe must use a distinct identity");
if (humanizationTemplates.some((item) => item.status !== "pending-review" || item.subjectMode !== "pet-human")) {
  throw new Error("Approval batch must stay pending-review with subjectMode=pet-human");
}

const identities = new Map();
for (const identity of humanizationIdentities) identities.set(identity.identityId, await inspect(identity.card));

const templates = [];
for (const template of humanizationTemplates) {
  const master = await inspect(template.master);
  const candidate = await inspect(template.candidate);
  if (master.width >= master.height || candidate.width >= candidate.height) throw new Error(`Portrait orientation required: ${template.templateId}`);
  const masterRatio = master.width / master.height;
  const candidateRatio = candidate.width / candidate.height;
  if (Math.abs(masterRatio - candidateRatio) > 0.02) throw new Error(`Master/candidate aspect mismatch: ${template.templateId}`);
  templates.push({
    templateId: template.templateId,
    title: template.title,
    subjectMode: template.subjectMode,
    status: template.status,
    version: template.version,
    identityId: template.identityId,
    master,
    identity: identities.get(template.identityId),
    candidate,
  });
}

const comparisons = [];
for (const comparison of humanizationComparisons) {
  comparisons.push({
    id: comparison.id,
    conclusion: comparison.conclusion,
    direct: await inspect(comparison.direct),
    twoStage: await inspect(comparison.twoStage),
  });
}

const rejected = [];
for (const item of rejectedHumanizationAssets) {
  const source = await inspect(item.file);
  const replacement = await inspect(item.replacement);
  if (source.sha256 === replacement.sha256) throw new Error(`Rejected asset was not replaced: ${source.path}`);
  rejected.push({ reason: item.reason, source, replacement });
}

const report = {
  schemaVersion: 1,
  generatedAt: new Date().toISOString(),
  generatedBy: "local-sharp-audit",
  modelCall: false,
  promptVersion: HUMANIZATION_PROMPT_VERSION,
  counts: { templates: templates.length, identities: identities.size, comparisons: comparisons.length, rejected: rejected.length },
  automaticGates: {
    structure: "pass",
    pngReadable: "pass",
    minimumDimensions: "pass",
    portraitOrientation: "pass",
    masterCandidateAspectMatch: "pass",
    distinctIdentityCoverage: "pass",
    pendingReviewOnly: "pass",
    rejectedAssetsReplaced: "pass",
  },
  manualGatesPending: [
    "pet identity is recognizable to the owner",
    "face and body remain completely human",
    "master composition, pose, clothing, lighting and style are preserved",
    "no visible watermark, malformed anatomy or accidental extra subject",
  ],
  templates,
  comparisons,
  rejected,
};

await mkdir(HUMANIZATION_ROOT, { recursive: true });
const output = path.join(HUMANIZATION_ROOT, "audit.json");
await writeFile(output, `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(relative(output));
