/** Freeze the user-approved mini-companion v03 and adventure-rules v04 masters. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-15T00:17:44+08:00";

const approvals = [
  {
    templateId: "mini-companion",
    title: "同宠大小分身",
    name: "mini-companion_abyssinian-cat_9x16_v03.png",
    note: "用户确认 v03 的大小两只护目镜均正确佩戴在眼睛上并要求保存母版。",
    qualityBaseline: {
      required: [
        "two scale versions of one identical adult Abyssinian cat, with the miniature never reading as a kitten",
        "blue-framed mirrored ski goggles centred on and fully covering both eyes of both cats",
        "complete ears above the straps and intact black jackets, purple harnesses, toggles and seams",
        "large seated companion at left-front and miniature seated companion at right-rear",
        "clean white commercial studio, diagonal floor line and exact 720x1280 portrait framing"
      ],
      reject: [
        "goggles on forehead, crown or between ears, or any eye visible outside a lens",
        "different identities, ages, coat markings or facial structures between the two cats",
        "kittenized miniature, oversized head or eyes, skinny body or malformed anatomy",
        "changed scale relationship, pose, clothing, white studio, floor line, logo, watermark or signature"
      ]
    }
  },
  {
    templateId: "adventure-rules",
    title: "冒险生存法则",
    name: "adventure-rules_corgi-dog_9x16_v04.png",
    note: "用户确认 v04 的直立柯基头身角度自然协调并要求保存母版。",
    qualityBaseline: {
      required: [
        "complete stable anthropomorphic adult Corgi standing upright on two separate grounded hind paws",
        "head, neck, shoulders, sternum and spine aligned on one coherent three-quarter perspective axis",
        "adult compact Corgi identity with tan-white coat, broad blaze, upright ears and sturdy proportions",
        "woven hat, scarf, travel clothing, backpack, flashlight and dense parchment field-manual modules preserved",
        "sepia-black antique illustration treatment and exact 720x1280 portrait framing"
      ],
      reject: [
        "pasted frontal head, twisted neck, floating chin, broken throat or mismatched head and body angles",
        "sitting, crouching, fused legs, hidden feet, limb stumps, human hands or unstable upright anatomy",
        "puppy proportions, oversized head, skinny body, stern or strange expression",
        "changed parchment layout, missing modules, unrelated title, logo, watermark or signature"
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
  console.log(`Frozen ${approval.templateId}: ${entry.path}`);
}

index.status = "approved-frozen-master-set";
index.approvedAt = APPROVED_AT;
index.updatedAt = APPROVED_AT;
index.runtimeInputs = ["self-owned-frozen-master", "user-pet-identity-reference"];
index.excludesAtRuntime = ["third-party-effect-reference"];
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");
console.log(`Updated ${relativeToRoot(INDEX)}: ${index.templates.length} templates`);
