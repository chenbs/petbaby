/** Freeze the user-approved decorative-art-portrait v05 master. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const NAME = "decorative-art-portrait_ragdoll-cat_9x16_v05.png";
const CANDIDATE = path.join(REFERENCE_ROOT, "candidates", NAME);
const SOURCE_META = path.join(REFERENCE_ROOT, "metadata", `${path.parse(NAME).name}.json`);
const MASTER = path.join(REFERENCE_ROOT, "masters", NAME);
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata", `${path.parse(NAME).name}.json`);
const MASTER_DETAIL = path.join(REFERENCE_ROOT, "masters", "details", "decorative-art-portrait_face-fragments_v05.png");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-14T22:30:06+08:00";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const body = await readFile(CANDIDATE);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error("decorative-art-portrait v05 must be 720x1280");
if (!await hasUsableVisualContent(body)) throw new Error("decorative-art-portrait v05 has no usable visual content");

const digest = sha256(body);
const metadata = JSON.parse(await readFile(SOURCE_META, "utf8"));
if (metadata.templateId !== "decorative-art-portrait" || metadata.version !== "v05") {
  throw new Error("decorative-art-portrait v05 metadata mismatch");
}
if (metadata.output?.sha256 !== digest) throw new Error("decorative-art-portrait v05 candidate hash mismatch");
if (!["pending-user", "approved"].includes(metadata.review?.finalApproval)) {
  throw new Error("decorative-art-portrait v05 has an invalid approval state");
}
if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
  throw new Error("decorative-art-portrait v05 has a failed or incomplete precheck");
}

await mkdir(path.dirname(MASTER), { recursive: true });
await mkdir(path.dirname(MASTER_META), { recursive: true });
await mkdir(path.dirname(MASTER_DETAIL), { recursive: true });
await copyFile(CANDIDATE, MASTER);

const detail = await sharp(body)
  .extract({ left: 105, top: 115, width: 585, height: 815 })
  .resize(720, 960, { fit: "cover" })
  .png({ compressionLevel: 9 })
  .toBuffer();
await writeFile(MASTER_DETAIL, detail);

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
    note: "用户确认 decorative-art-portrait_ragdoll-cat_9x16_v05.png 很完美并要求保存母版。"
  },
  runtimeReferenceContract: {
    endpoint: "/v1/images/edits",
    provider: "lingsuan",
    image1: { role: "self-owned-frozen-master", path: relativeToRoot(MASTER), sha256: digest },
    image2: { role: "master-face-and-fragment-detail", path: relativeToRoot(MASTER_DETAIL), sha256: sha256(detail) },
    image3: { role: "user-pet-identity-only" },
    inputFidelity: "provider-default",
    sceneChangeBudget: "0%",
    excludes: ["third-party-effect-reference", "photographic-face", "previous-failed-candidate"]
  },
  qualityBaseline: {
    level: "approved-reference-standard",
    required: [
      "adult seal-point Ragdoll identity with a broad head, dark mask, upright ears and full cream chest",
      "single simplified blue-grey eye rendered as a flat angular paint shape",
      "large navy, cream and translucent grey fragments with dry broken edges",
      "flat two-dimensional ink-and-paper collage without hidden realistic underpainting",
      "warm off-white paper, generous negative space and exact 720x1280 portrait framing"
    ],
    reject: [
      "photographic eyes, nose, fur strands, facial gradients, anatomical volume or studio lighting",
      "low-poly 3D rendering, smooth realistic face beneath geometric overlays or glossy surfaces",
      "kittenized proportions, oversized eyes, gaunt face, malformed ears or fragmented misaligned features",
      "changed crop, paper field, restrained navy-grey palette, border, logo, watermark or signature"
    ]
  },
  review: {
    ...metadata.review,
    state: "approved-by-user",
    finalApproval: "approved",
    approvedAt: APPROVED_AT,
    findings: []
  }
};

await writeFile(SOURCE_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");
await writeFile(MASTER_META, `${JSON.stringify(frozen, null, 2)}\n`, "utf8");

const index = JSON.parse(await readFile(INDEX, "utf8"));
const entry = {
  templateId: "decorative-art-portrait",
  title: "装饰艺术肖像",
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
index.approvedAt = APPROVED_AT;
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Frozen decorative-art-portrait master: ${entry.path}`);
