/** Rebuild pet-runway v04 with the user-requested upright runway posture. */
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, loadEnv } from "./client.mjs";
import { dimensions, fit, hasUsableVisualContent } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const RAW = path.join(CANDIDATES, "raw");
const META = path.join(REFERENCE_ROOT, "metadata");
const EFFECT = path.join(ROOT, "apps", "website", "public", "assets", "example", "1786368555480.png");
const V03 = path.join(CANDIDATES, "pet-runway_maine-coon-cat_9x16_v03.png");
const IDENTITY = path.join(ROOT, "apps", "website", "public", "assets", "work-maine.jpg");
const OUTPUT = path.join(CANDIDATES, "pet-runway_maine-coon-cat_9x16_v04.png");
const RAW_OUTPUT = path.join(RAW, "pet-runway_maine-coon-cat_9x16_v04.png");
const METADATA = path.join(META, "pet-runway_maine-coon-cat_9x16_v04.json");
const V03_METADATA = path.join(META, "pet-runway_maine-coon-cat_9x16_v03.json");
const FORCE = process.argv.includes("--force");
const WIDTH = 720;
const HEIGHT = 1280;

const prompt = [
  "Use case: compositing and identity-preserving full-body posture transfer. Create a vertical 9:16 premium pet runway master candidate at exactly 720x1280 pixels from exactly three input images.",
  "Image 1 is the immutable authority for scene, composition, upright posture and outfit. Preserve its centred runway, dark blurred audience on both sides, grey spotlight backdrop, frontal full-body fashion framing, camera height, lighting, walking momentum and restrained premium fashion-photography finish. Preserve the recognisable layered outfit: oversized light-grey wool coat, cream cable-knit layer, charcoal patterned neck scarf and pale sage wide-leg draped lower garment. Keep the same vertical silhouette, garment lengths, materials, palette and runway placement.",
  "Replace only the dog in Image 1 with the exact adult Maine Coon established by Images 2 and 3. The new Maine Coon must stand fully upright on its two hind legs in a confident forward runway step, with a clearly vertical torso and head above the shoulders, matching Image 1's upright anthropomorphic walk. Do not make the cat quadrupedal, crouched, seated or horizontally bodied.",
  "Image 2 is the authority for the accepted appealing Maine Coon face and finished cat rendering. Preserve its friendly golden eyes, relaxed confident expression, soft square muzzle, brown-black classic tabby markings, tall lynx-tipped ears, full neck ruff and large fluffy tail. Keep this face recognisably the same and immediately likeable.",
  "Image 3 is identity-only confirmation. Preserve the same adult Maine Coon breed, sturdy mature build, coat pattern, ear tufts, facial proportions and full tail. Do not import Image 3's plain studio background or alter the runway lighting.",
  "Adapt the outfit naturally to feline anatomy while keeping Image 1's exact fashion silhouette. The upper coat may cover the forelegs or allow two short fur-covered feline forepaws to emerge naturally; never create human hands, fingers or bare human arms. The pale sage lower garment must drape around two separate upright hind legs, ending above two visible feline hind paws in a believable runway step. Keep the full tail attached naturally and visible behind the coat without fusion.",
  "The result should be anthropomorphic in posture but unmistakably an adult Maine Coon, not a human body with a pasted cat head. Keep a sturdy, elegant, healthy build and natural adult head-to-body ratio. Do not make the cat skinny, elongated, elderly, stern, chibi, kitten-like, oversized-headed or uncanny.",
  "Change no background, audience, runway, spotlight, crop, colour palette, garment materials or fashion mood. Exactly one pet. No extra limbs, duplicate paws, fused tail, malformed clothing boundary, human face, human hand, logo, readable brand, platform UI, watermark or signature."
].join(" ");

async function exists(file) {
  try { await access(file); return true; } catch { return false; }
}

function sha256(body) {
  return createHash("sha256").update(body).digest("hex");
}

function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

for (const input of [EFFECT, V03, IDENTITY, V03_METADATA]) {
  if (!await exists(input)) throw new Error(`Missing input: ${input}`);
}
if (!FORCE && await exists(OUTPUT)) throw new Error(`${OUTPUT} already exists; use --force only to replace v04 intentionally`);

await mkdir(CANDIDATES, { recursive: true });
await mkdir(RAW, { recursive: true });
await mkdir(META, { recursive: true });

const inputBodies = await Promise.all([EFFECT, V03, IDENTITY].map((file) => readFile(file)));
const config = await loadEnv();
const result = await edit(config, {
  imagePaths: [EFFECT, V03, IDENTITY],
  prompt,
  size: `${WIDTH}x${HEIGHT}`,
  quality: "high",
  outputFormat: "png",
  inputFidelity: "high"
});
const final = await fit(result.buffer, "portrait", { anchor: 0.5, format: "png" });
const actual = await dimensions(final);
if (actual.width !== WIDTH || actual.height !== HEIGHT) throw new Error(`v04 is ${actual.width}x${actual.height}`);
if (!await hasUsableVisualContent(final)) throw new Error("v04 has no usable visual content");

await writeFile(RAW_OUTPUT, result.buffer);
await writeFile(OUTPUT, final);
await writeFile(METADATA, `${JSON.stringify({
  templateId: "pet-runway",
  title: "宠物时装周",
  entryId: "career",
  status: "master-candidate-pending-user-approval",
  subject: "maine-coon-cat",
  breed: "缅因猫",
  revision: {
    version: "v04",
    sourceVersion: "v03",
    reviewFinding: "用户要求恢复原效果图中的直立走秀姿态；v03 的四足化方向不再采用。",
    scope: "upright-full-body-posture-rebuild"
  },
  provider: "lingsuan",
  model: config.model,
  endpoint: "/v1/images/edits",
  inputs: [
    { role: "third-party-effect-reference-upright-pose-and-scene-authority", path: relativeToRoot(EFFECT), sha256: sha256(inputBodies[0]) },
    { role: "v03-accepted-face-and-maine-coon-rendering-reference", path: relativeToRoot(V03), sha256: sha256(inputBodies[1]) },
    { role: "pet-identity-reference", path: relativeToRoot(IDENTITY), sha256: sha256(inputBodies[2]) }
  ],
  runtimeThirdPartyEffectReferenceIncluded: false,
  inputFidelity: "high",
  orientation: "portrait",
  requestedSize: `${WIDTH}x${HEIGHT}`,
  outputSize: `${actual.width}x${actual.height}`,
  quality: "high",
  prompt,
  revisedPrompt: result.revisedPrompt || null,
  review: {
    state: "pending-manual-precheck",
    checks: {
      petIdentity: "pending",
      cuteness: "pending",
      uprightPosture: "pending",
      effectComposition: "pending",
      anatomy: "pending",
      textAndRights: "pending",
      dimensions: "pass"
    },
    findings: [],
    finalApproval: "pending-user"
  },
  generatedAt: new Date().toISOString(),
  output: { path: relativeToRoot(OUTPUT), sha256: sha256(final) },
  rawOutput: { path: relativeToRoot(RAW_OUTPUT), sha256: sha256(result.buffer) }
}, null, 2)}\n`, "utf8");

const previous = JSON.parse(await readFile(V03_METADATA, "utf8"));
previous.status = "revision-required";
previous.review = {
  state: "revision-required-by-user",
  finalApproval: "revision-required",
  reviewedAt: new Date().toISOString(),
  findings: ["The user wants the Maine Coon to retain the effect reference's upright runway posture; v03 is quadrupedal."]
};
previous.supersededBy = relativeToRoot(OUTPUT);
await writeFile(V03_METADATA, `${JSON.stringify(previous, null, 2)}\n`, "utf8");

console.log(`Generated upright pet-runway v04: ${relativeToRoot(OUTPUT)}`);
