import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { edit, generate, loadEnv } from "./client.mjs";
import { fit } from "./crop.mjs";

const root = path.resolve(import.meta.dirname, "../..");
const output = path.join(root, "tools/imagegen/out");
const sceneDir = path.join(output, "scenes");
const metaDir = path.join(output, "miniprogram-v3");
const ragdollReference = path.join(output, "scenes/identity-ragdoll-bicolor-v2.jpg");
const poodleReference = path.join(output, "scenes-v3/identity-gray-toy-poodle-v1.jpg");

const photoRules = [
  "Use case: photorealistic-natural editorial pet photography.",
  "Make this look like a real commissioned studio or lifestyle photograph, with real fur detail, believable fabric, physically plausible props, natural contact shadows and a real camera lens.",
  "One adult pet only, complete head and body visible, natural anatomy and paws, no people or hands, no duplicate subject.",
  "No brand marks, logos, copied magazine mastheads, readable text, pseudo-letters, watermark, signature, CGI, 3D render, illustration, plastic fur or surreal background.",
  "Vertical 3:4 composition. The pet is the clear hero and occupies about 45-65% of frame height; the set, clothing and props remain visible and recognizable.",
].join(" ");

const identity = "The exact same adult blue-bicolor Ragdoll cat as Image 1: broad rounded head, clean symmetric white inverted-V face blaze, pink nose, deep blue eyes, white chin/chest/legs/paws, blue-gray ears/back and long silky coat. Preserve the individual identity and healthy natural proportions. Do not turn it into a seal-point cat, Siamese, Birman or generic long-haired cat.";
const poodleIdentity = "The exact same adult gray toy poodle as Image 1: compact healthy toy-poodle build, charcoal-gray curly coat, round clipped muzzle with a lighter gray beard, floppy ears, dark eyes and black nose. Preserve the individual identity and natural proportions. Do not turn it into a schnauzer, doodle, terrier or plush toy.";

const scenes = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松", prompt: "A real bright bedroom set with a blue gingham duvet, pale blue pillows and a neatly made bed beneath a tall window. The cat wears a soft blue gingham sleep cap and matching tiny pajama collar, sitting in the bedding with a natural wide yawn. Morning window light, documentary lifestyle framing, tactile cotton and fur." },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇", prompt: "A real green studio set with a matte leafy-green backdrop, a knitted dinosaur hood and a large soft plush dinosaur beside the pet. The cat wears a simple green dinosaur hoodie and gently leans against the plush toy, looking toward camera with a curious innocent expression. Softbox light, visible floor contact and real textile texture." },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容", prompt: "A red-and-cream editorial photo studio with a folding canvas deck chair, a low wooden set edge and a few unbranded glass soda bottles as colorful props. The cat wears a mint pinstripe shirt and a turquoise necktie with a tiny plain metal pin, sitting upright and looking directly into the lens. Real fashion pet photography, balanced set design, no printed branding." },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想", prompt: "A real dark-blue theatrical studio with a deep blue floor, scattered paper stars, a small moon prop and a tiny plush fox in the foreground. The cat wears a knitted mint sweater, mustard scarf and a lightweight yellow cape, sitting naturally and gazing slightly upward. Gentle practical lights and a few distant pin lights, cinematic but photographic, no fantasy glow or text." },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑", prompt: "A saturated yellow tabletop studio with two fresh lemons on small stands, a red gingham head scarf and a yellow gingham bib placed naturally on the pet. The cat sits centered with a relaxed open-mouth expression, as if caught mid-laugh. Hard midday editorial light softened by a large diffuser, real skinless fabric and fruit texture, no hands." },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察", prompt: "A warm cream vintage photography corner with a brown corduroy jacket, silk neck scarf, tortoiseshell sunglasses resting correctly over the cat's eyes and a real compact film camera on the floor beside it. The cat lies with front paws crossed and looks calmly past the lens. Natural window light, period props, authentic pet fashion editorial, no readable labels." },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视", prompt: "A deep navy seamless editorial set with an orange-and-white over-ear headphone pair around the cat's neck, a pale blue striped shirt and a navy diagonal-striped tie. The cat sits in a confident three-quarter pose with a slightly open happy mouth, like a real magazine cover photograph, but leave the background entirely blank with no masthead or text." },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视", source: "poodle", revision: 4, prompt: "A timeless black-and-white film portrait on a pale gray seamless studio set. The gray toy poodle sits naturally in a small dark velvet bow tie, ears fully visible, looking slightly off-camera with a gentle expression. A real studio spotlight, soft contact shadow, visible textured floor and subtle silver-gelatin grain. No red props, deck chair, colored clothing or illustrations." },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸", prompt: "A clean rose-red and blush-pink studio gradient made from real seamless paper, with a small floor horizon and soft reflected light. The cat wears a lavender-blue striped shirt, a black tie with thin light stripes and oversized dark eyeglasses fitted naturally on its face. Three-quarter standing pose, friendly tongue just visible, realistic fashion portrait, no text." },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视", revision: 4, prompt: "A real outdoor garden portrait on a low picnic blanket, with a woven flower basket, loose daisies and a gingham ribbon in the foreground. The cat wears a simple pale linen collar with a tiny flower garland, sitting upright and gazing softly toward camera. Late-afternoon sunlight, real meadow depth and natural shadow, editorial rather than fantasy." },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步", prompt: "A real covered city arcade after rain, with a clear acrylic umbrella leaning against a column, wet stone reflections and a small yellow raincoat hanging on a low hook. The cat wears a simple mustard rain cape and carefully steps around a shallow puddle, looking down at the reflection. Natural overcast light, physically correct reflection, no signs or logos." },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带", revision: 4, prompt: "A real spring picnic studio-lifestyle scene with a blue checked blanket, woven basket, fabric ribbons, a small plush rabbit and flowering branches. The cat wears a light knitted vest and gently bats one ribbon with one front paw while watching it. Bright daylight, real cloth and basket weave, charming but fully photographic, no text." },
];

async function exists(file) { return access(file).then(() => true, () => false); }
async function save(file, metaFile, bytes, data) {
  await mkdir(path.dirname(file), { recursive: true });
  await mkdir(path.dirname(metaFile), { recursive: true });
  await writeFile(file, bytes);
  await writeFile(metaFile, `${JSON.stringify({ ...data, output: path.relative(root, file).replaceAll("\\", "/"), sha256: createHash("sha256").update(bytes).digest("hex"), review: "pending-visual-review" }, null, 2)}\n`);
}

const args = process.argv.slice(2);
const referenceOnly = args.includes("--reference-only");
const ids = args.filter((arg) => !arg.startsWith("--"));
if (ids.some((id) => !scenes.some((scene) => scene.id === id))) throw new Error("Unknown art photo scene ID");
const selected = ids.length ? scenes.filter((scene) => ids.includes(scene.id)) : scenes;
const config = await loadEnv();
await mkdir(sceneDir, { recursive: true });
await mkdir(metaDir, { recursive: true });

if (!await exists(ragdollReference)) throw new Error(`Missing reference: ${ragdollReference}`);

if (!await exists(poodleReference)) {
  const prompt = `${photoRules} A clear full-body breed reference photograph of one adult gray toy poodle standing naturally against a neutral light-gray studio background. ${poodleIdentity} No collar, clothing, props, text or watermark.`;
  const result = await generate(config, { prompt, size: "1200x1600", quality: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "card", { anchor: 0.42, quality: 90 });
  await save(poodleReference, path.join(metaDir, "identity-gray-toy-poodle-v1.json"), bytes, { id: "gray-toy-poodle-v1", group: "identity", prompt, provider: "lingsuan", model: config.model, reference: null });
  console.log("待审 identity/gray-toy-poodle-v1");
}

if (!referenceOnly) {
  for (const scene of selected) {
    const revision = scene.revision || 3;
    const file = path.join(sceneDir, `scene-${scene.id}-v${revision}.jpg`);
    const metadata = path.join(metaDir, `scenes-${scene.id}-v${revision}.json`);
    if (await exists(file) && await exists(metadata)) { console.log(`已存在 scenes/${scene.id}-v${revision}`); continue; }
    const reference = scene.source === "poodle" ? poodleReference : ragdollReference;
    const prompt = `${photoRules} ${scene.source === "poodle" ? poodleIdentity : identity} Scene and styling: ${scene.prompt} The clothing must fit the pet naturally and never hide its face or create human anatomy. Return one finished photograph only.`;
    const result = await edit(config, { imagePath: reference, prompt, size: "1200x1600", quality: "low", inputFidelity: "high", maxRetries: 1 });
    const bytes = await fit(result.buffer, "card", { anchor: 0.5, quality: 90 });
    await save(file, metadata, bytes, { id: scene.id, title: scene.title, description: scene.description, group: "scenes", prompt, provider: "lingsuan", model: config.model, reference: path.relative(root, reference).replaceAll("\\", "/"), referenceSha256: createHash("sha256").update(await readFile(reference)).digest("hex") });
    console.log(`待审 scenes/${scene.id}-v${revision}`);
  }
}

const dogSample = path.join(output, "plugins", "mp26-gray-toy-poodle-editorial-v1.jpg");
const dogMeta = path.join(metaDir, "plugins-gray-toy-poodle-editorial-v1.json");
if (!await exists(dogSample) || !await exists(dogMeta)) {
  const prompt = `${photoRules} ${poodleIdentity} A vivid red editorial studio set with a striped canvas deck chair and unbranded glass soda bottles. The gray toy poodle wears a pale mint pinstripe shirt and turquoise tie, sitting upright and looking straight at the camera with a gentle closed-mouth smile. Real fashion campaign photograph, full dog visible from ears to paws, no brand marks, no text.`;
  const result = await edit(config, { imagePath: poodleReference, prompt, size: "1600x1000", quality: "low", inputFidelity: "high", maxRetries: 1 });
  const bytes = await fit(result.buffer, "hero", { anchor: 0.5, quality: 90 });
  await save(dogSample, dogMeta, bytes, { id: "gray-toy-poodle-editorial-v1", group: "plugins", prompt, provider: "lingsuan", model: config.model, reference: "tools/imagegen/out/scenes-v3/identity-gray-toy-poodle-v1.jpg", referenceSha256: createHash("sha256").update(await readFile(poodleReference)).digest("hex") });
  console.log("待审 plugins/gray-toy-poodle-editorial-v1");
}

const interactiveSample = path.join(output, "plugins", "mp26-pl-15-photographic-v2.jpg");
const interactiveMeta = path.join(metaDir, "plugins-pl-15-photographic-v2.json");
if (!await exists(interactiveSample) || !await exists(interactiveMeta)) {
  const prompt = `${photoRules} A real studio photograph of one healthy adult red Shiba Inu sitting on a midnight-blue paper set. One front paw gently touches a small warm-white star-shaped LED light prop standing on the floor. Matte paper cloud cutouts and a few practical string lights form a clearly physical, handcrafted backdrop. The dog's anatomy, paw contact, red-and-cream fur and studio shadows are realistic. Bright enough to inspect the pet's face. No floating stars, no cartoon clouds, no CGI, no text, no interface.`;
  const result = await generate(config, { prompt, size: "1600x1000", quality: "low", maxRetries: 1 });
  const bytes = await fit(result.buffer, "hero", { anchor: 0.5, quality: 90 });
  await save(interactiveSample, interactiveMeta, bytes, { id: "pl-15-photographic-v2", group: "plugins", prompt, provider: "lingsuan", model: config.model, reference: null });
  console.log("待审 plugins/pl-15-photographic-v2");
}
