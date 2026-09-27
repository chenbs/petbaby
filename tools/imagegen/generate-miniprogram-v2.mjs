import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const OUTPUT = path.join(ROOT, "tools/imagegen/out");
const META = path.join(OUTPUT, "miniprogram-v2");
const SOURCE = path.join(OUTPUT, "model/front.jpg");
const RAGDOLL_SOURCE = path.join(OUTPUT, "website/work-ragdoll.jpg");
const SHARED = [
  "Premium contemporary pet product campaign image for a Chinese pet memories app.",
  "Bright, clean, vivid but restrained color, natural expressive animal anatomy, crisp face and eyes, tactile material detail.",
  "The subject and actual finished product must be immediately legible at small mobile thumbnail size.",
  "No readable text, letters, numbers, watermark, logo, UI screenshot, fake interface or extra limbs.",
].join(" ");

const jobs = [
  { id: "pet-id-card", group: "plugins", ratio: "hero", anchor: 0.5, prompt: "A collectible pet identity card lying flat on a pale mint studio tabletop, whole physical card visible, a joyful small orange tabby portrait in the photo window, neat empty label rows and a tiny embossed paw seal, refined print finish, top-down editorial product photography." },
  { id: "pet-movie-poster", group: "plugins", ratio: "hero", anchor: 0.5, revision: 3, prompt: "Photograph of one complete vertically framed pet movie poster mounted on a clean coral gallery wall. Inside the printed poster a single corgi stands with all four paws on a sunlit city pavement like the lead of a warm adventure film. Clear theatrical lighting, deliberate empty title area, subtle unlettered credits strip, visible premium paper and full frame edges. The animal must be grounded and anatomically natural." },
  { id: "pet-time-album", group: "plugins", ratio: "hero", anchor: 0.5, prompt: "An open printed pet photo album on a light table, the same silver tabby cat appearing in three believable everyday moments across the spread, subtle dates represented only by blank editorial rules, creamy paper, daylight, fully visible two-page object." },
  { id: "pl-10", group: "plugins", ratio: "hero", anchor: 0.5, prompt: "A framed fine-art pet portrait as a finished artwork on a white gallery wall, one expressive black-and-white border collie in a confident fashion-editorial pose, painterly yet anatomically natural, fresh cobalt and blush accents, entire frame visible." },
  { id: "pl-15", group: "plugins", ratio: "hero", anchor: 0.5, prompt: "A still from a pet interactive sky garden, a single shiba inu reaches one paw toward a small cluster of luminous stars among pale mint sculptural clouds, readable sense of touch, bright premium 3D editorial illustration, scene fills the image without UI elements." },
  { id: "pl-19", group: "plugins", ratio: "hero", anchor: 0.5, prompt: "A cinematic frame from a pet memories film, a joyful golden retriever in motion through a sunlit home, gentle fabric movement and realistic paws, rich warm film color, clear expressive face, looks like an actual finished video still, no fake playback controls." },
  { id: "pl-23", group: "plugins", ratio: "hero", anchor: 0.5, revision: 4, reference: true, prompt: "Landscape 16:10 editorial two-photo growth comparison of the EXACT SAME orange-and-white tabby cat in the supplied photograph. Left: that cat as a kitten; right: that cat as an adult. Both animals fully visible from ears to paws, generous clear headroom, same orange stripes, white muzzle, chest and right forepaw, same eye color. Two believable home photographs divided by a fine line. No other cats, no text." },
  { id: "window-morning", group: "scenes", ratio: "card", anchor: 0.36, revision: 1, source: "ragdoll", prompt: "Create a premium pet art photograph using the supplied ragdoll cat as the exact identity reference. Scene: a bright morning window with sheer curtains and warm natural light. Action: the cat sits with front paws tucked and turns its body toward the window while looking outside. Expression: calm, relaxed, quietly attentive. Frame as a half-body environmental portrait with clean negative space, tactile fur and natural anatomy. Preserve the ragdoll's blue eyes, dark point mask, long cream fur, face, species and healthy body." },
  { id: "garden-curious", group: "scenes", ratio: "card", anchor: 0.36, revision: 1, source: "ragdoll", prompt: "Create a premium pet art photograph using the supplied ragdoll cat as the exact identity reference. Scene: a sunlit botanical garden with leaves and soft side light. Action: the cat leans forward and raises one front paw while sniffing a small flower. Expression: curious, ears forward, eyes focused on the flower. Frame a clear medium full-body composition so the lifted paw and contact with the garden are readable. Preserve the ragdoll's blue eyes, dark point mask, long cream fur, face, species and healthy body." },
  { id: "studio-confident", group: "scenes", ratio: "card", anchor: 0.36, revision: 1, source: "ragdoll", prompt: "Create a premium pet art photograph using the supplied ragdoll cat as the exact identity reference. Scene: a warm ivory seamless studio backdrop with one large softbox. Action: the cat sits squarely facing the camera, chest open, tail resting naturally on the floor. Expression: confident and focused, direct eye contact. Use a clean symmetrical three-quarter portrait with crisp edges and no props. Preserve the ragdoll's blue eyes, dark point mask, long cream fur, face, species and healthy body." },
  { id: "night-playful", group: "scenes", ratio: "card", anchor: 0.36, revision: 1, source: "ragdoll", prompt: "Create a premium pet art photograph using the supplied ragdoll cat as the exact identity reference. Scene: a deep blue night set with a reflective floor and one moving pool of light. Action: the cat makes a small playful leap and turns its head back toward the light, all four limbs anatomically coherent. Expression: surprised and joyful, eyes tracking the light. Use a low camera angle and leave directional space ahead of the motion. Preserve the ragdoll's blue eyes, dark point mask, long cream fur, face, species and healthy body." },
  { id: "portrait", group: "plays", ratio: "card", anchor: 0.36, revision: 4, prompt: "Create a finished original fine-art pet portrait of a silver British Shorthair cat, visibly painted with confident expressive brushwork on textured canvas. Show the canvas itself in a slim natural-wood frame against a bright white gallery wall, frame edges fully visible. A clear commissioned artwork, not a regular photograph, and no orange tabby." },
  { id: "storybook", group: "plays", ratio: "card", anchor: 0.36, revision: 3, prompt: "Create one finished children's picture-book page with a golden retriever puppy as the clear main character stepping through a tiny sunny garden with a curious expression, tasteful gouache and paper texture, visually complete story scene, no words. The dog must be fully visible and clearly a golden retriever, not a cat." },
  { id: "magazine", group: "plays", ratio: "card", anchor: 0.36, revision: 4, prompt: "A complete printed luxury pet fashion magazine cover featuring a black-and-white Maine Coon cat as its unmistakable star, photographed on a bright mint-and-coral studio set. Show visible paper cover edges, a blank unlettered masthead band and a few intentional unlettered editorial rules. It must read as a physical magazine cover at thumbnail size, not a plain cat portrait; no orange tabby." },
];

async function exists(file) {
  return access(file).then(() => true, () => false);
}

const ids = process.argv.slice(2);
const selected = ids.length ? jobs.filter((job) => ids.includes(job.id)) : jobs;
if (ids.some((id) => !jobs.some((job) => job.id === id))) throw new Error("Unknown Mini Program asset ID");
const config = await loadEnv();
await mkdir(path.join(META, "raw"), { recursive: true });

for (const job of selected) {
  const suffix = job.revision ? `-v${job.revision}` : "";
  const file = job.group === "plugins"
    ? path.join(OUTPUT, "plugins", `mp26-${job.id}${suffix}.jpg`)
    : path.join(OUTPUT, job.group === "scenes" ? "scenes" : "styles", `${job.group === "scenes" ? "scene" : "play"}-${job.id}-${suffix ? suffix.slice(1) : "v2"}.jpg`);
  const raw = path.join(META, "raw", `${job.group}-${job.id}${suffix}.png`);
  const metadata = path.join(META, `${job.group}-${job.id}${suffix}.json`);
  if (await exists(file) && await exists(metadata)) {
    console.log(`已存在 ${job.group}/${job.id}`);
    continue;
  }
  const prompt = `${SHARED} ${job.prompt}`;
  const isGenerated = (job.group === "plugins" && !job.reference) || job.group === "plays";
  let rawBytes;
  if (await exists(raw)) rawBytes = await readFile(raw);
  else {
    const result = isGenerated
      ? await generate(config, { prompt, size: "1600x1000", quality: "low", maxRetries: 1 })
      : await edit(config, { imagePath: job.source === "ragdoll" ? RAGDOLL_SOURCE : SOURCE, prompt, size: job.ratio === "hero" ? "1600x1000" : "1200x1600", quality: "low", maxRetries: 1 });
    rawBytes = result.buffer;
    await writeFile(raw, rawBytes);
  }
  const output = await fit(rawBytes, job.ratio, { anchor: job.anchor, quality: 88 });
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, output);
  await writeFile(metadata, `${JSON.stringify({
    id: job.id, group: job.group, prompt, provider: "lingsuan", model: config.model,
    reference: isGenerated ? null : job.source === "ragdoll" ? "tools/imagegen/out/website/work-ragdoll.jpg" : "tools/imagegen/out/model/front.jpg",
    output: path.relative(ROOT, file).replaceAll("\\", "/"),
    sha256: createHash("sha256").update(output).digest("hex"),
    review: "pending-visual-review",
  }, null, 2)}\n`);
  console.log(`待审 ${job.group}/${job.id}`);
}
