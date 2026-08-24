import path from "node:path";

import { outputSpecs } from "./reference-template-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");

const identities = {
  "british-shorthair-cat": {
    species: "cat",
    breed: "adult blue British Shorthair cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-british.jpg"),
    identity: "its solid blue-grey coat, broad round adult face, amber eyes, small upright ears, plush dense fur, thick tail and sturdy natural body"
  },
  "corgi-dog": {
    species: "dog",
    breed: "adult Pembroke Welsh Corgi",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-corgi.jpg"),
    identity: "its tan-and-white coat, broad white blaze, white muzzle and chest, dark eyes, large upright ears, short legs and compact sturdy adult body"
  },
  "cream-longhair-cat": {
    species: "cat",
    breed: "adult cream long-haired cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-cream.jpg"),
    identity: "its pale cream long coat, soft cream points, blue eyes, pink nose, triangular ears, fluffy tail and full healthy adult body"
  },
  "husky-dog": {
    species: "dog",
    breed: "adult grey-and-white Siberian Husky",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-husky.jpg"),
    identity: "its symmetrical grey cap, broad white facial blaze, white muzzle and chest, ice-blue eyes, upright triangular ears and athletic adult double-coated body"
  },
  "black-cat": {
    species: "cat",
    breed: "adult black domestic shorthair cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-black.jpg"),
    identity: "its solid glossy black coat without white patches, vivid green eyes, black nose, upright ears and compact healthy adult body"
  },
  "golden-retriever-dog": {
    species: "dog",
    breed: "adult Golden Retriever",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-golden.jpg"),
    identity: "its warm golden coat, floppy feathered ears, dark friendly eyes, broad soft muzzle and full healthy adult retriever build"
  },
  "tuxedo-cat": {
    species: "cat",
    breed: "adult black-and-white tuxedo cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-tuxedo.jpg"),
    identity: "its black ears and crown, narrow white facial blaze, white muzzle and chest, pale green eyes, pink nose, black back and white forelegs"
  },
  "german-shepherd-dog": {
    species: "dog",
    breed: "adult German Shepherd",
    path: path.join(ROOT, "apps/website/public/assets/hero-shepherd.jpg"),
    identity: "its tan coat with a defined black saddle and mask, brown eyes, tall upright ears, black muzzle and athletic healthy adult build"
  },
  "ragdoll-cat": {
    species: "cat",
    breed: "adult seal-point Ragdoll cat",
    path: path.join(ROOT, "apps/website/public/assets/work-ragdoll.jpg"),
    identity: "its warm cream long coat, dark seal face and ears, blue-grey eyes, full neck ruff and healthy natural adult proportions"
  },
  "shiba-dog": {
    species: "dog",
    breed: "adult red Shiba Inu",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-shiba.jpg"),
    identity: "its red-and-cream coat, cream cheeks and chest, dark almond eyes, triangular upright ears, curled tail and compact sturdy adult body"
  },
  "abyssinian-cat": {
    species: "cat",
    breed: "adult ruddy Abyssinian cat",
    path: path.join(ROOT, "apps/website/public/assets/work-abyssinian.jpg"),
    identity: "its warm ruddy ticked coat, darker forehead markings, large upright ears, golden almond eyes, terracotta nose and elegant healthy adult body"
  },
  "toy-poodle-dog": {
    species: "dog",
    breed: "adult apricot Toy Poodle",
    path: path.join(ROOT, "apps/website/public/assets/avatar-poodle.jpg"),
    identity: "its warm apricot tight curls, round dark eyes, small dark nose, rounded teddy-bear muzzle, floppy curly ears and compact healthy adult body"
  }
};

const templates = [
  {
    id: "exaggerated-expression",
    title: "夸张表情头像",
    master: "exaggerated-expression_ragdoll-cat_9x16_v02.png",
    anchor: 0.5,
    core: "the off-white paper background, extreme close portrait crop, tilted head, oversized silly eyes, broad toothy grin, asymmetrical comic energy and chest filling the lower frame",
    action: "Replicate the master's exact head tilt, gaze direction, eye openness, eyebrow energy, mouth opening, grin curve and visible small teeth. The expression must remain funny and lovable, never aggressive or frightening.",
    style: "Every part of the replacement pet, especially the face, eyes, nose, mouth, teeth and fur, must use the master's hand-drawn dry-brush illustration: loose black contour lines, scratchy broken strokes, flat painterly colour blocks and visible paper gaps. Image 2 must not introduce photographic fur, glassy realistic eyes, smooth 3D shading or a pasted photo face.",
    clothing: "No clothing or added prop.",
    text: "Keep the image free of text, logos, watermarks and signatures."
  },
  {
    id: "landmark-adventure",
    title: "环球地标与户外探险",
    master: "landmark-adventure_abyssinian-cat_9x16_v01.png",
    anchor: 0.5,
    core: "the bright Paris daytime setting, Eiffel Tower at rear left, close ultra-wide selfie perspective, extended foreground paw, blue sky, black beret, round landmark-reflecting sunglasses and red-and-white striped shirt",
    action: "Replicate the master's exact cheerful open-mouth smile, selfie gaze, head angle and single front paw reaching toward the camera. Keep the tower scale, crowd blur and lens perspective unchanged.",
    style: "Preserve the polished photographic treatment, daylight, depth, material texture and colour balance of Image 1. Image 2 supplies identity only, not its original background or lighting.",
    clothing: "Keep the black beret, round sunglasses and striped shirt; tailor only the openings needed for the new ears, neck and foreleg.",
    text: "No new text, tourism branding or sponsorship claim."
  },
  {
    id: "dessert-shopkeeper",
    title: "甜品饮品主理人",
    master: "dessert-shopkeeper_toy-poodle_9x16_v02.png",
    anchor: 0.5,
    core: "the pink strawberry patisserie, warm light, shallow depth of field, central counter portrait, cake hat, lace bow, flowers, strawberries, cakes, glass cloche, basket, cake server and exact prop placement",
    action: "Replicate the master's front-facing gentle gaze, closed mouth, calm shopkeeper pose and paw placement beside the cake server. Keep every dessert and foreground object in place.",
    style: "Preserve the detailed polished photographic treatment, warm pink palette, soft depth and material realism of Image 1. Image 2 supplies identity only.",
    clothing: "Keep the strawberry cake hat and pink lace bow, adapting only their contact boundaries to the new ears, neck and coat.",
    text: "Keep the upper-left framed sign visibly and accurately reading the exact uppercase word 'STRAWBERRY', spelled S-T-R-A-W-B-E-R-R-Y. Do not add other prominent text, logos, watermarks or signatures."
  },
  {
    id: "pet-runway",
    title: "宠物时装周",
    master: "pet-runway_maine-coon-cat_9x16_v04.png",
    anchor: 0.5,
    core: "the centred grey runway, soft spotlight, blurred seated audience, full-body upright fashion walk, grey oversized coat, cream cable-knit vest, charcoal patterned scarf and pale sage wide trousers",
    action: "Replicate the master's exact upright two-legged runway stride, vertical torso, crossed step, forward-facing head, calm friendly expression, paws placed inside the coat openings and visible attached tail. Do not turn the pet quadrupedal or seated.",
    style: "Preserve Image 1's high-end editorial photographic treatment, restrained neutral palette, cloth texture, spotlight and depth of field. Image 2 supplies animal identity only.",
    clothing: "Keep every garment, layer, colour family and silhouette. Adapt them to natural animal anatomy without human hands, fingers, skin, arms, torso or a pasted animal head.",
    text: "Keep the image free of text, logos, watermarks and signatures."
  },
  {
    id: "leaping-cover",
    title: "腾空跳跃封面",
    master: "leaping-cover_border-collie_9x16_reset-v02.png",
    anchor: 0.5,
    core: "the full-frame airborne leap toward the viewer, two foreshortened front paws at the bottom, closed happy crescent eyes, open smiling mouth with tongue out and explosive cyan-orange-magenta-yellow abstract paint field",
    action: "Replicate the exact airborne body angle, foreshortening, paw placement, closed-eye smile, mouth opening and tongue shape. Preserve an adult body and believable attached limbs; do not shorten it into a puppy or oversized head.",
    style: "Image 1 is the absolute authority for the entire painting, including the face. Render the replacement pet in the same soft digital impressionist painting with dense short broken fur strokes, fragmented lively marks, crisp local stroke edges, controlled micro-contrast and airy painted transitions. Translate the new coat colours through those strokes. Do not copy photographic fur, realistic eyeballs, realistic nose volume, smooth blended fur, heavy impasto or a pasted photo face from Image 2.",
    clothing: "No clothing or added prop.",
    text: "Keep the image free of text, logos, watermarks and signatures."
  }
].map((template) => ({
  ...template,
  orientation: "portrait",
  size: outputSpecs.portrait.size,
  masterPath: path.join(REFERENCE_ROOT, "masters", template.master)
}));

const matrix = [
  ["exaggerated-expression", "cat", "british-shorthair-cat"],
  ["exaggerated-expression", "dog", "corgi-dog"],
  ["landmark-adventure", "cat", "cream-longhair-cat"],
  ["landmark-adventure", "dog", "husky-dog"],
  ["dessert-shopkeeper", "cat", "black-cat"],
  ["dessert-shopkeeper", "dog", "golden-retriever-dog"],
  ["pet-runway", "cat", "tuxedo-cat"],
  ["pet-runway", "dog", "german-shepherd-dog"],
  ["leaping-cover", "cat", "ragdoll-cat"],
  ["leaping-cover", "dog", "shiba-dog"]
];

const targetedRevisions = {
  "exaggerated-expression_cat_british-shorthair-cat": { compactPrompt: true },
  "landmark-adventure_cat_cream-longhair-cat": {
    version: "v02",
    promptAddendum: "Targeted sunglasses correction: keep the exact same round frames and Eiffel Tower reflections, but make both lenses visibly deeper and darker smoked near-black glass. The lenses should read as fashionably black at first glance, with restrained reflections still visible; do not make them pale blue, transparent or clear. Preserve the pet, smile, gaze, paw, beret, shirt, landmark, crop and all other scene details."
  },
  "landmark-adventure_dog_husky-dog": {
    version: "v02",
    promptAddendum: "Targeted sunglasses correction: keep the exact same round frames and Eiffel Tower reflections, but make both lenses visibly deeper and darker smoked near-black glass. The lenses should read as fashionably black at first glance, with restrained reflections still visible; do not make them pale blue, transparent or clear. Preserve the pet, smile, gaze, paw, beret, shirt, landmark, crop and all other scene details."
  },
  "pet-runway_dog_german-shepherd-dog": { compactPrompt: true },
  "leaping-cover_cat_ragdoll-cat": { compactPrompt: true },
  "leaping-cover_dog_shiba-dog": { compactPrompt: true }
};

export const secondBatchValidationJobs = matrix.map(([templateId, variant, identityId]) => {
  const id = `${templateId}_${variant}_${identityId}`;
  const revision = targetedRevisions[id] || {};
  return {
    id,
    variant,
    identityId,
    version: revision.version || "v01",
    promptAddendum: revision.promptAddendum || "",
    compactPrompt: revision.compactPrompt || false,
    template: templates.find((item) => item.id === templateId),
    pet: identities[identityId]
  };
});

export function buildSecondBatchValidationPrompt(job) {
  const { template, pet } = job;
  if (job.compactPrompt) {
    return [
      "Create one exact 720x1280 vertical runtime validation image from exactly two inputs.",
      "Image 1 is our frozen self-owned master and controls every non-identity detail: scene, crop, camera, pose, action, expression, gaze, lighting, palette, medium, brushwork, clothing, text and props. Image 2 controls only the new pet's breed, coat, markings, ears, eye colour, adult age and natural proportions. No third-party effect reference is included.",
      `Replace only the master pet with the exact ${pet.breed} from Image 2, preserving ${pet.identity}. Remove the old pet completely. Do not copy Image 2's pose, expression, background, lighting or photographic rendering.`,
      `Keep ${template.core}. ${template.action}`,
      template.style,
      template.clothing,
      template.text,
      "Scene-change budget 0%. Keep one adult pet. No juvenization, generic cute redesign, residual old-pet parts, extra limbs or ears, malformed face, human hands, broken contacts, logo, watermark or signature."
    ].join(" ");
  }
  return [
    `Use case: compositing and identity-preserving template transfer. Produce one exact 720x1280 vertical 9:16 runtime validation image from exactly two input images.`,
    "Image 1 is a frozen self-owned production master and is the sole authority for composition, scene, camera, crop, pose, action, expression, gaze, lighting, palette, rendering medium, brushwork, text layout, clothing, landmarks, props and all contacts. No third-party effect reference is included. Image 2 is the sole pet identity reference.",
    "Change only the pet identity. Remove the sample pet in Image 1 completely and replace it with the pet from Image 2. Scene-change budget is 0%. Do not redesign, reinterpret, clean up, recolour, restyle, simplify or add anything in the master scene.",
    `Preserve Image 1's ${template.core}.`,
    template.action,
    `The replacement must be the exact ${pet.breed} from Image 2. Preserve ${pet.identity}. Image 2 controls only species, breed, coat colour and markings, ear shape, eye colour, actual age and natural healthy body proportions. Do not copy its pose, expression, camera, background, lighting, photographic texture or rendering style.`,
    "Preserve the pet's actual adult age and natural breed proportions. Do not juvenilize it, enlarge the head or eyes, shorten the muzzle or body, or force a generic cute face. Appeal must come from the master's expression and art direction while the new pet remains recognisable, healthy and immediately likeable.",
    template.style,
    template.clothing,
    template.text,
    job.promptAddendum,
    "Keep exactly one pet and one identity. No residual coat, face or limb from the master pet. Correct species anatomy only: no duplicate or fused limbs, extra ears, warped eyes, malformed mouth, floating tail, human hands, fingers or broken garment and prop boundaries. Preserve all non-pet pixels and scene relationships as closely as the model allows."
  ].join(" ");
}
