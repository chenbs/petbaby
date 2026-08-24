/** Promote only explicitly approved second-pass frozen-master candidates. */
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { dimensions, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const MASTER_ROOT = path.join(REFERENCE_ROOT, "masters");
const MASTER_INDEX_PATH = path.join(MASTER_ROOT, "index.json");
const PUBLIC_INDEX_PATH = path.join(REFERENCE_ROOT, "public-previews", "index.json");
const DEPLOY_MANIFEST_PATH = path.join(REFERENCE_ROOT, "deploy-assets.tsv");
const LOCAL_OBJECT_ROOT = path.join(ROOT, "apps", "platform", ".data", "objects");
const APPROVED_AT = "2026-08-20T09:18:36+08:00";
const targetArgument = process.argv.find((item) => item.startsWith("--target="));
const TARGET = targetArgument?.slice("--target=".length) || "all";

const approvals = [
  {
    templateId: "animal-giant-law-poster",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round2", "metadata", "animal-giant-law-poster.json"),
    required: [
      "the German Shepherd head is one subtle proportional step larger and naturally connected to the monumental humanoid shoulders and torso",
      "monumental humanoid full-body silhouette, immense shoulders and low-angle divine-form scale",
    ],
    reject: [
      "an undersized, oversized or disconnected head, ordinary animal body, reduced monumental scale or malformed anatomy",
      "changed composition, extended paw, robe, background, lighting or crop",
    ],
    note: "用户在第二轮视觉审核中明确确认巨物法相海报通过。",
  },
  {
    templateId: "fish-chase",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round3", "metadata", "fish-chase.json"),
    required: [
      "very large round startled cat eyes naturally recessed into the sockets without a protruding or bead-like appearance",
      "natural smooth central forehead on the urgent angry owner without visible veins or an excessive pinched frown",
      "extreme fisheye chase composition with the tuxedo cat gripping the fish",
    ],
    reject: [
      "small eyes, popping or bulging eyeballs, an ugly or uncanny cat face",
      "excessive glabellar creases, visible forehead veins, reduced urgency or changed owner identity",
      "changed market scene, fish, pigeons, flying paper, camera or crop",
    ],
    note: "用户在第三轮视觉审核中明确确认偷鱼大作战通过。",
  },
  {
    templateId: "mini-companion",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round10", "metadata", "mini-companion.json"),
    subject: "maine-coon-cat",
    breed: "成年棕黑虎斑缅因猫",
    masterInputs: [
      {
        role: "third-party-effect-reference-internal-master-production-only",
        path: "apps/website/public/assets/example/1786369135481.png",
      },
      {
        role: "pet-identity-reference",
        identityId: "maine-coon-cat",
        species: "cat",
        breed: "adult brown-and-black tabby Maine Coon cat",
        path: "apps/website/public/assets/work-maine.jpg",
      },
    ],
    updatePublicPreview: false,
    required: [
      "the exact same adult brown-and-black tabby Maine Coon identity at two different scales, with the smaller cat retaining adult proportions",
      "strong oblique low-angle camera with level forward feline gaze, large-left and small-right placement, and a wide grounded stance",
      "black jackets, purple harnesses, mirrored goggles, sloping white floor and the complete continuous black diagonal floor seam",
    ],
    reject: [
      "Bengal, Abyssinian, German Shepherd, kitten proportions or mixed identity inherited from an earlier candidate",
      "top-down camera, raised chin, upward-looking eyes, missing floor seam, changed outfit, malformed paws or duplicate anatomy",
    ],
    note: "用户确认仅由原始效果图与 work-maine.jpg 重建的 mini-companion v13 通过，并要求冻结。",
  },
  {
    templateId: "animal-enamel-cat-beast",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round11", "metadata", "animal-enamel-cat-beast.json"),
    subject: "ragdoll-cat",
    breed: "成年海豹重点色布偶猫",
    masterInputs: [
      {
        role: "one-time-third-party-effect-reference",
        path: "apps/website/public/assets/example/animal/jimeng-2026-06-23-1938-cg插画，珐琅彩猫神兽，无尾。浓密绵长的彩绘线条环绕神兽，向后飘舞、流动，拉出残....png",
      },
      {
        role: "self-owned-pet-identity-reference",
        identityId: "ragdoll-cat",
        species: "cat",
        breed: "adult seal-point Ragdoll cat",
        path: "apps/website/public/assets/work-ragdoll.jpg",
      },
    ],
    updatePublicPreview: false,
    required: [
      "unmistakable mature seal-point Ragdoll identity from work-ragdoll.jpg",
      "the original running pose, red field, white smoke and flowing gold-red-turquoise enamel ribbons",
      "coherent feline anatomy with one raised front paw and one extended grounded front leg",
    ],
    reject: [
      "Dragon Li, tabby shorthair, Siamese, kitten or generic white-cat identity",
      "changed composition, hidden breed-defining face, malformed paws or broken ribbon anatomy",
    ],
    note: "用户确认由原始效果图与 work-ragdoll.jpg 重建的流体珐琅猫神兽 v03 通过并冻结。",
  },
  {
    templateId: "animal-glass-paw-portrait",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round11", "metadata", "animal-glass-paw-portrait.json"),
    subject: "poodle-dog",
    breed: "成年杏色玩具贵宾犬（泰迪）",
    masterInputs: [
      {
        role: "one-time-third-party-effect-reference",
        path: "apps/website/public/assets/example/animal/jimeng-2026-06-30-9004-帮我生成图片：保持脸不变，水后时尚宠物写真，泰迪头部特写，极近距离拍摄，比熊神态....png",
      },
      {
        role: "self-owned-pet-identity-reference",
        identityId: "toy-poodle-dog",
        species: "dog",
        breed: "adult apricot Toy Poodle dog",
        path: "apps/website/public/assets/avatar-poodle.jpg",
      },
    ],
    updatePublicPreview: false,
    required: [
      "recognizable adult apricot Toy Poodle identity from avatar-poodle.jpg",
      "aquarium-through-glass close-up with both canine paws pressed against the glass",
      "strong rippling water-caustic light across the forehead, cheeks and muzzle",
    ],
    reject: [
      "cat, West Highland Terrier, Bichon, white-dog or generic-puppy identity",
      "missing face caustics, changed aquarium composition, malformed paws or obscured eyes and nose",
    ],
    note: "用户确认由原始效果图与 avatar-poodle.jpg 重建的玻璃爪印特写 v03 通过并冻结。",
  },
  {
    templateId: "animal-sword-cat-alt",
    metadataPath: path.join(REFERENCE_ROOT, "remediation-20260819-round11", "metadata", "animal-sword-cat-alt.json"),
    subject: "abyssinian-cat",
    breed: "成年浅灰色阿比西尼亚猫",
    masterInputs: [
      {
        role: "one-time-third-party-effect-reference",
        path: "apps/website/public/assets/example/animal/jimeng-2026-08-13-4087-插画风格特效，古风，动漫风，3D，大师作品，超高清，动态，一只超萌的剑客猫耳娘作....png",
      },
      {
        role: "self-owned-pet-identity-reference",
        identityId: "silver-abyssinian-cat",
        species: "cat",
        breed: "adult pale silver-grey Abyssinian cat",
        path: "apps/website/public/assets/avatar-abyssinian.jpg",
      },
    ],
    updatePublicPreview: false,
    required: [
      "mature Abyssinian facial and body structure from avatar-abyssinian.jpg with the original reference's pale cool-silver coat treatment",
      "original ornate mask, black-and-white costume, martial-arts paw pose and cinematic blue-rim lighting",
      "complete natural feline paws, intense focused gaze and exact close heroic composition",
    ],
    reject: [
      "warm brown, orange, cream, pure white, kittenized or generic round-faced-cat identity",
      "changed mask, costume, pose, crop, lighting, malformed paws or humanized face",
    ],
    note: "用户确认由原始效果图与 avatar-abyssinian.jpg 重建的古风剑客宠物二 v03 通过并冻结。",
  },
];

if (TARGET !== "all" && !approvals.some((item) => item.templateId === TARGET)) {
  throw new Error(`Unknown approval target ${TARGET}`);
}
const selectedApprovals = approvals.filter((item) => TARGET === "all" || item.templateId === TARGET);

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

async function readJson(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function pushLocalObject(body, storageKey) {
  const target = path.join(LOCAL_OBJECT_ROOT, storageKey);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, body);
  await writeFile(`${target}.meta`, JSON.stringify({ contentType: "image/png" }), "utf8");
}

const masterIndex = await readJson(MASTER_INDEX_PATH);
const publicIndex = await readJson(PUBLIC_INDEX_PATH);
let publicIndexChanged = false;
if (masterIndex.status !== "approved-frozen-master-set" || !Array.isArray(masterIndex.templates)) {
  throw new Error("Invalid frozen master index");
}
if (publicIndex.status !== "approved-public-preview-set" || !Array.isArray(publicIndex.templates)) {
  throw new Error("Invalid public preview index");
}

for (const approval of selectedApprovals) {
  const remediation = await readJson(approval.metadataPath);
  if (remediation.templateId !== approval.templateId || remediation.status !== "generated-pending-visual-review") {
    throw new Error(`${approval.templateId} candidate metadata is not promotable`);
  }

  const source = path.resolve(ROOT, remediation.output.finalPath);
  const body = await readFile(source);
  const digest = sha256(body);
  const actual = await dimensions(body);
  if (actual.width !== 720 || actual.height !== 1280) throw new Error(`${approval.templateId} has invalid dimensions`);
  if (!await hasUsableVisualContent(body)) throw new Error(`${approval.templateId} has no usable visual content`);
  if (digest !== remediation.output.sha256) throw new Error(`${approval.templateId} candidate hash mismatch`);

  const indexAt = masterIndex.templates.findIndex((item) => item.templateId === approval.templateId);
  const previewAt = publicIndex.templates.findIndex((item) => item.templateId === approval.templateId);
  if (indexAt < 0 || previewAt < 0) throw new Error(`${approval.templateId} is missing from an approved index`);
  const previous = masterIndex.templates[indexAt];
  if (previous.sha256 === digest) {
    console.log(`Already promoted ${approval.templateId} ${remediation.version}`);
    continue;
  }
  const previousMetadata = await readJson(path.resolve(ROOT, previous.metadata));
  const masterPath = path.join(MASTER_ROOT, path.basename(source));
  const masterMetadataPath = path.join(MASTER_ROOT, "metadata", `${path.parse(masterPath).name}.json`);
  await copyFile(source, masterPath);
  const productionInputs = approval.masterInputs
    ? await Promise.all(approval.masterInputs.map(async (input) => ({
        ...input,
        sha256: sha256(await readFile(path.resolve(ROOT, input.path))),
      })))
    : previousMetadata.inputs;

  const frozen = {
    ...previousMetadata,
    subject: approval.subject || previousMetadata.subject,
    breed: approval.breed || previousMetadata.breed,
    inputs: productionInputs,
    version: remediation.version,
    status: "approved-frozen-master",
    provider: remediation.provider,
    model: remediation.model,
    endpoint: remediation.endpoint,
    prompt: remediation.prompt,
    revisedPrompt: remediation.revisedPrompt,
    orientation: remediation.orientation,
    requestedSize: remediation.requestedSize,
    outputSize: remediation.requestedSize,
    inputFidelity: remediation.inputFidelity,
    generatedAt: remediation.generatedAt,
    output: {
      path: remediation.output.finalPath,
      rawPath: remediation.output.rawPath,
      sha256: digest,
    },
    candidatePath: remediation.output.finalPath,
    masterPath: relativeToRoot(masterPath),
    masterSha256: digest,
    supersedes: {
      version: previousMetadata.version,
      path: previous.path,
      sha256: previous.sha256,
      metadata: previous.metadata,
    },
    remediationRequest: {
      ...remediation,
      status: "approved-and-promoted",
      approvedAt: APPROVED_AT,
    },
    approval: {
      state: "approved-and-frozen",
      approvedBy: "user",
      approvedAt: APPROVED_AT,
      note: approval.note,
    },
    review: {
      state: "approved-by-user",
      finalApproval: "approved",
      findings: [],
      approvedAt: APPROVED_AT,
    },
    runtimeReferenceContract: {
      endpoint: "/v1/images/edits",
      provider: "lingsuan",
      image1: {
        role: "self-owned-frozen-master",
        path: relativeToRoot(masterPath),
        sha256: digest,
      },
      image2: previousMetadata.runtimeReferenceContract?.image2 || { role: "user-pet-identity-only" },
      inputFidelity: "high",
      sceneChangeBudget: "0%",
      excludes: ["third-party-effect-reference", "previous-failed-candidate", "unapproved-candidate"],
    },
    qualityBaseline: {
      required: [
        ...approval.required,
        "exact 720x1280 portrait output without text, logo, watermark or signature",
      ],
      reject: [
        ...approval.reject,
        "logo, watermark or signature",
      ],
    },
  };
  await writeJson(masterMetadataPath, frozen);

  masterIndex.templates[indexAt] = {
    ...previous,
    version: remediation.version,
    path: relativeToRoot(masterPath),
    sha256: digest,
    metadata: relativeToRoot(masterMetadataPath),
    approvedAt: APPROVED_AT,
  };

  const masterStorageKey = `samples/image-templates/${approval.templateId}-${digest.slice(0, 12)}.png`;
  await pushLocalObject(body, masterStorageKey);
  if (approval.updatePublicPreview !== false) {
    const sampleStorageKey = `samples/image-template-previews/${approval.templateId}-${digest.slice(0, 12)}.png`;
    publicIndex.templates[previewAt] = {
      ...publicIndex.templates[previewAt],
      version: remediation.version,
      path: relativeToRoot(masterPath),
      sha256: digest,
      sampleStorageKey,
      sourceKind: "frozen-master-byte-fallback",
      publicVersion: "master-byte-fallback",
      masterSha256: digest,
    };
    await pushLocalObject(body, sampleStorageKey);
    publicIndexChanged = true;
  }
  console.log(`Promoted ${approval.templateId} ${remediation.version}`);
}

masterIndex.updatedAt = APPROVED_AT;
if (publicIndexChanged) publicIndex.updatedAt = APPROVED_AT;
await writeJson(MASTER_INDEX_PATH, masterIndex);
await writeJson(PUBLIC_INDEX_PATH, publicIndex);

const manifest = ["# kind\tstorage_key\tsource_path\tsha256"];
for (const item of masterIndex.templates) {
  manifest.push([
    "master",
    `samples/image-templates/${item.templateId}-${item.sha256.slice(0, 12)}.png`,
    item.path,
    item.sha256,
  ].join("\t"));
}
for (const item of publicIndex.templates) {
  manifest.push(["preview", item.sampleStorageKey, item.path, item.sha256].join("\t"));
}
await writeFile(DEPLOY_MANIFEST_PATH, `${manifest.join("\n")}\n`, "utf8");
console.log(`Updated deployment manifest: ${masterIndex.templates.length} masters / ${publicIndex.templates.length} previews`);
