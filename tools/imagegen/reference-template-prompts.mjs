import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");

export const outputSpecs = {
  portrait: { size: "720x1280", ratio: "9x16", width: 720, height: 1280 },
  landscape: { size: "1280x720", ratio: "16x9", width: 1280, height: 720 }
};

export const referenceTemplates = [
  {
    id: "travel-selfie",
    title: "旅行自拍",
    orientation: "portrait",
    anchor: 0.32,
    candidate: "travel-selfie_devon-kitten_9x16_v05.png",
    master: "travel-selfie_devon-kitten_9x16_v05.png",
    core: "the close ultra-wide tropical island travel-selfie composition, foreground selfie-paw perspective, happy holiday story, distant volcano, temple-like landmark, turquoise water, straw hat, flowers and colourful floral shirt",
    action: "Preserve the believable selfie action: one front paw extends toward the camera while the other remains naturally connected to the body. Keep the landmark readable behind the pet.",
    textPolicy: "No new text is required. Preserve any incidental scene text only when it remains short, legible and appropriate.",
    clothingPolicy: "Keep the straw hat, flowers and floral shirt. They may receive small fit or colour adjustments for the new pet but must not disappear."
  },
  {
    id: "pet-barista",
    title: "咖啡主理人",
    orientation: "portrait",
    anchor: 0.3,
    candidate: "pet-barista_shiba_9x16_v05.png",
    master: "pet-barista_shiba_9x16_v05.png",
    core: "the cosy coffee-shop layout, left window, warm side lighting, wooden shelves, chalkboard menu, coffee cup with latte art, cookies, bow tie, apron and clear tabletop-to-subject relationship",
    action: "Keep one front paw resting naturally beside the coffee setup and retain a clear, calm barista story.",
    textPolicy: "Keep the chalkboard heading 'COFFEE' and its readable menu items 'AMERICANO', 'LATTE', 'CAPPUCCINO', 'MOCHA'. Replace only the apron identity wording with the exact wording supplied for this job. The bottle label may remain 'COFFEE'. Omit optional tiny copy rather than generating gibberish.",
    clothingPolicy: "Keep the apron and bow tie. They may remain unchanged, change colour or receive minor tailoring for the new pet."
  },
  {
    id: "roller-coaster",
    title: "过山车",
    orientation: "portrait",
    anchor: 0.34,
    candidate: "roller-coaster_corgi_9x16_v01.png",
    master: "roller-coaster_corgi_9x16_v01.png",
    core: "the first-row roller-coaster composition, red car, black safety restraint, orange looping track, blue supports, bright sky, green park background, wide-angle speed and joyful mid-ride story",
    action: "Keep both front paws naturally braced on the car edge and the restraint correctly crossing the body. Preserve the feeling of speed while keeping the face sharp.",
    textPolicy: "Do not add text, logos, platform UI, watermarks or signatures.",
    clothingPolicy: "No clothing is required; keep the car and functional safety restraint intact."
  },
  {
    id: "pet-wanted-poster",
    title: "萌宠通缉令",
    orientation: "portrait",
    anchor: 0.28,
    candidate: "pet-wanted-poster_golden-retriever_9x16_v01.png",
    master: "pet-wanted-poster_golden-retriever_9x16_v01.png",
    core: "the front-facing humorous mugshot composition, white height-chart background, navy measurement lines and numbers, orange prison shirt, two paws holding a dark rectangular placard, direct eye contact and playful deadpan comedy",
    action: "Both front paws must grip the two sides of the placard naturally. Keep the subject centred and front-facing.",
    textPolicy: "Keep the placard and set its exact Chinese text to '偷吃零食'. Keep the height-chart numbers readable and plausible. Do not delete the existing text structure; omit optional tiny copy rather than generating gibberish.",
    clothingPolicy: "Keep the orange prison shirt. It may receive minor tailoring or a slight colour-tone adjustment for the new pet."
  },
  {
    id: "pet-encyclopedia",
    title: "本宠百科图鉴",
    orientation: "portrait",
    anchor: 0.5,
    candidate: "pet-encyclopedia_british-shorthair_9x16_v02.png",
    master: "pet-encyclopedia_british-shorthair_9x16_v02.png",
    core: "the cream editorial atlas design, large title area, central full-body portrait, circular ear-eye-fur-paw detail insets with leader lines, countryside backdrop, modular information panels, green accents, icon rhythm and dense but orderly hierarchy",
    action: "Replace every pet depiction, including the main portrait, circular details and small action views, with the same pet from Image 2. All views must retain one identity.",
    textPolicy: "Keep the top-left header '宠物科普百科'. Use the exact Chinese breed title and English subtitle supplied for this job. Retain the readable section headings '基础档案', '外观特征', '性格行为', '饲养护理', '互动建议'. Keep body copy short and neutral; omit unreadable tiny sentences rather than inventing medical claims.",
    clothingPolicy: "No clothing is required. Preserve the editorial panels, leader lines, icons and countryside setting."
  },
  {
    id: "pet-character-sheet",
    title: "宠物角色设定集",
    orientation: "landscape",
    anchor: 0.5,
    candidate: "pet-character-sheet_tuxedo-cat_16x9_v01.png",
    master: "pet-character-sheet_tuxedo-cat_16x9_v01.png",
    core: "the clean white professional character-sheet structure: profile block on the left, front-side-back turnaround across the upper middle, six facial-expression portraits at upper right, clothing and accessory breakdown along the bottom, compact colour palette and one small forest-world vignette",
    action: "Every repeated view must depict the exact same pet from Image 2. Keep accurate front, side and back views, six distinct friendly expressions, an equipped full-body view, outfit pieces and a coherent colour palette.",
    textPolicy: "Keep the exact English headings 'CHARACTER SHEET', 'PROFILE', 'TURNAROUND', 'FACIAL EXPRESSIONS', 'ITEM & COSTUME', 'COLOR PALETTE', 'WORLD'. Replace the character name with the exact name supplied for this job. Omit optional tiny body copy rather than generating gibberish.",
    clothingPolicy: "Keep the padded explorer jacket, scarf, goggles, boots and waist pouch, adapted naturally to the new animal. Clothing may change colour or receive minor tailoring but must not hide identity markings."
  }
].map((template) => ({
  ...template,
  candidatePath: path.join(REFERENCE_ROOT, "candidates", template.candidate),
  masterPath: path.join(REFERENCE_ROOT, "masters", template.master),
  size: outputSpecs[template.orientation].size
}));

const identities = {
  "cream-longhair-cat": {
    species: "cat",
    breed: "cream long-haired cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-cream.jpg"),
    identity: "the pale cream long coat, soft cream points, blue eyes, pink nose, triangular ears, fluffy tail and full healthy body",
    breedTitle: "奶油色长毛猫",
    englishTitle: "CREAM LONGHAIR",
    apronText: "CREAM CAT BREW",
    characterName: "LUNA"
  },
  "black-cat": {
    species: "cat",
    breed: "black domestic shorthair cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-black.jpg"),
    identity: "the solid glossy black coat without white patches, vivid green eyes, black nose, upright ears and compact healthy body",
    breedTitle: "黑色短毛家猫",
    englishTitle: "BLACK SHORTHAIR",
    apronText: "BLACK CAT BREW",
    characterName: "NOIR"
  },
  "british-shorthair-cat": {
    species: "cat",
    breed: "blue British Shorthair cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-british.jpg"),
    identity: "the solid blue-grey coat, round broad face, amber eyes, small upright ears, plush dense fur, thick tail and sturdy rounded body",
    breedTitle: "英国短毛猫",
    englishTitle: "BRITISH SHORTHAIR",
    apronText: "BRITISH BREW",
    characterName: "ASH"
  },
  "tuxedo-cat": {
    species: "cat",
    breed: "black-and-white tuxedo cat",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "cat-tuxedo.jpg"),
    identity: "the black ears and crown, narrow white facial blaze, white muzzle and chest, pale green eyes, pink nose, black back and white front legs",
    breedTitle: "黑白短毛家猫",
    englishTitle: "TUXEDO CAT",
    apronText: "TUXEDO BREW",
    characterName: "MILO"
  },
  "devon-rex-cat": {
    species: "cat",
    breed: "grey-and-white Devon Rex cat",
    path: path.join(ROOT, "apps", "website", "public", "assets", "hero-devon.jpg"),
    identity: "the grey crown and back, white muzzle and chest, pale green eyes, very large upright ears, short curly coat and recognisable Devon Rex face",
    breedTitle: "德文卷毛猫",
    englishTitle: "DEVON REX",
    apronText: "DEVON BREW",
    characterName: "PIXEL"
  },
  "husky-dog": {
    species: "dog",
    breed: "grey-and-white Siberian Husky",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-husky.jpg"),
    identity: "the symmetrical grey cap, broad white facial blaze, white muzzle and chest, ice-blue eyes, upright triangular ears and dense double coat",
    breedTitle: "西伯利亚哈士奇",
    englishTitle: "SIBERIAN HUSKY",
    apronText: "HUSKY BREW",
    characterName: "NOVA"
  },
  "golden-retriever-dog": {
    species: "dog",
    breed: "Golden Retriever",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-golden.jpg"),
    identity: "the warm golden coat, floppy feathered ears, dark friendly eyes, broad soft muzzle and recognisable Golden Retriever build",
    breedTitle: "金毛寻回犬",
    englishTitle: "GOLDEN RETRIEVER",
    apronText: "GOLDEN BREW",
    characterName: "SUNNY"
  },
  "shiba-dog": {
    species: "dog",
    breed: "red Shiba Inu",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-shiba.jpg"),
    identity: "the red-and-cream coat, cream cheeks and chest, dark almond eyes, triangular upright ears, curled tail and compact sturdy body",
    breedTitle: "柴犬",
    englishTitle: "SHIBA INU",
    apronText: "SHIBA BREW",
    characterName: "MOMO"
  },
  "black-labrador-dog": {
    species: "dog",
    breed: "black Labrador Retriever",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-black-lab.jpg"),
    identity: "the solid glossy black coat, warm brown eyes, broad black nose, soft dropped ears and strong healthy Labrador build",
    breedTitle: "拉布拉多寻回犬",
    englishTitle: "LABRADOR RETRIEVER",
    apronText: "LAB BREW",
    characterName: "COAL"
  },
  "corgi-dog": {
    species: "dog",
    breed: "Pembroke Welsh Corgi",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-corgi.jpg"),
    identity: "the tan-and-white coat, broad white facial blaze, white muzzle and chest, dark round eyes, large upright ears, short legs and compact sturdy body",
    breedTitle: "彭布罗克威尔士柯基犬",
    englishTitle: "PEMBROKE WELSH CORGI",
    apronText: "CORGI BREW",
    characterName: "BISCUIT"
  },
  "german-shepherd-dog": {
    species: "dog",
    breed: "German Shepherd",
    path: path.join(ROOT, "apps", "website", "public", "assets", "hero-shepherd.jpg"),
    identity: "the tan coat with a defined black saddle and mask, brown eyes, tall upright ears, black muzzle and athletic healthy German Shepherd build",
    breedTitle: "德国牧羊犬",
    englishTitle: "GERMAN SHEPHERD",
    apronText: "SHEPHERD BREW",
    characterName: "ATLAS"
  }
};

const matrix = [
  ["travel-selfie", "cat", "cream-longhair-cat"],
  ["travel-selfie", "dog", "husky-dog"],
  ["pet-barista", "cat", "black-cat"],
  ["pet-barista", "dog", "golden-retriever-dog"],
  ["roller-coaster", "cat", "british-shorthair-cat"],
  ["roller-coaster", "dog", "shiba-dog"],
  ["pet-wanted-poster", "cat", "tuxedo-cat"],
  ["pet-wanted-poster", "dog", "black-labrador-dog"],
  ["pet-encyclopedia", "cat", "devon-rex-cat"],
  ["pet-encyclopedia", "dog", "corgi-dog"],
  ["pet-character-sheet", "cat", "cream-longhair-cat"],
  ["pet-character-sheet", "dog", "german-shepherd-dog"]
];

export const migrationJobs = matrix.map(([templateId, variant, identityId]) => {
  const template = referenceTemplates.find((item) => item.id === templateId);
  const pet = identities[identityId];
  const isExcitedShibaRerun = templateId === "roller-coaster" && identityId === "shiba-dog";
  return {
    id: `${templateId}_${variant}_${identityId}`,
    template,
    variant,
    identityId,
    pet,
    version: isExcitedShibaRerun ? "v02" : "v01",
    promptAddendum: isExcitedShibaRerun
      ? "Targeted rerun: substantially increase the Shiba Inu's visible mid-ride excitement while keeping it cute and friendly. Use wide sparkling eyes, raised brows, perked ears and a clearly open joyful smile with a naturally visible tongue. The expression must read instantly as thrilled exhilaration, not calm posing, fear, aggression or an exaggerated distorted scream. Preserve the exact frozen roller-coaster scene, pet identity, restraint and paw contact; change the expression and only the small facial details needed to support it."
      : ""
  };
});

export const expressionGridJob = {
  id: "pet-expression-grid_cream-longhair-cat",
  templateId: "pet-expression-grid",
  title: "今日表情九宫格",
  orientation: "portrait",
  anchor: 0.5,
  version: "v01",
  effectReferencePath: path.join(ROOT, "apps", "website", "public", "assets", "example", "1786368990305.png"),
  pet: identities["cream-longhair-cat"],
  outputName: "pet-expression-grid_cream-cat_9x16_v01.png",
  prompt: [
    "Use case: compositing and identity-preserving expression sheet. Create a vertical 9:16 polished 3x3 pet expression grid from both input images, composed for an exact final size of 720x1280 pixels.",
    "Image 1 is the internal effect and layout reference. Preserve its clean white 3x3 grid, nine evenly sized portrait cells, consistent close-up framing, bright high-key studio light and simple social-media expression-sheet readability. Do not redesign or modify the scene, grid, spacing, background or crop; only the pet identity may change.",
    "Image 2 is the sole pet identity reference. Replace every Shiba Inu in Image 1 with the exact same cream long-haired cat from Image 2. Preserve the pale cream long coat, soft cream points, blue eyes, pink nose, triangular ears and fluffy healthy proportions in every cell.",
    "The nine cells must show the same cat, not nine different cats. Show these nine distinct expressions in reading order: happy, surprised, aggrieved, unimpressed, sleepy, proud, affectionate, mildly angry, daydreaming. Change only expression and a small natural head angle; keep breed, facial structure, coat colour and pattern, eye colour, ear shape and apparent age consistent.",
    "Preserve the pet's actual age and natural proportions. Do not beautify, juvenilize, enlarge the head or eyes, or replace the original expression with a generic cute face. Avoid a thin body, sharp or long face, aggression, odd anatomy, uncanny eyes or gloomy ageing features.",
    "No text, captions, speech bubbles, logos, watermark, accessories that vary between cells, duplicate facial parts or malformed mouths. Keep all ears and facial features fully inside their cells."
  ].join(" ")
};

export function buildMigrationPrompt(job) {
  const { template, pet } = job;
  const petNoun = pet.species === "cat" ? "cat" : "dog";
  return [
    `Use case: compositing and identity-preserving template transfer. Create a ${template.orientation === "portrait" ? "vertical 9:16" : "horizontal 16:9"} high-fidelity pet replacement from exactly two input images, composed for an exact final size of ${template.size} pixels.`,
    "Image 1 is a frozen self-owned production master created previously by our team. It is the sole composition, scene, styling and layout reference for this request. No third-party effect reference is included at runtime. Image 2 is the sole pet identity reference.",
    `Preserve Image 1's ${template.core}. Do not redesign the environment or turn it into a generic scene.`,
    "Scene-change budget: 0%. Do not alter the background, environment, composition, crop, lighting, palette, text layout, clothing, landmarks or distinctive props. Only make the smallest identity-fit adjustment required where the replacement pet physically intersects an existing garment or prop; do not redesign the scene.",
    `Remove every depiction of the master pet from Image 1 and replace it with the exact ${pet.breed} from Image 2. Preserve ${pet.identity}. Image 2 controls pet identity and overrides the sample pet shown in the master.`,
    `Preserve the replacement ${petNoun}'s actual age and natural breed proportions from Image 2. Do not beautify or juvenilize it, and do not invent a generic cute face. The original master expression and visual treatment provide any appeal. Never make the pet skinny, elongated, angular, gaunt, stern, aggressive, strange, elderly-looking or uncanny.`,
    template.action,
    template.clothingPolicy,
    template.textPolicy,
    template.id === "pet-barista" ? `The apron wording for this job must read exactly '${pet.apronText}'.` : "",
    template.id === "pet-encyclopedia" ? `The exact breed title must read '${pet.breedTitle}' and the English subtitle must read '${pet.englishTitle}'.` : "",
    template.id === "pet-character-sheet" ? `The exact character name for this job must read '${pet.characterName}'. Adapt all repeated views to natural ${petNoun} anatomy, never a humanoid body.` : "",
    job.promptAddendum,
    "Keep exactly one pet identity throughout the image and no unrelated animal. Correct anatomy only: no duplicate or fused limbs, extra ears, warped eyes, broken clothing boundaries or human hands. Preserve rather than delete meaningful clothing, landmarks, distinctive props and text layout from the master. No platform UI, brand logo, known IP, watermark or signature."
  ].filter(Boolean).join(" ");
}

export function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}
