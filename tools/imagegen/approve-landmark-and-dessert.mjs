/** Freeze the two user-approved second-batch master candidates. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-14T15:00:00+08:00";

const approvals = [
  {
    templateId: "landmark-adventure",
    title: "环球地标与户外探险",
    name: "landmark-adventure_abyssinian-cat_9x16_v01.png",
    note: "用户确认地标自拍候选通过并保存为环球地标与户外探险母版。",
    qualityBaseline: {
      required: [
        "close ultra-wide travel selfie with one extended foreground paw",
        "adult, healthy and immediately lovable Abyssinian identity with warm ruddy ticked coat",
        "black beret, round reflective sunglasses and red-and-white striped shirt preserved",
        "bright Paris daytime, Eiffel Tower rear-left, blue sky and cheerful tourist energy",
        "exact 720x1280 portrait framing"
      ],
      reject: [
        "missing or replaced landmark, changed selfie perspective or unrelated background",
        "skinny, gaunt, elderly, stern, aggressive, strange or kittenized pet",
        "duplicate or fused limbs, malformed glasses, broken clothing or extra animal",
        "brand logo, tourism sponsorship claim, watermark or signature"
      ]
    }
  },
  {
    templateId: "dessert-shopkeeper",
    title: "甜品饮品主理人",
    name: "dessert-shopkeeper_toy-poodle_9x16_v02.png",
    note: "用户确认甜品主理人 v02 候选通过并保存为母版。",
    qualityBaseline: {
      required: [
        "pink strawberry patisserie, warm light, shallow depth of field and original counter composition preserved",
        "adult, healthy and cute apricot Toy Poodle with tight curls, round eyes and teddy-bear muzzle",
        "cake hat, lace bow, flowers, strawberries, cakes, glass cloche, basket and cake server preserved",
        "upper-left framed sign visibly and accurately reads STRAWBERRY",
        "exact 720x1280 portrait framing"
      ],
      reject: [
        "scene redesign, removed dessert props, changed pose or unrelated animal",
        "skinny, gaunt, elderly, stern, aggressive, strange or over-kittenized pet",
        "gibberish text, extra sign, brand logo, watermark or signature",
        "duplicate limbs, fused objects, malformed hat, bow or cake boundary"
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
  if (metadata.templateId !== approval.templateId) throw new Error(`${approval.templateId} templateId mismatch`);
  if (metadata.output?.sha256 !== digest) throw new Error(`${approval.templateId} candidate hash does not match metadata`);
  if (metadata.review?.finalApproval !== "pending-user") throw new Error(`${approval.templateId} is not awaiting user approval`);
  if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
    throw new Error(`${approval.templateId} has a failed or incomplete precheck`);
  }
  if (metadata.runtimeThirdPartyEffectReferenceIncluded !== false) {
    throw new Error(`${approval.templateId} runtime third-party reference contract is not explicitly disabled`);
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
  console.log(`Frozen ${approval.templateId}: ${entry.path}`);
}

index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
index.runtimeInputs = ["self-owned-frozen-master", "user-pet-identity-reference"];
index.excludesAtRuntime = ["third-party-effect-reference"];
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Updated ${relativeToRoot(INDEX)}: ${index.templates.length} templates`);
