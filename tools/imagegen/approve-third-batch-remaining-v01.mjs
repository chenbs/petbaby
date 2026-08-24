/** Freeze the three remaining third-batch masters approved by the user. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVAL_SHEET_META = path.join(REFERENCE_ROOT, "third-batch-approval-sheet-v04.json");
const APPROVED_AT = "2026-08-17T09:47:48+08:00";

const approvals = [
  {
    templateId: "original-magic-academy",
    title: "原创魔法学院",
    name: "original-magic-academy_dragon-li-cat_9x16_v01.png",
    note: "用户通过第三批待审批总览中的原创魔法学院 v01，并要求进入后续流程。",
    qualityBaseline: {
      required: [
        "one healthy adult Dragon Li cat with stable brown-grey tabby markings and mature proportions",
        "complete seated pose with natural paws, striped tail, black robe, green scarf and original paw-star emblem",
        "warm potion classroom with stone arches, leaded window, bottles, cauldron and coherent floor perspective",
        "subject placement, costume contacts, restrained warm-green palette and exact 720x1280 portrait framing"
      ],
      reject: [
        "residual long-haired reference cat identity, white point coat, platform watermark or copied account text",
        "kittenized head, oversized eyes, skinny body, malformed paws, broken robe, fused scarf or detached tail",
        "known school crest, franchise logo, recognisable character mark or added brand wording",
        "changed classroom composition, missing key props, unrelated text, logo, watermark or signature"
      ]
    }
  },
  {
    templateId: "epic-ruins",
    title: "史诗遗迹探险",
    name: "epic-ruins_german-shepherd-dog_9x16_v01.png",
    note: "用户通过第三批待审批总览中的史诗遗迹探险 v01，并要求进入后续流程。",
    qualityBaseline: {
      required: [
        "one healthy adult German Shepherd with upright ears, black saddle and mask, tan coat and athletic build",
        "heroic three-quarter standing pose on a rain-wet ledge with all visible limbs anatomically connected",
        "large dark mechanical exploration harness integrated around the shoulders, chest and back",
        "towering storm-lit ruins, monumental scale, cold blue-grey atmosphere and exact 720x1280 portrait framing"
      ],
      reject: [
        "residual human face, hair, hands, fingers, clothing anatomy or duplicated original explorer",
        "puppy proportions, generic wolf identity, malformed legs, floating armour, fused straps or broken paws",
        "flattened scale, bright generic fantasy scenery, removed ruins, calm studio lighting or background redesign",
        "known franchise insignia, logo, watermark, signature or platform UI"
      ]
    }
  },
  {
    templateId: "pet-life-journal",
    title: "本宠生涯日记",
    name: "pet-life-journal_toy-poodle-dog_9x16_v01.png",
    note: "用户通过第三批待审批总览中的本宠生涯日记 v01，并要求进入后续流程。",
    qualityBaseline: {
      required: [
        "one healthy adult apricot Toy Poodle with stable curly coat, dark eyes and mature compact proportions",
        "natural seated study interaction with green sweater, notebook, pen, laptop and tabletop contacts intact",
        "warm campus sunset, old stone building, lawn, path, tree frame and hand-drawn journal annotations",
        "plain paw laptop emblem, readable key annotation layout and exact 720x1280 portrait framing"
      ],
      reject: [
        "residual woman, human face, hair, skin, hands or fingers anywhere in the composition",
        "puppy or plush-toy proportions, oversized head or eyes, malformed paws, floating pen or broken sweater",
        "copied laptop brand mark, platform watermark, account ID, unrelated brand text or signature",
        "changed campus, sunset, table composition, annotation rhythm, crop or warm film-like palette"
      ]
    }
  }
];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const index = JSON.parse(await readFile(INDEX, "utf8"));
if (!Array.isArray(index.templates)) throw new Error("masters/index.json templates must be an array");

const approvedEntries = [];
for (const approval of approvals) {
  const basename = path.parse(approval.name).name;
  const candidate = path.join(REFERENCE_ROOT, "candidates", approval.name);
  const sourceMetaPath = path.join(REFERENCE_ROOT, "metadata", `${basename}.json`);
  const master = path.join(REFERENCE_ROOT, "masters", approval.name);
  const masterMeta = path.join(REFERENCE_ROOT, "masters", "metadata", `${basename}.json`);
  const body = await readFile(candidate);
  const actual = await dimensions(body);
  if (actual.width !== 720 || actual.height !== 1280) {
    throw new Error(`${approval.templateId} must be 720x1280, got ${actual.width}x${actual.height}`);
  }
  if (!await hasUsableVisualContent(body)) throw new Error(`${approval.templateId} has no usable visual content`);

  const digest = sha256(body);
  const metadata = JSON.parse(await readFile(sourceMetaPath, "utf8"));
  if (metadata.templateId !== approval.templateId || metadata.version !== "v01") {
    throw new Error(`${approval.templateId} candidate metadata mismatch`);
  }
  if (metadata.output?.sha256 !== digest) throw new Error(`${approval.templateId} candidate hash mismatch`);
  if (metadata.review?.finalApproval !== "pending-user") throw new Error(`${approval.templateId} is not awaiting approval`);
  if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
    throw new Error(`${approval.templateId} has a failed or incomplete precheck`);
  }
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) {
    throw new Error(`${approval.templateId} runtime third-party reference contract is not disabled`);
  }

  await mkdir(path.dirname(master), { recursive: true });
  await mkdir(path.dirname(masterMeta), { recursive: true });
  await copyFile(candidate, master);

  const frozen = {
    ...metadata,
    status: "approved-frozen-master",
    candidatePath: relativeToRoot(candidate),
    masterPath: relativeToRoot(master),
    masterSha256: digest,
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: approval.note
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: { role: "self-owned-frozen-master", path: relativeToRoot(master), sha256: digest },
      image2: { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "previous-failed-candidate", "unapproved-candidate"]
    },
    runtimeThirdPartyEffectReferenceIncluded: false,
    qualityBaseline: approval.qualityBaseline,
    review: {
      ...metadata.review,
      state: "approved-by-user",
      finalApproval: "approved",
      approvedAt: APPROVED_AT,
      findings: []
    }
  };

  await writeFile(sourceMetaPath, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
  await writeFile(masterMeta, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");

  const entry = {
    templateId: approval.templateId,
    title: approval.title,
    orientation: "portrait",
    size: "720x1280",
    path: relativeToRoot(master),
    sha256: digest,
    metadata: relativeToRoot(masterMeta),
    approvedAt: APPROVED_AT
  };
  const at = index.templates.findIndex((item) => item.templateId === approval.templateId);
  if (at >= 0) index.templates[at] = entry;
  else index.templates.push(entry);
  approvedEntries.push(entry);
  console.log(`Frozen ${approval.templateId}: ${entry.path}`);
}

index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
index.runtimeInputs = ["self-owned-frozen-master", "user-pet-identity-reference"];
index.excludesAtRuntime = ["third-party-effect-reference"];
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

const sheet = JSON.parse(await readFile(APPROVAL_SHEET_META, "utf8"));
if (sheet.items?.length !== approvals.length) throw new Error("third-batch v04 approval sheet item count mismatch");
sheet.status = "approved-by-user-and-frozen";
sheet.approvedAt = APPROVED_AT;
sheet.items = sheet.items.map((item) => {
  const entry = approvedEntries.find((candidate) => candidate.templateId === item.templateId);
  if (!entry) throw new Error(`third-batch v04 contains unexpected item ${item.templateId}`);
  return {
    ...item,
    reviewState: "approved-by-user",
    finalApproval: "approved",
    findings: [],
    approvedAt: APPROVED_AT,
    master: { path: entry.path, sha256: entry.sha256 }
  };
});
await writeFile(APPROVAL_SHEET_META, `${JSON.stringify(sheet, null, 2)}\n`, "utf8");

console.log(`Updated ${relativeToRoot(INDEX)}: ${index.templates.length} templates`);
