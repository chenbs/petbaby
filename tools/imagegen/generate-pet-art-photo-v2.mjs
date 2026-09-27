import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "tools/imagegen/out");
const sceneDir = path.join(output, "scenes");
const metaDir = path.join(output, "miniprogram-v2");
const reference = path.join(sceneDir, "identity-ragdoll-bicolor-v2.jpg");
const referenceMeta = path.join(metaDir, "identity-ragdoll-bicolor-v2.json");

const identity = "The same genuine adult blue bicolor Ragdoll cat as Image 1: broad rounded face, symmetric clean white inverted V across the face, pink nose, deep blue eyes, white chin/chest/front legs and paws, blue-gray ears/back/plume tail, long silky coat. Not a seal-point dark-faced cat, Siamese, Birman or Himalayan. Preserve this exact individual's face and markings.";
const framing = "Environmental editorial pet photograph, wide establishing view from several meters away. One full-body cat occupies about 30-40% of frame height and no more than 25% of image area; show the complete face, four paws and tail. The real location, architecture, surfaces and props occupy most of the frame and are sharp enough to recognize in a small mobile thumbnail. No close-up, studio-white void, heavy bokeh, cut-off head/paws, second animal, person, text, logo, watermark or extra limbs. Vertical 3:4 composition.";

const scenes = [
  { id: "window-morning", prompt: "A sunlit living room with an entire tall window, sheer curtains, woven rug and leafy trees clearly visible outside. The cat crouches on a low wide window bench watching birds outdoors, calm and focused, gaze toward the trees. Side view showing the room and window together." },
  { id: "garden-curious", prompt: "An abundant botanical flower garden with a winding stone path, flower beds and a pergola visible behind. The cat stands on the path, raises one front paw to sniff a flower, curious ears forward and eyes on the blossom. Wide garden view." },
  { id: "studio-confident", prompt: "An unmistakable vintage photography studio set with colored backdrop paper rolls, a low wooden stage, visible studio light and draped fabric. The cat walks up onto the low stage and looks back toward the camera with a confident alert expression. Show the whole set, not a seamless blank backdrop." },
  { id: "night-playful", prompt: "A real night courtyard with string lights, a stone footpath, low hedges and a narrow moving beam of light. The cat makes a small playful leap toward the light and turns its head to follow it, surprised and lively. Keep clear limb anatomy and visible courtyard depth." },
  { id: "seaside-breeze", prompt: "A sunny seaside wooden boardwalk with railings, wide coastline, waves and small sailboats in the distance. The cat stands securely on the boardwalk, tail blown slightly by the breeze, alert and relaxed, eyes looking toward the sea. Distinct horizon and beach context." },
  { id: "library-whisper", prompt: "A cozy independent bookstore with tall bookshelves, a visible aisle, step ladder and warm reading lamps. The cat peeks from around the end of a bookshelf, body partly stepping into the aisle, bright inquisitive eyes toward camera. Readable shop interior with no legible book text." },
  { id: "autumn-leaves", prompt: "An autumn park trail with rows of red maple trees, a winding path and fallen leaves covering the ground. The cat trots lightly through the leaves with all paws anatomically clear, excited eyes looking ahead. Wide view of the maple canopy and path." },
  { id: "snow-cabin", prompt: "A wooden cabin interior with a small fireplace, textured rug and a large window showing a snowy pine forest. The cat curls on a folded blanket on the rug, drowsy half-closed eyes and content expression. Show both cabin furnishings and outdoor snow." },
  { id: "cafe-afternoon", prompt: "An outdoor street-corner cafe terrace with an umbrella, two chairs, a small table and a lively but unlettered street facade. The cat sits safely on one low chair and turns its head to watch the street, relaxed and observant. Wide view of terrace and surroundings." },
  { id: "lakeside-sunset", prompt: "A wooden footbridge beside a lake at sunset, with reflective water, far mountains and a visible pink-orange sky. The cat stretches its front paws on the bridge, tail raised, eyes gently squinting in warm light, relaxed. The lake and bridge dominate the composition." },
  { id: "city-rain", prompt: "A covered city arcade just after rain, with repeating columns, shopfront silhouettes and puddle reflections on the stone walkway. The cat steps carefully around a shallow puddle and looks down at its reflection with mild surprise. Clear urban architecture and wet street." },
  { id: "spring-picnic", prompt: "A spring meadow picnic with a checked blanket, woven basket and flowering trees across the background. The cat stands beside the basket and gently bats a fabric ribbon with one paw, playful attentive eyes on the ribbon. The open meadow and picnic setup remain fully visible." },
];

async function exists(file) { return access(file).then(() => true, () => false); }
async function save(file, metaFile, bytes, data) {
  await writeFile(file, bytes);
  await writeFile(metaFile, `${JSON.stringify({ ...data, output: path.relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex"), review: "pending-visual-review" }, null, 2)}\n`);
}

const args = process.argv.slice(2);
const referenceOnly = args.includes("--reference-only");
const revision = Number(args.find((arg) => arg.startsWith("--revision="))?.split("=")[1] || 2);
if (!Number.isInteger(revision) || revision < 2) throw new Error("Invalid scene revision");
const ids = args.filter((arg) => !arg.startsWith("--"));
if (ids.some((id) => !scenes.some((scene) => scene.id === id))) throw new Error("Unknown art photo scene ID");
const selected = ids.length ? scenes.filter((scene) => ids.includes(scene.id)) : scenes;
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });

if (!await exists(reference)) {
  const prompt = `A clear natural-light full-body breed reference photograph of one genuine adult blue bicolor Ragdoll cat. Symmetrical white inverted V marking across the face, pink nose, white chin, chest, legs and paws, blue-gray ears/back and fluffy tail, large deep blue eyes, broad rounded head and soft semi-long silky coat. Standing in three-quarter view with all four paws and tail visible against a plain light gray background. True Ragdoll proportions, not a Siamese, Birman, Himalayan or dark-faced seal-point mix. No collar, person, text or props.`;
  const result = await generate(config, { prompt, size: "1200x1600", quality: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "card", { quality: 88 });
  await save(reference, referenceMeta, bytes, { id: "ragdoll-bicolor-v2", group: "identity", prompt, provider: "lingsuan", model: config.model, reference: null });
  console.log("待审 identity/ragdoll-bicolor-v2");
}
if (referenceOnly) process.exit(0);

for (const scene of selected) {
  const file = path.join(sceneDir, `scene-${scene.id}-v${revision}.jpg`);
  const metadata = path.join(metaDir, `scenes-${scene.id}-v${revision}.json`);
  if (await exists(file) && await exists(metadata)) { console.log(`已存在 scenes/${scene.id}-v${revision}`); continue; }
  const scaleCorrection = revision >= 3 && ["lakeside-sunset", "spring-picnic"].includes(scene.id)
    ? "For this frame move the camera farther back: the cat's full body including its tail must fit within at most 35% of image height. The cat is a small but recognizable subject in the lower middle distance. Preserve generous uninterrupted views of the bridge and lake or meadow and picnic setting."
    : "";
  const prompt = `${identity} ${framing} ${scaleCorrection} Scene, action and expression: ${scene.prompt}`;
  const result = await edit(config, { imagePath: reference, prompt, size: "1200x1600", quality: "low", inputFidelity: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 88 });
  await save(file, metadata, bytes, { id: scene.id, group: "scenes", prompt, provider: "lingsuan", model: config.model, reference: "tools/imagegen/out/scenes/identity-ragdoll-bicolor-v2.jpg", referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex") });
  console.log(`待审 scenes/${scene.id}-v${revision}`);
}
