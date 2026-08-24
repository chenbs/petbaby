import path from "node:path";

import { outputSpecs } from "./reference-template-prompts.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");

const identities = {
  "devon-rex-cat": {
    species: "cat",
    breed: "adult grey-and-white Devon Rex cat",
    path: path.join(ROOT, "apps/website/public/assets/hero-devon.jpg"),
    identity: "its grey crown and back, white muzzle and chest, pale green eyes, very large upright ears, short curly coat, recognisable Devon Rex face and healthy adult proportions"
  },
  "maine-coon-cat": {
    species: "cat",
    breed: "adult brown-tabby Maine Coon cat",
    path: path.join(ROOT, "apps/website/public/assets/work-maine.jpg"),
    identity: "its brown tabby coat, broad adult muzzle, green-gold eyes, tall tufted ears, long neck ruff, large paws, full tail and strong healthy adult build"
  },
  "ragdoll-cat": {
    species: "cat",
    breed: "adult seal-point Ragdoll cat",
    path: path.join(ROOT, "apps/website/public/assets/work-ragdoll.jpg"),
    identity: "its warm cream long coat, dark seal face and ears, blue-grey eyes, full neck ruff and healthy natural adult proportions"
  },
  "british-shorthair-cat": {
    species: "cat",
    breed: "adult blue British Shorthair cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-british.jpg"),
    identity: "its solid blue-grey coat, broad round adult face, amber eyes, small upright ears, plush dense fur, thick tail and sturdy natural body"
  },
  "tuxedo-cat": {
    species: "cat",
    breed: "adult black-and-white tuxedo cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-tuxedo.jpg"),
    identity: "its black ears and crown, narrow white facial blaze, white muzzle and chest, pale green eyes, pink nose, black back and white forelegs"
  },
  "black-cat": {
    species: "cat",
    breed: "adult black domestic shorthair cat",
    path: path.join(ROOT, "tools/imagegen/out/source/cat-black.jpg"),
    identity: "its solid glossy black coat without white patches, vivid green eyes, black nose, upright ears and compact healthy adult body"
  },
  "abyssinian-cat": {
    species: "cat",
    breed: "adult ruddy Abyssinian cat",
    path: path.join(ROOT, "apps/website/public/assets/work-abyssinian.jpg"),
    identity: "its warm ruddy ticked coat, darker forehead markings, large upright ears, golden almond eyes, terracotta nose and elegant healthy adult body"
  },
  "shiba-dog": {
    species: "dog",
    breed: "adult red Shiba Inu",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-shiba.jpg"),
    identity: "its red-and-cream coat, cream cheeks and chest, dark almond eyes, triangular upright ears, curled tail and compact sturdy adult body"
  },
  "husky-dog": {
    species: "dog",
    breed: "adult grey-and-white Siberian Husky",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-husky.jpg"),
    identity: "its symmetrical grey cap, broad white facial blaze, white muzzle and chest, ice-blue eyes, upright triangular ears and athletic adult double-coated body"
  },
  "black-labrador-dog": {
    species: "dog",
    breed: "adult black Labrador Retriever",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-black-lab.jpg"),
    identity: "its solid glossy black coat, warm brown eyes, broad black nose, soft dropped ears and strong healthy adult Labrador build"
  },
  "golden-retriever-dog": {
    species: "dog",
    breed: "adult Golden Retriever",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-golden.jpg"),
    identity: "its warm golden coat, floppy feathered ears, dark friendly eyes, broad soft muzzle and full healthy adult retriever build"
  },
  "corgi-dog": {
    species: "dog",
    breed: "adult Pembroke Welsh Corgi",
    path: path.join(ROOT, "tools/imagegen/out/source/dog-corgi.jpg"),
    identity: "its tan-and-white coat, broad white blaze, white muzzle and chest, dark eyes, large upright ears, short legs and compact sturdy adult body"
  },
  "german-shepherd-dog": {
    species: "dog",
    breed: "adult German Shepherd",
    path: path.join(ROOT, "apps/website/public/assets/hero-shepherd.jpg"),
    identity: "its tan coat with a defined black saddle and mask, brown eyes, tall upright ears, black muzzle and athletic healthy adult build"
  },
  "toy-poodle-dog": {
    species: "dog",
    breed: "adult apricot Toy Poodle",
    path: path.join(ROOT, "apps/website/public/assets/avatar-poodle.jpg"),
    identity: "its warm apricot tight curls, round dark eyes, small dark nose, rounded muzzle, floppy curly ears and compact healthy adult body"
  }
};

const templates = [
  {
    id: "original-magic-academy",
    title: "原创魔法学院",
    master: "original-magic-academy_dragon-li-cat_9x16_v01.png",
    anchor: 0.5,
    invariant: "the exact warm stone magic classroom, arched leaded window, dark wood potion counter, steaming black cauldron, potion bottles, seated lower-left composition, black robe, green striped scarf, silver trim, floor reflection and original four-point-star-and-paw academy crest",
    subject: "Replicate the master's complete seated three-quarter pose, front-paw placement, tail silhouette, direct calm gaze, facial expression and adult body scale. Refit only the robe openings around the new ears, neck, shoulders and forelegs. Keep the crest original and unchanged; do not introduce any known school name, crest, letter or franchise symbol.",
    style: "Match Image 1's exact polished cinematic photography, warm light, depth of field, surface texture and colour balance. Image 2 contributes no background, pose, light or photographic treatment.",
    text: "Do not add text, brand marks, watermarks or signatures."
  },
  {
    id: "epic-ruins",
    title: "史诗遗迹探险",
    master: "epic-ruins_german-shepherd-dog_16x9_v02.png",
    anchor: 0.5,
    invariant: "the exact 16:9 low-angle ruined-megastructure panorama, towering suspended gothic fragments, luminous circular arch, stormy blue-grey sky, rain, drifting debris, wet platform edge, cold steel-blue palette, sharp rim light, tiny scale figures, left-third subject scale and massive rectangular mechanical back rig",
    subject: "Replicate the master's left-third four-legged forward-ready full-body stance, body direction toward the middle-right ruins, alert determined gaze, head angle, expression and equipment contacts. Keep a mature, strong natural animal body with four complete connected limbs. The mechanical equipment remains a believable back-and-shoulder rig; no human face, hair, skin, hands, fingers, arms or torso may appear. Keep the wide monument field open across the middle and right.",
    style: "Match Image 1's exact cinematic realism, rain, cold backlight, depth, material rendering and restrained palette. Image 2 contributes identity only.",
    text: "No new text, logos, known IP, watermarks or signatures."
  },
  {
    id: "mini-companion",
    title: "同宠大小分身",
    master: "mini-companion_abyssinian-cat_9x16_v04.png",
    anchor: 0.5,
    invariant: "the exact high-key white studio, diagonal floor line, strong heroic low camera from below, large companion at left-front, miniature companion at right-rear, scale ratio, wide left-front-leg stance, shadows, black jackets, purple harnesses and blue-framed opaque mirrored ski goggles",
    subject: "Replace both master animals with two scale versions of the same new adult pet. The miniature is an adult duplicate, never a kitten or puppy. Replicate both upward-looking head attitudes, calm confident expressions and grounded poses. Keep the large figure's left front leg farther left in a wide powerful stance. On both figures centre the goggles on the eye line, bridge them over the upper nose, fully cover both eyes, and keep the strap behind the head below the ear bases. No eye may remain visible above, below or beside a lens; the goggles must not sit on the forehead or crown.",
    style: "Match Image 1's exact clean commercial outdoor-gear photography, high-key light, material textures, white balance and shadow softness. Image 2 contributes identity only.",
    text: "No text, logos, watermarks or signatures."
  },
  {
    id: "adventure-rules",
    title: "冒险生存法则",
    master: "adventure-rules_corgi-dog_9x16_v04.png",
    anchor: 0.5,
    invariant: "the exact aged parchment infographic, oversized top title, central full-body explorer, dense framed modules, hand-drawn maps, arrows, diagrams, terrain sections, equipment studies, bottom step strip, sepia-black ink palette, paper stains, antique linework, woven hat, layered travel clothes, scarf, backpack roll, straps, pouches and flashlight",
    subject: "Replace the central pet and every small pet illustration with the same new identity. Replicate the master's complete stable upright biped stance from head to both grounded hind paws, vertical torso, supported hips, two separate legs, forepaws without fingers, head angle, focused downward gaze and balanced explorer pose. Keep skull, neck, shoulders, chest and spine on one natural perspective axis; never paste a frontal head onto an angled body. Preserve all complete limbs and equipment contacts.",
    style: "Render every new pet depiction in Image 1's exact sepia hand-inked field-manual style. Image 2 contributes no photography, lighting or realistic surface texture.",
    text: "Preserve the exact title, subtitle, section headings, layout and short copy already present in Image 1. Do not add human-explorer wording, logos, watermarks or signatures."
  },
  {
    id: "pet-life-journal",
    title: "本宠生涯日记",
    master: "pet-life-journal_toy-poodle-dog_9x16_v01.png",
    anchor: 0.5,
    invariant: "the exact warm campus-at-sunset scene, old stone building, glowing windows, lawn, path, right-side tree, outdoor wooden table, open notebook, pen, laptop with a plain unbranded paw mark, green sweater, soft backlight, film warmth and all pastel hand-drawn annotations, arrows, stars, hearts and clouds",
    subject: "Replicate the master's lower-right seated study pose, gentle downward focused expression, head angle, green sweater and exact interactions with the notebook, pen, laptop and table. Keep natural connected animal forepaws at the contact points. Remove the master animal completely and leave no human face, hair, skin, arm, hand or finger.",
    style: "Match Image 1's exact warm photographic treatment and preserve the hand-drawn annotation medium, placement and colour. Image 2 contributes identity only.",
    text: "Preserve the existing readable annotation phrases and their placement. Keep the laptop mark as one small plain paw icon; no brand logo, watermark or signature."
  },
  {
    id: "ink-portrait",
    title: "黑白水墨肖像",
    master: "ink-portrait_black-labrador-dog_9x16_reset-v03-reference-gaze-rerun-v01.png",
    anchor: 0.38,
    invariant: "the exact right-facing bust crop, head turn, paper-white negative space, large black ink masses, broken contour, dry-brush gaps, splatters and long diagonal downward strokes",
    subject: "Use the gaze from Image 1 exactly. Replicate Image 1's eye direction, eyelid shape, brow energy, expression, muzzle angle, ear attitude, head proportion and adult silhouette. Image 2 controls only the replacement breed identity; it must never redesign the gaze, expression or pose.",
    style: "Image 1 is the absolute authority for the whole face and body treatment. Convert every replacement feature, including eyes, eyelids, nose, mouth, ears and coat markings, into the same flat black-and-white hand-drawn ink language. Use broad graphic ink masses, broken dry edges, paper gaps and a few decisive linear marks. No realistic eyeball, iris depth, catchlight, wet nose, photographic fur, continuous hair strands, anatomical volume, smooth gradient, 3D shading, camera light or pasted photo face.",
    text: "Keep the image free of text, colour, logos, watermarks and signatures."
  },
  {
    id: "decorative-art-portrait",
    title: "装饰艺术肖像",
    master: "decorative-art-portrait_ragdoll-cat_9x16_v05.png",
    anchor: 0.4,
    invariant: "the exact three-quarter right-facing bust, warm off-white paper, large navy-black polygonal fragments, translucent grey facets, cream paper gaps, sharp broken ear and shoulder edges, sparse whisker lines, generous negative space and faint inset border shadow",
    subject: "Replicate Image 1's head angle, rightward gaze, quiet gentle expression, bust scale, adult silhouette and fragment placement rhythm. Express the new identity only through its breed-specific outer silhouette, coat-colour distribution, ear shape and the minimum facial facets needed for recognition.",
    style: "Flatten the complete replacement face and body into Image 1's exact two-dimensional fragmented ink-and-paper collage. Eyes, brow, cheeks, muzzle, nose and mouth must be flat angular paint shapes with paper gaps and no realistic face underneath. No circular iris, catchlight, wet eye, eyelid volume, rounded nose, individual fur strands, smooth gradients, anatomical skull volume, studio light, low-poly 3D rendering or pasted photo face. Keep the restrained navy, grey, cream and paper palette.",
    text: "No added colour accent, text, logo, watermark or signature."
  }
].map((template) => ({
  ...template,
  orientation: "portrait",
  size: outputSpecs.portrait.size,
  masterPath: path.join(REFERENCE_ROOT, "masters", template.master)
}));

const matrix = [
  ["original-magic-academy", "cat", "devon-rex-cat"],
  ["original-magic-academy", "dog", "shiba-dog"],
  ["epic-ruins", "cat", "maine-coon-cat"],
  ["epic-ruins", "dog", "husky-dog"],
  ["mini-companion", "cat", "ragdoll-cat"],
  ["mini-companion", "dog", "black-labrador-dog"],
  ["adventure-rules", "cat", "british-shorthair-cat"],
  ["adventure-rules", "dog", "golden-retriever-dog"],
  ["pet-life-journal", "cat", "tuxedo-cat"],
  ["pet-life-journal", "dog", "corgi-dog"],
  ["ink-portrait", "cat", "black-cat"],
  ["ink-portrait", "dog", "german-shepherd-dog"],
  ["decorative-art-portrait", "cat", "abyssinian-cat"],
  ["decorative-art-portrait", "dog", "toy-poodle-dog"]
];

const targetedRevisions = {
  "original-magic-academy_cat_devon-rex-cat": {
    version: "v02",
    promptAddendum: "Targeted posture correction only: preserve every other detail from Image 1. Keep the same seated position and paw placement, but make the adult pet sit naturally taller and more alert, with a gently upright spine, open chest, relaxed shoulders set back rather than rounded forward, a comfortably extended neck and the head balanced above the torso. Remove the hunched or slumped impression without making the pose stiff, human-like or over-posed. Keep the same calm gaze, facial expression, robe, scarf, crest, tail, scene, camera, lighting and all props unchanged."
  },
  "original-magic-academy_dog_shiba-dog": {
    version: "v02",
    promptAddendum: "Targeted posture correction only: preserve every other detail from Image 1. Keep the same seated position and paw placement, but make the adult pet sit naturally taller and more alert, with a gently upright spine, open chest, relaxed shoulders set back rather than rounded forward, a comfortably extended neck and the head balanced above the torso. Remove the hunched or slumped impression without making the pose stiff, human-like or over-posed. Keep the same calm gaze, facial expression, robe, scarf, crest, tail, scene, camera, lighting and all props unchanged."
  },
  "adventure-rules_cat_british-shorthair-cat": {
    version: "v02",
    promptAddendum: "Targeted face correction only: use the gaze and facial expression from Image 1 exactly. Keep the mouth fully closed, the muzzle relaxed, the eyes calm and focused slightly upward in the same direction as Image 1, and the head on the same natural three-quarter axis as the upright body. No direct wide-eyed camera stare, open smile, visible tongue, excited expression or changed hat angle. Preserve the successful upright body, limbs, clothing, equipment, layout, text and all small repeated pet illustrations."
  },
  "adventure-rules_dog_golden-retriever-dog": {
    version: "v03",
    promptAddendum: "Face correction only: use Image 1's gaze and expression exactly. Keep the mouth closed and relaxed. No camera stare, smile or tongue. Preserve the upright body and every other master detail."
  },
  "pet-life-journal_cat_tuxedo-cat": {
    version: "v02",
    promptAddendum: "Targeted correction: use the head angle and gaze from Image 1 exactly. Keep the head gently lowered toward the open notebook and pen, with the same quiet focused study expression. Do not look directly at the camera and do not look upward. Preserve the exact paw-to-pen, paw-to-laptop, sweater and tabletop contacts from Image 1."
  },
  "pet-life-journal_dog_corgi-dog": {
    version: "v02",
    promptAddendum: "Targeted correction: use the head angle and gaze from Image 1 exactly. Keep the head gently lowered toward the open notebook and pen, with the same quiet focused study expression. Do not look directly at the camera and do not look upward. Preserve the exact paw-to-pen, paw-to-laptop, sweater and tabletop contacts from Image 1."
  },
  "ink-portrait_cat_black-cat": {
    version: "v03",
    promptAddendum: "Targeted style correction: treat Image 2 only as a breed-identity label, never as a renderable face or texture source. Use the gaze from Image 1 exactly. Rebuild the entire replacement face from Image 1's broad black ink masses, paper-white gaps, broken dry-brush edges and a few decisive lines. The face must read as hand-painted black ink before it reads as an animal portrait. Eliminate realistic eye surfaces, iris detail, nose volume, whisker roots, fine fur direction and dense grey micro-texture. Do not place a detailed photographic or pencil-rendered face above the master's ink-stroke body."
  },
  "ink-portrait_dog_german-shepherd-dog": {
    version: "v03",
    promptAddendum: "Targeted style correction: treat Image 2 only as a breed-identity label, never as a renderable face or texture source. Use the gaze from Image 1 exactly. Rebuild the entire replacement face from Image 1's broad black ink masses, paper-white gaps, broken dry-brush edges and a few decisive lines. The face must read as hand-painted black ink before it reads as an animal portrait. Eliminate realistic eye surfaces, iris detail, nose volume, whisker roots, fine fur direction and dense grey micro-texture. Do not place a detailed photographic or pencil-rendered face above the master's ink-stroke body."
  },
  "decorative-art-portrait_cat_abyssinian-cat": {
    version: "v03",
    promptAddendum: "Targeted abstraction correction: treat Image 2 only as a breed-identity label, never as a source of realistic facial texture, colour or depth. Remap the new pet entirely into Image 1's restrained paper-white, cream, translucent grey and navy-black palette; do not copy literal ruddy, tan, brown or orange colour from Image 2. Break the complete face, including both eyes, brow, cheeks, muzzle and nose, into the master's few large flat angular fragments with visible paper gaps. There must be no continuous realistic face, fur layer or detailed eyeball under the fragments."
  },
  "decorative-art-portrait_dog_toy-poodle-dog": {
    version: "v03",
    promptAddendum: "Targeted abstraction correction: treat Image 2 only as a breed-identity label, never as a source of realistic facial texture, colour or depth. Remap the new pet entirely into Image 1's restrained paper-white, cream, translucent grey and navy-black palette; do not copy literal apricot, tan, brown or orange colour from Image 2. Break the complete face, including both eyes, brow, cheeks, muzzle and nose, into the master's few large flat angular fragments with visible paper gaps. There must be no continuous realistic face, fur layer or detailed eyeball under the fragments."
  }
};

export const thirdBatchValidationJobs = matrix.map(([templateId, variant, identityId]) => {
  const id = `${templateId}_${variant}_${identityId}`;
  const revision = targetedRevisions[id] || {};
  return {
    id,
    variant,
    identityId,
    version: revision.version || "v01",
    promptAddendum: revision.promptAddendum || "",
    template: templates.find((item) => item.id === templateId),
    pet: identities[identityId]
  };
});

export function buildThirdBatchValidationPrompt(job) {
  const { template, pet } = job;
  if (template.id === "original-magic-academy") {
    return [
      "Edit Image 1 into one exact 720x1280 vertical image using exactly two inputs. Image 1 is our frozen self-owned master. No third-party effect reference is included. Scene-change budget is 0%.",
      `Replace only the master pet with the exact adult ${pet.breed} from Image 2, preserving ${pet.identity}. Image 2 supplies identity only, not pose, expression, background, light or rendering.`,
      "Keep Image 1's exact stone classroom, arched window, potion counter, bottles, steaming cauldron, camera, crop, warm light, black robe, green striped scarf, silver trim, original paw-and-star crest, tail placement, calm gaze and facial expression unchanged.",
      "Posture correction only: retain the same seated position and front-paw placement, but make the pet sit naturally taller and more alert with a gently upright spine, open chest, relaxed shoulders set back rather than rounded forward, comfortably extended neck and head balanced above the torso. No hunched, slumped, stiff or human-like posture.",
      "Keep mature natural breed proportions and correct connected anatomy. No new object, text, logo, known IP, watermark or signature."
    ].join(" ");
  }
  if (template.id === "adventure-rules") {
    return [
      "Edit Image 1 into one exact 720x1280 vertical image using exactly two inputs. Image 1 is our frozen self-owned master and controls the whole parchment page. No third-party effect reference is included. Scene-change budget is 0%.",
      `Replace every pet in Image 1, central and small, with the same adult ${pet.breed} from Image 2, preserving ${pet.identity}. Image 2 supplies identity only.`,
      "Keep every other Image 1 detail unchanged: crop, layout, all existing text, maps, diagrams, repeated illustrations, sepia hand-inked style, paper texture, woven hat, clothes, scarf, backpack, straps, pouches and flashlight.",
      "Copy Image 1's exact complete upright biped pose, head angle, gaze and closed-mouth expression. Keep the head, neck, shoulders, chest and spine naturally aligned; show two separate grounded hind legs and two complete forepaws without fingers. No crouch, pasted head, twisted neck, hidden or fused limbs, human body, photography, logo, watermark or signature.",
      job.promptAddendum
    ].join(" ");
  }
  if (template.id === "ink-portrait") {
    return [
      "Edit Image 1 into one exact 720x1280 vertical runtime validation image using exactly two inputs.",
      "Image 1 is our frozen self-owned master and the edit target. Keep its exact crop, placement, head angle, expression, gaze, paper-white negative space, black ink masses, broken dry-brush edges, splatters and long diagonal strokes. No third-party effect reference is included. Scene-change budget is 0%.",
      `Replace only the animal identity with the exact adult ${pet.breed} from Image 2. Use Image 2 only to recognise breed silhouette, ears and coat-marking layout; do not render or copy its face, eyes, nose, fur texture, lighting, colour or photographic depth.`,
      "Use the gaze from Image 1 exactly. Paint the complete new face in the exact same black-ink vocabulary as Image 1: a few broad opaque black shapes, paper gaps, broken dry edges and sparse decisive lines. The face and body must be one continuous hand-painted ink work, never a detailed portrait placed over an ink-stroke body.",
      "No realistic or pencil-rendered eyeballs, irises, catchlights, nose volume, individual fur direction, grey micro-shading, gradients, 3D anatomy, photography, colour, text, logo, watermark or signature. Keep a mature, healthy and attractive breed silhouette with correct connected anatomy."
    ].join(" ");
  }
  if (template.id === "decorative-art-portrait") {
    return [
      "Edit Image 1 into one exact 720x1280 vertical runtime validation image using exactly two inputs.",
      "Image 1 is our frozen self-owned master and the edit target. Keep its exact crop, right-facing head angle, quiet gaze, bust scale, warm paper, border, negative space, shard placement rhythm and restrained paper-white, cream, translucent-grey and navy-black palette. No third-party effect reference is included. Scene-change budget is 0%.",
      `Replace only the animal identity with the exact adult ${pet.breed} from Image 2. Use Image 2 only to recognise the breed's outer silhouette, ears and coat-marking layout; do not render or copy its face, eyes, nose, fur texture, literal colour, lighting or photographic depth.`,
      "Build the complete new head, eyes, brow, cheeks, muzzle, nose, ears, neck and chest only from the same few large flat angular navy, grey, cream and paper-gap fragments used by Image 1. The whole face must be visibly broken and abstract at first glance, with no continuous realistic animal face underneath.",
      "No detailed eyeballs, circular irises, catchlights, rounded wet nose, pencil drawing, tiny fur facets, continuous hair strands, smooth gradients, 3D skull volume, photography, tan, brown or orange wash, text, logo, watermark or signature. Keep the fragmented face coherent, mature, healthy and attractive."
    ].join(" ");
  }
  return [
    "Use case: compositing and identity-preserving template transfer. Produce one exact 720x1280 vertical 9:16 runtime validation image from exactly two input images.",
    "Image 1 is our frozen self-owned production master. It is the sole authority for every non-identity detail: scene, composition, crop, camera, pose, action, expression, gaze, lighting, palette, rendering medium, brushwork, clothing, text, props and all physical contacts. No third-party effect reference is included. Image 2 is the sole new-pet identity reference.",
    "Change only the pet identity. Remove every depiction and every residual feature of the master pet, then replace it with the new pet from Image 2. Scene-change budget is 0%. Do not redesign, reinterpret, clean up, recolour, restyle, simplify, move, delete or add anything in the master scene.",
    `Keep ${template.invariant}.`,
    template.subject,
    `The replacement must be the exact ${pet.breed} from Image 2. Preserve ${pet.identity}. Image 2 controls only species, breed, coat colour and markings, ear shape, eye colour, actual adult age and natural healthy breed proportions. Do not copy Image 2's pose, expression, gaze, camera, background, lighting, photographic texture or rendering style.`,
    "Preserve the pet's actual adult age and mature breed proportions. Do not juvenilize it, enlarge the head or eyes, shorten the muzzle or body, or convert it into a kitten, puppy or generic cute mascot. Keep it healthy, attractive and immediately likeable without changing the master's expression or art direction.",
    template.style,
    template.text,
    job.promptAddendum,
    "Keep exactly one pet identity throughout, except where the frozen master intentionally contains multiple views or two scale duplicates of that same identity. No unrelated animal, residual old-pet coat, face or limb. Correct species anatomy only: no duplicate, fused, missing or amputated-looking limbs, extra ears, warped eyes, malformed mouth, floating tail, human hands or fingers, broken garment boundaries, pasted head, disconnected neck or failed prop contact. Preserve all non-pet pixels and relationships as closely as the model allows."
  ].join(" ");
}
