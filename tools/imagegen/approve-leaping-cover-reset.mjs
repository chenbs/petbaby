/** Freeze the user-approved 05 reset-v02 master and its runtime style controls. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const NAME = "leaping-cover_border-collie_9x16_reset-v02.png";
const CANDIDATE = path.join(REFERENCE_ROOT, "reset", "candidates", NAME);
const RAW = path.join(REFERENCE_ROOT, "reset", "raw", NAME);
const SOURCE_META = path.join(REFERENCE_ROOT, "reset", "metadata", `${path.parse(NAME).name}.json`);
const MASTER = path.join(REFERENCE_ROOT, "masters", NAME);
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata", `${path.parse(NAME).name}.json`);
const MASTER_DETAIL = path.join(REFERENCE_ROOT, "masters", "details", "leaping-cover_face-brushwork_reset-v02.png");
const SOURCE_MASK = path.join(REFERENCE_ROOT, "reset", "masks", "leaping-cover_border-collie_9x16_mask.png");
const MASTER_MASK = path.join(REFERENCE_ROOT, "masters", "masks", "leaping-cover_subject_reset-v02.png");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-14T10:02:56+08:00";
const REVIEWED_AT = APPROVED_AT;

const REVIEW_DECISIONS = [
  {
    name: "leaping-cover_border-collie_9x16_reset-v01.png",
    status: "rejected-by-user",
    state: "rejected-by-user",
    finalApproval: "rejected",
    findings: [
      "The forced exact-pixel background reconstruction introduced polygon seams, retained subject fragments and block-like compositing artifacts around fur and paint splashes.",
      "The saved candidate is not representative of the seamless raw lingsuan result and cannot be used as a style or quality reference."
    ]
  }
];

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

async function persistReviewDecision(decision) {
  const metadataPath = path.join(REFERENCE_ROOT, "reset", "metadata", `${path.parse(decision.name).name}.json`);
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  const reviewed = {
    ...metadata,
    status: decision.status,
    review: {
      state: decision.state,
      finalApproval: decision.finalApproval,
      reviewedAt: REVIEWED_AT,
      findings: decision.findings
    }
  };
  await writeFile(metadataPath, `${JSON.stringify(reviewed, null, 2)}\n`, "utf8");
}

const body = await readFile(CANDIDATE);
const raw = await readFile(RAW);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error("05 reset-v02 must be 720x1280");
if (!await hasUsableVisualContent(body)) throw new Error("05 reset-v02 has no usable visual content");
if (Buffer.compare(body, raw) !== 0) throw new Error("Approved candidate must be the seamless lingsuan raw output");

const metadata = JSON.parse(await readFile(SOURCE_META, "utf8"));
if (!["05", "leaping-cover"].includes(metadata.templateId)
  || !["reset-candidate-pending-user-approval", "approved-frozen-master"].includes(metadata.status)) {
  throw new Error("05 reset-v02 metadata is neither pending approval nor an existing approved master");
}
const roles = metadata.inputs.map((input) => input.role);
for (const role of ["immutable-effect-base", "effect-face-and-brushwork-detail", "pet-identity-only", "edit-mask"]) {
  if (!roles.includes(role)) throw new Error(`05 reset-v02 is missing input role ${role}`);
}

await mkdir(path.dirname(MASTER), { recursive: true });
await mkdir(path.dirname(MASTER_META), { recursive: true });
await mkdir(path.dirname(MASTER_DETAIL), { recursive: true });
await mkdir(path.dirname(MASTER_MASK), { recursive: true });
await copyFile(CANDIDATE, MASTER);
await copyFile(SOURCE_MASK, MASTER_MASK);

const detail = await sharp(body)
  .extract({ left: 70, top: 110, width: 580, height: 600 })
  .resize(720, 720, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(MASTER_DETAIL, detail);

const frozen = {
  ...metadata,
  templateId: "leaping-cover",
  sourceResetId: "05",
  title: "腾空跳跃封面",
  status: "approved-frozen-master",
  candidatePath: relativeToRoot(CANDIDATE),
  masterPath: relativeToRoot(MASTER),
  masterSha256: sha256(body),
  approval: {
    state: "approved-and-frozen",
    approvedBy: "user",
    approvedAt: APPROVED_AT,
    note: "用户确认 05 reset-v02 效果很好并要求保存母版；后续产出不得低于该画风与完成度基线。"
  },
  runtimeReferenceContract: {
    endpoint: "/v1/images/edits",
    provider: "lingsuan",
    image1: { role: "self-owned-frozen-master", path: relativeToRoot(MASTER), sha256: sha256(body) },
    image2: { role: "master-face-and-brushwork-detail", path: relativeToRoot(MASTER_DETAIL), sha256: sha256(detail) },
    image3: { role: "user-pet-identity-only" },
    mask: { role: "subject-edit-mask", path: relativeToRoot(MASTER_MASK), sha256: sha256(await readFile(MASTER_MASK)) },
    inputFidelity: "provider-default",
    sceneChangeBudget: "0%",
    excludes: ["third-party-effect-reference", "previous-failed-candidate"]
  },
  qualityBaseline: {
    level: "approved-reference-standard",
    required: [
      "joyful head-on airborne action and exact foreshortened paw composition",
      "closed-eye painted crescents and a fully hand-painted nose, mouth and tongue",
      "loose expressive digital-impressionist brushwork across face, fur and background",
      "adult breed proportions without beautification or juvenilization",
      "clean energetic colour field without scene redesign"
    ],
    reject: [
      "photographic face, glossy photo-real nose or camera-resolved fur strands",
      "generic puppy face, enlarged eyes, oversized head or shortened juvenile muzzle",
      "changed pose, expression, crop, palette, background content or paint language",
      "mixed-media pasted subject, hard cutout halo, watermark or account ID"
    ]
  },
  review: {
    state: "approved-by-user",
    finalApproval: "approved",
    approvedAt: APPROVED_AT,
    findings: []
  }
};

await writeFile(SOURCE_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
await writeFile(MASTER_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");

for (const decision of REVIEW_DECISIONS) {
  await persistReviewDecision(decision);
}

const index = JSON.parse(await readFile(INDEX, "utf8"));
const entry = {
  templateId: "leaping-cover",
  title: "腾空跳跃封面",
  orientation: "portrait",
  size: "720x1280",
  path: relativeToRoot(MASTER),
  sha256: sha256(body),
  metadata: relativeToRoot(MASTER_META),
  approvedAt: APPROVED_AT
};
const existing = index.templates.findIndex((item) => item.templateId === entry.templateId);
if (existing >= 0) index.templates[existing] = entry;
else {
  const rollerCoaster = index.templates.findIndex((item) => item.templateId === "roller-coaster");
  index.templates.splice(rollerCoaster >= 0 ? rollerCoaster + 1 : index.templates.length, 0, entry);
}
index.updatedAt = APPROVED_AT;
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Frozen leaping-cover master: ${entry.path}`);
