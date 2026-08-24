/** Freeze the user-approved ink-portrait reset-v03 reference-gaze rerun. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const NAME = "ink-portrait_black-labrador-dog_9x16_reset-v03-reference-gaze-rerun-v01.png";
const BASENAME = path.parse(NAME).name;
const CANDIDATE = path.join(REFERENCE_ROOT, "candidates", "experiments", NAME);
const STANDARD_CANDIDATE = path.join(REFERENCE_ROOT, "candidates", NAME);
const EXPERIMENT_META = path.join(REFERENCE_ROOT, "metadata", "experiments", `${BASENAME}.json`);
const STANDARD_META = path.join(REFERENCE_ROOT, "metadata", `${BASENAME}.json`);
const SOURCE_META = path.join(REFERENCE_ROOT, "metadata", "ink-portrait_black-labrador-dog_9x16_reset-v03.json");
const SUPERSEDED_META = path.join(REFERENCE_ROOT, "metadata", "ink-portrait_black-labrador-dog_9x16_reset-v08.json");
const MASTER = path.join(REFERENCE_ROOT, "masters", NAME);
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata", `${BASENAME}.json`);
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-16T00:38:00+08:00";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const body = await readFile(CANDIDATE);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) {
  throw new Error(`ink-portrait approved candidate must be 720x1280, got ${actual.width}x${actual.height}`);
}
if (!await hasUsableVisualContent(body)) throw new Error("ink-portrait approved candidate has no usable visual content");

const digest = sha256(body);
const experiment = JSON.parse(await readFile(EXPERIMENT_META, "utf8"));
const source = JSON.parse(await readFile(SOURCE_META, "utf8"));
if (source.templateId !== "ink-portrait" || source.version !== "reset-v03") {
  throw new Error("ink-portrait reset-v03 source metadata mismatch");
}
if (experiment.promptVariant !== "reference-gaze-only" || experiment.sourceVersion !== "reset-v03") {
  throw new Error("ink-portrait approved experiment variant mismatch");
}
if (experiment.output?.sha256 !== digest || experiment.output?.path !== relativeToRoot(CANDIDATE)) {
  throw new Error("ink-portrait approved candidate hash or path mismatch");
}
if (experiment.inputs?.length !== 2 || experiment.mask !== null || experiment.inputFidelity !== "not-sent") {
  throw new Error("ink-portrait approved experiment input contract mismatch");
}
if (!experiment.prompt.includes("Use the gaze from Image 1 exactly.")) {
  throw new Error("ink-portrait approved prompt does not use Image 1's gaze exactly");
}
if (experiment.prompt.includes("rounded-to-almond outer contour")) {
  throw new Error("ink-portrait approved prompt still contains the rejected handcrafted eye clause");
}

await mkdir(path.dirname(MASTER), { recursive: true });
await mkdir(path.dirname(MASTER_META), { recursive: true });
await copyFile(CANDIDATE, STANDARD_CANDIDATE);
await copyFile(CANDIDATE, MASTER);

const approvedBase = {
  ...source,
  status: "approved-frozen-master",
  version: "reset-v03-reference-gaze-rerun-v01",
  inputs: experiment.inputs,
  mask: null,
  maskedComposite: null,
  inputFidelity: experiment.inputFidelity,
  prompt: experiment.prompt,
  revisedPrompt: experiment.revisedPrompt,
  generatedAt: experiment.generatedAt,
  sourceVersion: experiment.sourceVersion,
  promptVariant: experiment.promptVariant,
  generationMetadata: relativeToRoot(EXPERIMENT_META),
  sourceExperimentPath: relativeToRoot(CANDIDATE),
  masterPath: relativeToRoot(MASTER),
  masterSha256: digest,
  approval: {
    state: "approved-and-frozen",
    approvedBy: "user",
    approvedAt: APPROVED_AT,
    note: "用户确认采用效果参考图（Image 1）眼神的 reset-v03 reference-gaze rerun v01，并要求冻结为母版。"
  },
  runtimeReferenceContract: {
    endpoint: "/v1/images/edits",
    provider: "lingsuan",
    image1: { role: "self-owned-frozen-master", path: relativeToRoot(MASTER), sha256: digest },
    image2: { role: "user-pet-identity-only" },
    inputFidelity: "high",
    sceneChangeBudget: "0%",
    excludes: [
      "third-party-effect-reference",
      "previous-failed-candidate",
      "unapproved-candidate",
      "handcrafted-eye-redesign"
    ]
  },
  runtimeThirdPartyEffectReferenceIncluded: false,
  qualityBaseline: {
    level: "approved-reference-standard",
    required: [
      "adult black Labrador identity with dropped ears, broad muzzle and healthy mature proportions",
      "the exact gaze, head angle, expression and painted facial decisions transferred from the effect reference",
      "minimalist black, paper-white and sparse grey ink-watercolour portrait with strong negative space",
      "large irregular brush masses, broken silhouette, dry-brush splatter and tapered diagonal lower stroke",
      "exact 720x1280 portrait framing"
    ],
    reject: [
      "a redesigned gaze or eye geometry not inherited from the approved master",
      "photographic eyeball, wet nose, realistic skull volume, individual fur strands or studio lighting",
      "puppy, chibi, oversized-head, skinny, gaunt, aggressive or uncanny proportions",
      "changed crop, paper field, restrained monochrome palette, brush masses, logo, watermark or signature"
    ]
  },
  review: {
    state: "approved-by-user",
    checks: {
      petIdentity: "pass",
      adultAgeAndCuteness: "pass",
      poseExpressionAndAction: "pass",
      sceneComposition: "pass",
      faceAndMediumConsistency: "pass",
      anatomyAndContacts: "pass",
      textAndRights: "pass",
      dimensions: "pass"
    },
    findings: [],
    finalApproval: "approved",
    approvedAt: APPROVED_AT
  }
};

const experimentFrozen = {
  ...approvedBase,
  output: experiment.output,
  candidatePath: relativeToRoot(CANDIDATE)
};
const standardFrozen = {
  ...approvedBase,
  output: { path: relativeToRoot(STANDARD_CANDIDATE), sha256: digest },
  candidatePath: relativeToRoot(STANDARD_CANDIDATE)
};
await writeFile(EXPERIMENT_META, `${JSON.stringify(experimentFrozen, null, 2)}\n`, "utf8");
await writeFile(STANDARD_META, `${JSON.stringify(standardFrozen, null, 2)}\n`, "utf8");
await writeFile(MASTER_META, `${JSON.stringify(standardFrozen, null, 2)}\n`, "utf8");

const superseded = JSON.parse(await readFile(SUPERSEDED_META, "utf8"));
if (superseded.templateId !== "ink-portrait" || superseded.version !== "reset-v08") {
  throw new Error("ink-portrait reset-v08 superseded metadata mismatch");
}
superseded.status = "superseded-by-approved-master";
superseded.review = {
  ...superseded.review,
  state: "superseded-before-user-approval",
  finalApproval: "not-selected",
  findings: ["用户最终选择并冻结 reset-v03 reference-gaze rerun v01；reset-v08 不再是待审批候选。"]
};
superseded.replacedBy = BASENAME;
await writeFile(SUPERSEDED_META, `${JSON.stringify(superseded, null, 2)}\n`, "utf8");

const index = JSON.parse(await readFile(INDEX, "utf8"));
if (!Array.isArray(index.templates)) throw new Error("masters/index.json templates must be an array");
const entry = {
  templateId: "ink-portrait",
  title: "黑白水墨肖像",
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
index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
index.runtimeInputs = ["self-owned-frozen-master", "user-pet-identity-reference"];
index.excludesAtRuntime = ["third-party-effect-reference"];
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Frozen ink-portrait master: ${entry.path}`);
console.log(`Updated ${relativeToRoot(INDEX)}: ${index.templates.length} templates`);
