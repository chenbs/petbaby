/** Freeze the user-approved upright pet-runway v04 master. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const NAME = "pet-runway_maine-coon-cat_9x16_v04.png";
const CANDIDATE = path.join(REFERENCE_ROOT, "candidates", NAME);
const SOURCE_META = path.join(REFERENCE_ROOT, "metadata", `${path.parse(NAME).name}.json`);
const MASTER = path.join(REFERENCE_ROOT, "masters", NAME);
const MASTER_META = path.join(REFERENCE_ROOT, "masters", "metadata", `${path.parse(NAME).name}.json`);
const MASTER_DETAIL = path.join(REFERENCE_ROOT, "masters", "details", "pet-runway_face-and-outfit_v04.png");
const INDEX = path.join(REFERENCE_ROOT, "masters", "index.json");
const APPROVED_AT = "2026-08-14T13:44:21+08:00";

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

const body = await readFile(CANDIDATE);
const actual = await dimensions(body);
if (actual.width !== 720 || actual.height !== 1280) throw new Error("pet-runway v04 must be 720x1280");
if (!await hasUsableVisualContent(body)) throw new Error("pet-runway v04 has no usable visual content");

const digest = sha256(body);
const metadata = JSON.parse(await readFile(SOURCE_META, "utf8"));
if (metadata.templateId !== "pet-runway") throw new Error("pet-runway v04 templateId mismatch");
if (metadata.output?.sha256 !== digest) throw new Error("pet-runway v04 candidate hash does not match metadata");
if (metadata.review?.finalApproval !== "pending-user") throw new Error("pet-runway v04 is not awaiting user approval");
if (Object.values(metadata.review?.checks || {}).some((value) => value !== "pass")) {
  throw new Error("pet-runway v04 has a failed or incomplete precheck");
}

await mkdir(path.dirname(MASTER), { recursive: true });
await mkdir(path.dirname(MASTER_META), { recursive: true });
await mkdir(path.dirname(MASTER_DETAIL), { recursive: true });
await copyFile(CANDIDATE, MASTER);

// Keep the approved upright silhouette and outfit available as a self-owned runtime control.
const detail = await sharp(body)
  .extract({ left: 80, top: 85, width: 560, height: 1080 })
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
    note: "用户确认 v04 直立走秀效果通过并保存为宠物时装周母版。"
  },
  runtimeReferenceContract: {
    endpoint: "/v1/images/edits",
    provider: "lingsuan",
    image1: { role: "self-owned-frozen-master", path: relativeToRoot(MASTER), sha256: digest },
    image2: { role: "master-face-and-outfit-detail", path: relativeToRoot(MASTER_DETAIL), sha256: sha256(detail) },
    image3: { role: "user-pet-identity-only" },
    inputFidelity: "high",
    sceneChangeBudget: "0%",
    excludes: ["third-party-effect-reference", "pet-runway-v03", "previous-failed-candidate"]
  },
  qualityBaseline: {
    level: "approved-reference-standard",
    required: [
      "upright anthropomorphic runway stride with a vertical torso and two separate hind paws",
      "adult Maine Coon identity, lynx-tipped ears, full ruff, classic tabby coat and attached tail",
      "friendly mature face with contemporary cute appeal, never kittenized or gaunt",
      "grey coat, cream knit, charcoal scarf and pale sage lower garment preserved",
      "centred runway, blurred audience, grey spotlight and exact 720x1280 portrait framing"
    ],
    reject: [
      "quadrupedal, seated or horizontally bodied pose when upright runway is requested",
      "human torso, human face, human hands, fingers, exposed human arms or costume-like pasted head",
      "duplicate limbs, fused paws, fused tail, malformed clothing boundary or broken anatomy",
      "skinny, elderly, stern, aggressive, chibi or oversized-headed cat",
      "changed runway, audience, spotlight, crop, garment palette, logo, watermark or signature"
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

const index = JSON.parse(await readFile(INDEX, "utf8"));
const entry = {
  templateId: "pet-runway",
  title: "宠物时装周",
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
index.updatedAt = APPROVED_AT;
await writeFile(INDEX, `${JSON.stringify(index, null, 2)}\n`, "utf8");

console.log(`Frozen pet-runway master: ${entry.path}`);
