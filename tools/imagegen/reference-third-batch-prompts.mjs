import path from "node:path";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EFFECT_ROOT = path.join(ROOT, "apps", "website", "public", "assets", "example");

export const thirdBatchOutputSpecs = {
  portrait: { size: "720x1280", ratio: "9x16", width: 720, height: 1280 },
  landscape: { size: "1280x720", ratio: "16x9", width: 1280, height: 720 }
};

const identities = {
  "dragon-li-cat": {
    species: "cat",
    breed: "adult Chinese Dragon Li tabby cat",
    breedZh: "成年狸花猫",
    path: path.join(ROOT, "apps", "website", "public", "assets", "avatar-dragonli.jpg"),
    identity: "the warm brown-and-black mackerel tabby coat, dark forehead M marking, bold cheek stripes, golden-green almond eyes, brick-pink nose, upright ears, broad healthy adult face and sturdy adult body"
  },
  "german-shepherd-dog": {
    species: "dog",
    breed: "adult German Shepherd",
    breedZh: "成年德国牧羊犬",
    path: path.join(ROOT, "apps", "website", "public", "assets", "hero-shepherd.jpg"),
    identity: "the tan coat with a defined black saddle and mask, warm brown eyes, tall upright ears, black muzzle and athletic healthy adult build"
  },
  "abyssinian-cat": {
    species: "cat",
    breed: "adult ruddy Abyssinian cat",
    breedZh: "成年阿比西尼亚猫",
    path: path.join(ROOT, "apps", "website", "public", "assets", "avatar-abyssinian.jpg"),
    identity: "the warm ruddy ticked coat, darker forehead markings, large upright ears, golden almond eyes, terracotta nose, elegant adult face and lean but healthy natural adult body"
  },
  "corgi-dog": {
    species: "dog",
    breed: "adult Pembroke Welsh Corgi",
    breedZh: "成年彭布罗克威尔士柯基犬",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-corgi.jpg"),
    identity: "the tan-and-white coat, broad white facial blaze, white muzzle and chest, dark eyes, large upright ears, short legs and compact sturdy adult body"
  },
  "toy-poodle-dog": {
    species: "dog",
    breed: "adult apricot Toy Poodle",
    breedZh: "成年杏色玩具贵宾犬",
    path: path.join(ROOT, "apps", "website", "public", "assets", "avatar-poodle.jpg"),
    identity: "the warm apricot tight-curled coat, round dark eyes, small black nose, rounded muzzle, floppy curly ears and compact healthy adult body"
  },
  "black-labrador-dog": {
    species: "dog",
    breed: "adult black Labrador Retriever",
    breedZh: "成年黑色拉布拉多寻回犬",
    path: path.join(ROOT, "tools", "imagegen", "out", "source", "dog-black-lab.jpg"),
    identity: "the solid glossy black coat, warm brown eyes, broad black nose, soft dropped ears, broad gentle muzzle and strong healthy adult Labrador build"
  },
  "ragdoll-cat": {
    species: "cat",
    breed: "adult seal-point Ragdoll cat",
    breedZh: "成年海豹重点色布偶猫",
    path: path.join(ROOT, "apps", "website", "public", "assets", "work-ragdoll.jpg"),
    identity: "the cream long coat, deep seal-brown mask and ears, round blue-grey eyes, broad fluffy cheeks, dark nose, soft full chest and healthy adult long-haired body"
  }
};

const commonIdentityPolicy = [
  "Use exactly two input images. Image 1 is the third-party effect reference used only for this internal master-production pass. Image 2 is the sole pet identity reference.",
  "Replace only the principal animal or person subject in Image 1 with the exact pet from Image 2. Remove every residual face, hair, skin, hand, paw, limb, coat marking or silhouette from the original subject. Image 2 controls only pet identity: species, breed, coat, markings, ear shape, eye colour, actual age and natural healthy proportions.",
  "Image 1 controls every transferred visual detail: composition, crop, camera, perspective, subject position, pose, action, expression, gaze, lighting, palette, rendering medium, brushwork, line quality, texture, clothing, props, text layout and subject-to-scene contacts. Scene-change budget is 0%. Do not redesign, reinterpret, recolour, simplify, clean up or add background content.",
  "Translate the original pose, action and expression to correct animal anatomy with only the smallest contact-boundary adjustment required by the new species. Never create a human face, human skin, human hands or fingers. Keep paws anatomically natural and keep clothing and props physically attached.",
  "The replacement pet must be rendered completely in Image 1's medium and detail language, including its face, eyes, muzzle, ears and fur. Never paste a photographic pet face into an illustration or leave realistic photographic facial texture inside a painted scene. Do not copy Image 2's pose, expression, background, lighting or photographic rendering.",
  "Preserve the pet's adult age and natural breed proportions. Do not turn it into a puppy or kitten, enlarge the head or eyes, shorten the muzzle or body, or force a generic baby face. Keep it healthy, friendly and immediately appealing through the transferred expression and art direction, never skinny, gaunt, old, stern, aggressive, uncanny or strange.",
  "Keep the complete meaningful text, clothing, landmarks and distinctive props from Image 1 except for the explicit rights-safe text or emblem replacements stated below. Remove third-party platform watermarks, account IDs, signatures and unrelated brand marks. No new logo or watermark."
].join(" ");

export const thirdBatchJobs = [
  {
    id: "original-magic-academy",
    title: "原创魔法学院",
    entryId: "career",
    subjectId: "dragon-li-cat",
    orientation: "landscape",
    anchor: 0.5,
    version: "v02",
    pet: identities["dragon-li-cat"],
    effectReference: path.join(EFFECT_ROOT, "c228839a-db36-4deb-a485-40e0a0161715.jpg"),
    rationale: "实际画面为学院长袍猫；用狸花猫验证服装、徽章、围巾、药剂台和成年短毛猫身份能否同时稳定。",
    scene: [
      "Preserve Image 1's exact vertical magic-academy portrait: the seated cat in the lower-left foreground, warm stone classroom, arched window, dark wood potion counter, steaming black cauldron, glass bottles, green-lined black robe, striped green scarf, silver trim, floor reflections and shallow cinematic depth of field.",
      "Preserve the same seated three-quarter pose, front-paw placement, direct calm gaze and complete tail silhouette. Adapt robe openings around natural feline shoulders and front legs without changing the garment design.",
      "Replace the existing house crest with a small original four-point-star-and-paw academy crest in the same size, placement, embroidery style and green-silver palette. Do not reproduce any known school name, crest, letter or franchise symbol. Keep all other clothing and props unchanged."
    ].join(" ")
  },
  {
    id: "epic-ruins",
    title: "史诗遗迹探险",
    entryId: "action",
    subjectId: "german-shepherd-dog",
    orientation: "portrait",
    anchor: 0.5,
    version: "v01",
    pet: identities["german-shepherd-dog"],
    effectReference: path.join(EFFECT_ROOT, "14.png"),
    rationale: "用成年德牧承接冷峻遗迹、低机位逆光和重型探险装备，保持英气但避免凶相与幼化。",
    scene: [
      "Preserve Image 1's exact epic ruined-megastructure scene and visual treatment as a true horizontal cinematic panorama: towering suspended gothic fragments, the luminous circular arch, stormy blue-grey sky, rain and drifting debris, low-angle scale, cold steel-blue palette, sharp rim light, wet platform edge and immense depth across the frame.",
      "Replace only the silver-haired humanoid explorer with the exact adult German Shepherd from Image 2. Keep the armoured dog in the left third, facing toward the middle-right ruins with the same alert determined gaze and forward-ready full-body action. Preserve the dark segmented expedition armour, red ribbon accents and massive rectangular mechanical exploration device, adapted as a believable back-and-shoulder rig rather than held by human hands.",
      "Keep all four canine limbs anatomically plausible and keep the dog recognisably adult. Preserve the complete luminous arch, tiny scale figures and the subject-versus-monument scale. Use the middle and right of the 16:9 frame for the immense ruin panorama; do not crop it back to portrait or invent a different ruin, sky, weapon or story."
    ].join(" ")
  },
  {
    id: "mini-companion",
    title: "同宠大小分身",
    entryId: "character",
    subjectId: "abyssinian-cat",
    orientation: "portrait",
    anchor: 0.5,
    version: "v04",
    pet: identities["abyssinian-cat"],
    effectReference: path.join(EFFECT_ROOT, "1786369135481.png"),
    rationale: "用阿比西尼亚猫验证同一身份的大小分身、正确护目镜、强仰视英雄机位和成套户外服装在竖版中保持一致。",
    scene: [
      "Preserve Image 1's exact vertical portrait composition and high-key white studio setup: slight diagonal floor line, large companion at left-front, miniature companion at right-rear, scale contrast, shadows and clean commercial outdoor-gear photography. Use a substantially stronger heroic low camera from below so both cats read as imposing and upward-looking. Keep the same tall framing and extend only the existing seamless white field as needed to reach 9:16; do not rotate, widen or redesign it as a horizontal scene.",
      "Replace both Schnauzers with two scale versions of the exact same adult Abyssinian cat from Image 2. The two figures must read unmistakably as one identical pet duplicated at different sizes, with the same coat, facial structure, ears, eyes and adult age. The miniature is not a kitten.",
      "Preserve the seated poses, head tilt, calm confident expression, black jackets, purple chest harnesses, blue-framed mirrored ski goggles, toggles, seams and floor contacts. Set the large cat's left front leg distinctly farther left for a wider, more powerful stance, with the paw fully grounded and anatomically connected. On both the large cat and miniature cat, the ski goggles must be worn over the eyes in the functional skiing position: centre the optical lens band exactly on the eye line, place the bridge over the upper nose, fully cover both eyes behind the opaque mirrored lens, and wrap the strap securely behind the head below the ear bases. No eye may remain visible below, above or beside the lens. The goggles must never sit on the forehead, crown or between the ears like a headband. Preserve both complete ear silhouettes above and behind the strap without deformation. Expand only the existing seamless white studio field to fill the vertical canvas; add no object or scenery."
    ].join(" ")
  },
  {
    id: "adventure-rules",
    title: "冒险生存法则",
    entryId: "archive",
    subjectId: "corgi-dog",
    orientation: "portrait",
    anchor: 0.5,
    version: "v04",
    pet: identities["corgi-dog"],
    effectReference: path.join(EFFECT_ROOT, "11.png"),
    rationale: "用成年柯基验证复杂羊皮纸信息层级、中央探险装备、短腿体型和多个小插图中的同一身份。",
    scene: [
      "Preserve Image 1's exact aged parchment infographic: oversized black-brush title at top, central full-body explorer, dense framed modules, hand-drawn maps, route arrows, circular diagrams, terrain cross-sections, equipment studies, bottom step-by-step strip, sepia-black ink palette, paper stains and antique field-manual linework.",
      "Replace the central human explorer and every small explorer depiction with the exact same adult Corgi from Image 2. This is the sole explicit pose exception to the Image 1 lock: do not preserve the crouched human pose. Render the central Corgi as a complete, stable, anthropomorphic biped standing fully upright from head to both grounded hind paws, with a vertical torso, clearly supported hips, two separate healthy legs and a balanced confident explorer stance. Both forelegs may function as arms but must end in natural paws without fingers; keep the flashlight naturally secured in one paw. Preserve the woven field hat, layered dark travel clothing, scarf, backpack roll, straps and pouches, re-fitted around the upright adult Corgi body.",
      "Align the head naturally with the new upright body instead of preserving the old crouched head angle. The skull, neck, shoulders, sternum and spine must share one coherent vertical and three-quarter perspective axis; centre the head over the neck and ribcage, connect the jaw and throat cleanly into the scarf, and let the hat follow the same head plane. The muzzle and torso must turn in the same subtle direction. Create the focused downward gaze with the eyes only while keeping the head balanced over the spine. No pasted frontal head on an angled body, sideways neck twist, floating chin, broken throat, tilted hat against the skull plane or mismatched head/body camera angle.",
      "The full standing body must be readable at first glance. Show both legs, both hind paws and both forepaws completely and anatomically connected. No sitting, kneeling, squatting, crouching, crawling, hidden feet, amputated-looking limbs, fused legs, leg stumps, collapsed pelvis or floating body. Keep the Corgi adult, compact and sturdy rather than puppy-like.",
      "Keep the layout and all modules. Replace the main title with exactly '本宠探险法则' and the single subtitle directly beneath it with exactly '宠物探险准备与路线全解析'. Use these exact readable section headings in their existing locations: '一、冒险档案', '二、路线线索', '三、必备工具', '四、地形类型', '五、机关观察', '六、方向记录', '七、行动流程', '八、风险应对', '九、路线口诀', '十、地图分布', '十一、发现图鉴'. Remove every occurrence of '盗墓者', '摸金', '校尉' and any wording that identifies the explorer as a human. Keep body copy short, neutral and fictional; omit unreadable tiny copy rather than generating gibberish or safety claims."
    ].join(" ")
  },
  {
    id: "pet-life-journal",
    title: "本宠生涯日记",
    entryId: "archive",
    subjectId: "toy-poodle-dog",
    orientation: "portrait",
    anchor: 0.5,
    version: "v01",
    pet: identities["toy-poodle-dog"],
    effectReference: path.join(EFFECT_ROOT, "10.png"),
    rationale: "用成年贵宾犬验证真实校园生活叙事、桌面交互、手写边注和可爱度，同时避免变成幼犬。",
    scene: [
      "Preserve Image 1's exact warm campus-at-sunset photograph: old stone university building, glowing windows, lawn and path, large tree framing the right edge, outdoor wooden table, open notebook, pen, laptop, soft backlight, film-like warmth and hand-drawn pastel annotations distributed around the subject.",
      "Replace only the seated young woman with the exact adult Toy Poodle from Image 2. Keep the same lower-right seated position, gentle downward focused expression and study interaction. One natural front paw rests by the open notebook and pen while the other is beside the laptop; no human arms, hands, hair or clothing remain. Keep the laptop, notebook, pen and table in their exact relationships. Replace the laptop brand mark with one small plain paw icon in the same location and size.",
      "Preserve the annotation style, arrows, stars, hearts, clouds and placement. Keep or set the readable annotation phrases to exactly: 'soft mornings', 'new day, new goals', 'study mode', 'good things take time', 'a little progress every day', 'focus time', 'snack later?', 'you got this!', 'PET LIFE JOURNAL'. Do not add other long copy."
    ].join(" ")
  },
  {
    id: "ink-portrait",
    title: "黑白水墨肖像",
    entryId: "art",
    subjectId: "black-labrador-dog",
    orientation: "portrait",
    anchor: 0.38,
    version: "reset-v03-reference-gaze-rerun-v01",
    inputFidelity: "",
    pet: identities["black-labrador-dog"],
    identityReference: path.join(ROOT, "tools", "imagegen", "out", "reference-v1", "identity-guides", "ink-portrait_black-labrador-dog_profile-flat-guide_reset-v03.png"),
    identityReferenceRole: "derived-pose-aligned-pet-identity-reference",
    promptMetadataPath: path.join(ROOT, "tools", "imagegen", "out", "reference-v1", "masters", "metadata", "ink-portrait_black-labrador-dog_9x16_reset-v03-reference-gaze-rerun-v01.json"),
    effectReference: path.join(EFFECT_ROOT, "b983ec71-2f88-4c23-97f2-c0f0cb75bac1.jpg"),
    rationale: "实际画面为黑白动态笔刷犬头像；用黑色拉布拉多验证深色毛发在水墨负空间中仍保留五官与轮廓。",
    promptOverride: "approved-master-metadata"
  },
  {
    id: "decorative-art-portrait",
    title: "装饰艺术肖像",
    entryId: "art",
    subjectId: "ragdoll-cat",
    orientation: "portrait",
    anchor: 0.4,
    version: "v05",
    inputFidelity: "",
    pet: identities["ragdoll-cat"],
    identityReference: path.join(ROOT, "tools", "imagegen", "out", "reference-v1", "identity-guides", "decorative-art-portrait_ragdoll-cat_flat-guide_v01.png"),
    effectReference: path.join(EFFECT_ROOT, "08bd1d4d-e149-4670-9867-b288ef488aaa.jpg"),
    rationale: "用布偶猫验证碎片化几何笔触能否保住蓝眼、重点色面罩和成年长毛猫身份，避免脸部被切碎。",
    scene: [
      "Preserve Image 1's exact minimalist fragmented cat portrait: three-quarter right-facing bust, warm off-white paper, large navy-black polygonal paint fragments, translucent grey facets, sharp broken ear and shoulder edges, sparse fine whisker lines, generous negative space, subtle paper texture and faint inset border shadow.",
      "Replace only the original black cat with the exact adult seal-point Ragdoll from Image 2. Preserve Image 1's same head angle, rightward gaze, quiet gentle expression, bust scale and fragment placement rhythm. Recognise the adult Ragdoll through the broad head silhouette, dark seal mask and ears, cream outer coat and full chest shape, but express every feature only as flat angular paint fragments and dry broken edges.",
      "Image 2 is an intentionally five-colour, flattened identity guide derived from the previous candidate. Use only its adult Ragdoll broad head silhouette, seal-point distribution, upright ears and full chest proportions. It contains no valid realistic surface, lighting or depth information. Do not reconstruct photographic eyes, nose, hair or volume that the guide deliberately removed.",
      "Match Image 1's abstraction level across the entire face. Construct the mask, brow, cheeks, muzzle, nose and mouth from roughly six to twelve large hard-edged navy, black, cream and translucent grey facets with visible gaps of paper; there must be no continuous realistic face underneath. Keep only the near eye clearly visible. It must be one simplified flat pale blue-grey triangular or almond polygon bounded by dark paint with one solid dark wedge, matching Image 1 rather than Image 2: no circular iris, iris texture, glass highlight, catchlight, pupil depth, moist surface, eyelid fold, orbital shading or spherical eyeball. Hide the far eye almost completely behind the profile and dark facets. Reduce the nose and mouth to two or three flat angular brush shapes with no rounded muzzle volume.",
      "Flatten the entire face into a strict cut-paper value design: one continuous opaque navy-black polygon for the seal mask, one flat cream paper shape for the outer head and chest, one pale blue-grey eye polygon, and at most four translucent grey facets. Use no beige facial shading, no soft transition between mask and cream coat, no light falloff and no hidden realistic underpainting. The mask must look like a flat graphic shape printed on paper, not fur wrapped around a three-dimensional skull.",
      "Suggest long fur only through the broken outer polygon silhouette and a few broad shard edges. No individual strands, soft fluffy photographic hair, realistic whisker roots, smooth facial gradients, anatomical volume, studio light, low-poly 3D rendering or photographic texture. This is a flat two-dimensional fragmented ink-and-paper collage, not a faceted realistic cat portrait. Keep the face coherent and attractive without slicing, duplicating or misaligning features. Retain enough cream paper space to distinguish the coat while keeping the original restrained navy-grey palette. No added colour accent or text."
    ].join(" ")
  }
];

export function buildThirdBatchPrompt(job) {
  const output = thirdBatchOutputSpecs[job.orientation];
  if (job.promptOverride) return job.promptOverride;
  return [
    "Use case: compositing and identity-preserving effect replication.",
    `Asset type: internal self-owned pet template master, exact final canvas ${output.size} (${output.ratio}).`,
    commonIdentityPolicy,
    job.identityPrompt || `The replacement identity is the exact ${job.pet.breed} from Image 2. Preserve ${job.pet.identity}.`,
    job.scene,
    "Keep exactly the requested pet identity throughout. Correct animal anatomy only: no duplicate or fused limbs, extra ears, warped eyes, malformed mouth, floating tail, broken garment boundaries or residual original subject."
  ].join(" ");
}

export function thirdBatchBasename(job) {
  const output = thirdBatchOutputSpecs[job.orientation];
  return `${job.id}_${job.subjectId}_${output.ratio}_${job.version}`;
}

export function relativeToRoot(file) {
  return path.relative(ROOT, file).replaceAll("\\", "/");
}
