import path from "node:path";

export const ROOT = path.resolve(import.meta.dirname, "../..");
export const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
export const PROMOTION_ROOT = path.join(REFERENCE_ROOT, "public-master-promotion-20260820");

export const stabilityIdentities = [
  {
    id: "british-shorthair-cat",
    label: "短毛猫",
    species: "cat",
    breed: "blue British Shorthair cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-british.jpg"),
    identity: "solid blue-grey plush short coat, round broad face, amber eyes, small upright ears and sturdy natural proportions",
  },
  {
    id: "german-shepherd-dog",
    label: "犬",
    species: "dog",
    breed: "German Shepherd dog",
    path: path.join(ROOT, "apps", "website", "public", "assets", "hero-shepherd.jpg"),
    identity: "tan coat with a defined black saddle and mask, brown eyes, tall upright ears, black muzzle and athletic natural proportions",
  },
  {
    id: "cream-longhair-cat",
    label: "长毛猫",
    species: "cat",
    breed: "cream long-haired cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-cream.jpg"),
    identity: "pale cream long coat, soft cream points, blue eyes, pink nose, triangular ears, fluffy tail and full natural proportions",
  },
];

export const promotionJobs = [
  {
    sequence: 12,
    templateId: "dessert-shopkeeper",
    title: "甜品饮品主理人",
    constraint: "Keep the pet behind the strawberry cake, the pink shopkeeper outfit and bow, all surrounding strawberries, warm dessert-shop light and centered portrait framing.",
  },
  {
    sequence: 17,
    templateId: "original-magic-academy",
    title: "原创魔法学院",
    constraint: "Keep the dark green magic-academy robe and scarf, stone classroom, potion props, warm cinematic light and the same seated full-body composition.",
  },
  {
    sequence: 28,
    templateId: "animal-giant-city-companion",
    title: "巨型城市伙伴",
    constraint: "Keep the monumental pet scale among skyscrapers and traffic. Both eyes must stay directed downward toward the tiny people and cars, never toward the camera.",
  },
  {
    sequence: 29,
    templateId: "animal-doodle-fisheye-chicken",
    title: "鱼眼涂鸦表情",
    constraint: "Replace the chicken completely with the target pet while keeping exactly the public master's playful doodle language: a round fisheye body, huge slightly asymmetric comic eyes and a very thick irregular black hand-drawn contour. The red/orange crayon marks are fixed decorative graphics and must not follow the target pet's natural coat colour: retain two obvious pink-red cheek circles with small red freckles plus at least three broad, saturated red/orange zigzag or cross-hatched patches across the lower torso and sides, with roughly the same visual coverage and intensity as Image 1. These marks must be immediately visible at thumbnail size on every cat or dog. Preserve the clean off-white background. Translate identity only through ears, muzzle, eye colour, head silhouette and a few simplified coat-mark cues inside this crayon language. Use flat wax-crayon fills and broken strokes throughout. Do not render realistic fur, fine grey pencil texture, photographic volume, soft graphite shading or a conventional cute-pet illustration. Leave no beak, comb, wattle, wings, feathers, bird feet or other chicken anatomy.",
  },
  {
    sequence: 30,
    templateId: "animal-car-window-westie",
    title: "车窗风中写真",
    constraint: "Keep the pet leaning from the yellow car window, light green shirt, windblown fur, blue sky, green roadside landscape and the same horizontal travel-photo framing.",
  },
  {
    sequence: 54,
    templateId: "pet-milk-tea-shopkeeper",
    title: "奶茶店主理人",
    constraint: "Keep the pet behind the milk-tea counter, paper shop hat, beige apron, cups and tapioca props, warm cream shop interior and all existing sign layout.",
  },
];

export function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}

export function candidateBasename(job, publicVersion) {
  return `${job.templateId}_${publicVersion}_master-candidate`;
}

export function buildStabilityPrompt(job, identity, size) {
  const petNoun = identity.species === "cat" ? "cat" : "dog";
  return [
    `Use case: identity-preserving production-master stability validation. Create one ${size === "1280x720" ? "horizontal 16:9" : "vertical 9:16"} image composed for an exact final size of ${size} pixels from exactly two input images.`,
    "Image 1 is a proposed self-owned runtime master copied byte-for-byte from an approved public preview. It is the sole reference for composition, scene, pose, expression, styling, lighting, palette, clothing, props and text layout. Image 2 is the sole pet identity reference.",
    `Replace every animal depiction in Image 1 with the exact ${identity.breed} from Image 2. Preserve the target pet's ${identity.identity}. Image 2 controls identity and species; do not retain the sample animal's breed or facial structure from Image 1.`,
    `The replacement must remain recognisably the same ${petNoun} as Image 2 while naturally adopting Image 1's pose and expression. Preserve its real age and breed proportions; do not beautify, juvenilize, enlarge or shrink the head arbitrarily, or invent a generic cute face.`,
    "Scene-change budget: 0%. Do not redesign, simplify, crop, recolour, relight, add, remove or move any background element, garment, prop, graphic mark or text. Make only the smallest local geometry adjustment needed for the replacement animal to fit the existing pose and clothing.",
    job.constraint,
    "Keep all existing readable text unchanged. Add no new text, logo, signature, watermark or AI label. Avoid duplicate heads, extra eyes, extra ears, extra limbs, malformed paws, fused clothing, floating props and mixed-species anatomy.",
  ].join(" ");
}
