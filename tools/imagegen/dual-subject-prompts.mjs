import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");

export const ownerReferences = [
  { id: "owner-f01", label: "authorized adult woman 01", path: path.join(ROOT, "tools/imagegen/out/source/girl-sample.png") },
  { id: "owner-f02", label: "authorized adult woman 02", path: path.join(ROOT, "tools/imagegen/out/source/girl-sample2.png") },
  { id: "owner-m01", label: "authorized adult man 01", path: path.join(ROOT, "tools/imagegen/out/source/boy-sample.png") },
  { id: "owner-m02", label: "authorized adult man 02", path: path.join(ROOT, "tools/imagegen/out/source/boy-sample2.png") }
];

export const stabilityPets = [
  { id: "black-cat", label: "adult black cat", path: path.join(ROOT, "tools/imagegen/out/source/cat-black.jpg") },
  { id: "british-shorthair-cat", label: "adult blue British Shorthair cat", path: path.join(ROOT, "tools/imagegen/out/source/cat-british.jpg") },
  { id: "golden-retriever-dog", label: "adult Golden Retriever", path: path.join(ROOT, "tools/imagegen/out/source/dog-golden.jpg") },
  { id: "corgi-dog", label: "adult Pembroke Welsh Corgi", path: path.join(ROOT, "tools/imagegen/out/source/dog-corgi.jpg") },
  { id: "husky-dog", label: "adult Siberian Husky", path: path.join(ROOT, "tools/imagegen/out/source/dog-husky.jpg") }
];

const masterPets = {
  "tuxedo-cat": { id: "tuxedo-cat", label: "adult black-and-white tuxedo cat", path: path.join(ROOT, "tools/imagegen/out/source/cat-tuxedo.jpg") },
  "cream-cat": { id: "cream-cat", label: "adult cream long-haired cat", path: path.join(ROOT, "tools/imagegen/out/source/cat-cream.jpg") },
  "shiba-dog": { id: "shiba-dog", label: "adult red Shiba Inu", path: path.join(ROOT, "tools/imagegen/out/source/dog-shiba.jpg") },
  "husky-dog": { id: "husky-dog", label: "adult Siberian Husky", path: path.join(ROOT, "tools/imagegen/out/source/dog-husky.jpg") }
};

export const dualSubjectJobs = [
  {
    id: "fish-chase",
    title: "偷鱼大作战",
    version: "v02",
    entryId: "together",
    owner: ownerReferences[0],
    pet: masterPets["tuxedo-cat"],
    effectReference: path.join(ROOT, "apps/website/public/assets/example/1.png"),
    anchor: 0.5,
    scene: "the exact bustling outdoor market street, stalls, awnings, daylight, flying papers and small debris, deep background perspective and lively accidental-chaos atmosphere",
    composition: "the exact extreme low ultra-wide fisheye chase composition: the pet's face fills the immediate lower-right foreground, comically stretched toward the lens while holding one complete small fish naturally in its mouth; both pet eyes are exceptionally large, round and startled with a frantic guilty expression; the owner runs in the middle background reaching desperately toward the pet with tightened angry brows, eyes locked on the pet and mouth opened wide in an urgent alarmed shout",
    style: "the exact energetic cinematic photographic treatment, unmistakably strong fisheye distortion around the foreground face, crisp readable eyes and owner expression, subtle motion blur away from both faces, natural colour balance and physical lighting",
    clothing: "Preserve the reference owner's complete street outfit, footwear and accessories. Only make the minimum tailoring adjustment needed to fit the new owner's adult body; do not redesign or remove the clothes.",
    text: "Preserve any native environmental text placement when it remains readable and scene-appropriate. Do not add platform UI, logos, watermarks or signatures.",
    failureChecks: ["owner-behind-pet", "one-complete-fish", "mouth-fish-boundary", "extreme-fisheye-action", "large-round-startled-pet-eyes", "urgent-angry-open-mouth-owner", "one-owner-one-pet"]
  },
  {
    id: "garden-together",
    title: "和你在花园",
    version: "v01",
    entryId: "together",
    owner: ownerReferences[1],
    pet: masterPets["cream-cat"],
    effectSource: path.join(ROOT, "apps/website/public/assets/example/2.png"),
    effectReference: path.join(REFERENCE_ROOT, "dual-subject/guides/garden-together-effect-9x16.png"),
    anchor: 0.45,
    scene: "the exact lush rain-fresh garden floor, mossy stone path, dense green leaves, warm sun shafts, floating moisture and softly glowing natural foliage",
    composition: "the exact intimate high-angle overhead composition: the owner kneels and looks naturally up toward the camera while one hand gently touches the pet's head or chin; the relaxed pet stands close against the owner in the same location, direction and scale",
    style: "the exact dreamy but photographic garden portrait, soft dappled light, restrained natural greens, warm skin and fur tones, shallow atmospheric depth and fine believable texture",
    clothing: "Preserve the reference owner's light garden outfit and its silhouette. Only make the minimum fit or colour adjustment needed for the new owner; do not remove the clothing or invent a new costume.",
    text: "Do not add captions, platform UI, logos, watermarks or signatures.",
    failureChecks: ["natural-hand-pet-contact", "overhead-gaze", "credible-owner-pet-scale", "garden-scene-lock", "one-owner-one-pet"]
  },
  {
    id: "street-comic-together",
    title: "潮流漫画合照",
    version: "v01",
    entryId: "together",
    owner: ownerReferences[2],
    pet: masterPets["shiba-dog"],
    effectReference: path.join(ROOT, "apps/website/public/assets/example/16.png"),
    anchor: 0.42,
    scene: "the exact compact street-culture collage with saturated navy, coral, cyan and warm yellow panels, bold stickers, halftone dots, action marks, layered props and tight poster depth",
    composition: "the exact dynamic close selfie-jump composition: the owner's foreshortened sneaker reaches toward the lower foreground, one hand makes the same camera-facing gesture, and the pet jumps joyfully beside the owner at the same scale with both subjects looking lively and connected",
    style: "the exact polished contemporary comic-cover illustration, clean expressive linework, cel-painted faces and fur, controlled halftone texture, readable silhouettes and youthful editorial energy",
    clothing: "Preserve the oversized pink streetwear outfit, sneaker silhouette and accessories. Tailor them naturally to the new adult owner while keeping the same colour family, pose and movement.",
    text: "Preserve the reference's text density, sticker positions and typography rhythm, but replace any brand-like wording with short original copy such as 'PET DAY OUT', 'GOOD DAYS' and 'WOW!'. No platform UI, watermark or signature.",
    failureChecks: ["both-subjects-illustrated", "owner-face-identity", "pet-face-identity", "foreshortened-sneaker", "one-owner-one-pet"]
  },
  {
    id: "night-together",
    title: "夜间宠物合影",
    version: "v01",
    entryId: "together",
    owner: ownerReferences[3],
    pet: masterPets["husky-dog"],
    effectReference: path.join(ROOT, "apps/website/public/assets/example/1786369158880.png"),
    anchor: 0.5,
    scene: "the exact ordinary nighttime paved walkway, dark open surroundings, sparse ambient street lighting and unpolished real-life phone-photo atmosphere",
    composition: "the exact steep high-angle snapshot: the large pet sits on the left looking up with a cheerful open-mouth expression while the crouching owner stays on the right, looks up at the phone camera and makes the same V hand gesture; preserve their spacing, grounded shadows and believable scale",
    style: "the exact candid night smartphone photography, restrained colour, moderate sensor noise, clear recognisable faces, believable local flash or street light and no cinematic restaging",
    clothing: "Preserve the grey hoodie, black trousers and casual shoes. Only adjust their fit to the new adult owner; do not redesign the outfit.",
    text: "Do not add captions, platform UI, logos, watermarks or signatures.",
    failureChecks: ["owner-right-pet-left", "high-angle-snapshot", "owner-v-gesture", "adult-large-pet", "one-owner-one-pet"]
  }
];

function sharedIdentityRules() {
  return [
    "Image 2 is the only owner identity reference. Preserve that exact adult person's face, facial proportions, hair, gender presentation and adult age. It contributes no pose, hand gesture, clothing, camera, scene, light or style.",
    "Image 3 is the only pet identity reference. Preserve that exact pet's species, breed, coat colours, markings, face, eye colour, ear shape, muzzle, fur length and healthy adult proportions. It contributes no pose, camera, scene, light or style.",
    "Never reuse either original subject identity from Image 1. Transfer Image 1's complete pose, gaze, facial expression, action, body direction, contact points, scale and visual treatment onto the two new identities from Images 2 and 3.",
    "Keep both new subjects recognisable, attractive and immediately likeable in a contemporary young aesthetic, without obvious age regression. Do not turn an adult owner into a child or an adult pet into a puppy or kitten. Do not make either subject gaunt, oddly thin, aged, uncanny or physically distorted.",
    "Exactly one owner and one pet. Never swap, merge, duplicate or blend their identities. No extra person, face, pet, head, hand, finger, paw, limb or tail. Keep all anatomy, contacts and occlusions physically coherent."
  ];
}

export function buildDualMasterPrompt(job) {
  return [
    "Use case: compositing and identity-preserve. Create a vertical 9:16 self-owned master candidate from exactly three input images. The final delivered asset will be exactly 720x1280 pixels.",
    "Image 1 is the effect reference and has highest priority for every non-identity visual decision. Keep a strict 0% scene-change budget: preserve its background, environment, camera position, lens, crop, composition, subject placement, action timing, expression, gaze, hand and paw placement, lighting, colour balance, medium, brushwork or photographic texture, clothing, landmarks, unique props and text layout. Change only the two subject identities and the minimum physical fit around their different bodies.",
    ...sharedIdentityRules(),
    `Scene lock: ${job.scene}.`,
    `Composition and action lock: ${job.composition}.`,
    `Visual treatment lock: ${job.style}.`,
    job.clothing,
    job.text
  ].join(" ");
}

export function buildDualRuntimePrompt(job) {
  return [
    "Use case: compositing and identity-preserve. Create a vertical 9:16 result from exactly three input images. The final delivered asset will be exactly 720x1280 pixels.",
    "Image 1 is the self-owned frozen visual master and has highest priority for every non-identity decision. Preserve its complete scene, background, camera, lens, crop, composition, subject placement, action, expressions, lighting, colour balance, visual medium, clothing, props and text layout with a strict 0% scene-change budget.",
    "Image 2 is the only new owner identity reference. Image 3 is the only new pet identity reference. Replace both subjects already present in Image 1; do not retain, average or blend either old identity from the master.",
    ...sharedIdentityRules().slice(0, 2),
    "Transfer Image 1's exact owner pose, expression, gaze, hand gesture and clothing onto the new owner, and its exact pet pose, expression, action and prop contacts onto the new pet. Make only minimum tailoring changes required by the new bodies.",
    "Exactly one owner and one pet. Never swap, merge, duplicate or blend their identities. No extra person, face, pet, head, hand, finger, paw, limb or tail. Keep all anatomy, contacts and occlusions physically coherent.",
    `Scene lock: ${job.scene}.`,
    `Composition and action lock: ${job.composition}.`,
    `Visual treatment lock: ${job.style}.`,
    job.clothing,
    job.text
  ].join(" ");
}

export function dualMasterBasename(job) {
  return `${job.id}_${job.owner.id}_${job.pet.id}_9x16_${job.version}`;
}

export function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}
