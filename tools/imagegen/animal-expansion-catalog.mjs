import path from "node:path";

import { identities, expansionOutputSpecs, relativeToRoot } from "./reference-expansion-catalog.mjs";

const ROOT = path.resolve(import.meta.dirname, "../..");
const EFFECT_ROOT = path.join(ROOT, "apps", "website", "public", "assets", "example", "animal");

const rows = [
  ["animal-desert-pilot", "career", "jimeng-2026-05-04-7134-迷你鸭嘴獸首角色，頭戴舊化飛行帽或防護頭盔，配有多層鏡片護目鏡，點綴隨即色或銅色....png", "shepherd-dog", "portrait", "沙漠飞行员", "Keep the weathered flight helmet, layered goggles, scarf, rugged clothing, desert ground and full-body stance; replace only the platypus identity with a natural adult pet."],
  ["animal-headphone-streetwear", "character", "jimeng-2026-05-07-9340-IP形象设计：Q版，一只毛茸茸的黑色小猫，戴着耳麦，陶醉的神态，身穿白色潮流T恤....png", "blue-british-cat", "portrait", "耳麦潮流宠物", "Keep the headphones, white streetwear shirt, relaxed music-listening expression and clean poster layout. The face, muzzle, eyes and head-to-body ratio must read clearly as a polished Q-version cartoon character rather than realistic pet photography, while keeping one coherent adult pet identity."],
  ["animal-sunglasses-rabbit", "fun", "jimeng-2026-05-28-1817-极繁主义，笔触细腻，仰拍，一个毛绒绒的小白兔，戴着墨镜，系着围巾，站在草丛中，被....png", "cream-cat", "portrait", "草丛墨镜萌宠", "Keep the low-angle crop, sunglasses, scarf, grass, sky and airy maximalist brushwork. Render the entire face and both complete ears with the same dense fluffy softness and fine painterly fur as the body; no smooth, bald or thinly rendered facial zones."],
  ["animal-capybara-snapshot", "fun", "jimeng-2026-06-01-2422-一只拟人化的水豚，以日常快照的视觉风格展现，照片中没有明确的主体或构图感，还带有....png", "golden-dog", "portrait", "日常快照萌宠", "Keep the candid office snapshot, collar tag, monitor background, casual framing and natural imperfect composition. The pet must have a serious, unsmiling closed-mouth expression; do not turn it into a cheerful pose or a polished studio portrait."],
  ["animal-giant-city-companion", "action", "jimeng-2026-06-06-2771-超现实，一只巨大的猫咪在楼宇间穿行，最高的楼只有猫的一半身高。猫咪好奇的看着行驶....png", "ragdoll-cat", "portrait", "巨型城市伙伴", "Keep the giant scale, city canyon, street traffic, low-angle perspective and atmospheric realism. Both eyes must look clearly downward at the tiny people and traffic on the ground with focused curiosity; the giant cat must never look at the camera."],
  ["animal-doodle-fisheye-chicken", "fun", "jimeng-2026-06-11-3822-涂鸦，粗略，极简画的是一只呆头鸡，大眼睛，鱼眼镜头，插图是手绘的，杂乱的艺术线条....png", "corgi-dog", "portrait", "鱼眼涂鸦表情", "Keep the rough hand-drawn chicken doodle, oversized eyes, fish-eye distortion, loose black lines and white background; translate the same expression to one cute adult pet."],
  ["animal-car-window-westie", "career", "jimeng-2026-06-13-2042-主体：西高地白梗犬，白色蓬松被毛，全部毛发被风吹起，半眯眼的慵懒神态，拟人化穿着....png", "poodle-dog", "landscape", "车窗风中写真", "Keep the wide car-window composition, windblown fur, blue outfit, yellow vehicle and sleepy half-closed eyes; preserve a healthy adult body and natural paw placement."],
  ["animal-enamel-dragon", "character", "jimeng-2026-06-20-2057-图片风格为CG 厚涂,CG 厚涂，游戏CG ，丰富的色彩层次，质感细腻，真实光影....png", "husky-dog", "portrait", "珐琅彩龙宠", "Keep the rich CG paint layers, luminous enamel-like dragon body, dramatic red background and central fantasy presentation; replace the fantasy creature identity while preserving the visual language."],
  ["animal-ink-scratch-portrait", "art", "jimeng-2026-06-21-1396-极简主义素描风格，空气感强，松散的细密长线条，精致的涂抹，形式多变，写意，细节敲....png", "black-lab-dog", "portrait", "空气感素描肖像", "Keep the minimalist long-line sketch, white negative space, loose smudging and elegant side-facing portrait; render the pet face entirely in the same ink language."],
  ["animal-enamel-cat-beast", "character", "jimeng-2026-06-23-1938-cg插画，珐琅彩猫神兽，无尾。浓密绵长的彩绘线条环绕神兽，向后飘舞、流动，拉出残....png", "ragdoll-cat", "portrait", "流体珐琅猫神兽", "Keep the no-tail fantasy silhouette, dense flowing painted lines, luminous enamel palette, red field and centered action. The first read must be one majestic adult seal-bicolour Ragdoll cat with a broad fluffy cream-white face, dark seal ears and mask accents, clear blue eyes and long silky chest fur."],
  ["animal-watercolor-cat-closeup", "art", "jimeng-2026-06-23-4902-手绘插画，金箔岩彩，古风写意，水墨油画交融流体笔触，大面积淡彩晕染，猫咪局部特写....png", "ragdoll-cat", "portrait", "金箔水彩猫咪", "Keep the close crop, pale aqua and gold wash, antique illustrative brushwork, soft highlights and fine facial details; make the pet face painterly rather than photographic."],
  ["animal-glass-paw-portrait", "fun", "jimeng-2026-06-30-9004-帮我生成图片：保持脸不变，水后时尚宠物写真，泰迪头部特写，极近距离拍摄，比熊神态....png", "poodle-dog", "portrait", "玻璃爪印特写", "Keep the underwater/glass close-up, paw contact against the transparent surface, distorted perspective, reflections and cute playful expression. Use an unmistakable adult toy poodle/Teddy identity, and preserve the bright moving caustic bands projected through the water surface across the face and curls."],
  ["animal-urban-takeover-poster", "career", "jimeng-2026-07-09-7260-英文活动海报，软萌拟猫咪形象少女，身着街头华丽短裙，搭配超大码板鞋；伸手朝向镜头....png", "tuxedo-cat", "portrait", "城市潮流活动海报", "Keep the English poster hierarchy, oversized sneaker perspective, reaching action, street outfit, typography blocks and energetic city treatment; replace known event or IP wording with original pet-safe wording."],
  ["animal-giant-law-poster", "action", "jimeng-2026-07-11-4451-电影级，8K超高清，超广角仰拍，巨物恐惧，法天象地，至尊法相，人形巨神，身高万丈....png", "shepherd-dog", "portrait", "巨物法相海报", "Keep the extreme low angle, clouds, lightning, tiny human scale cues and epic poster hierarchy. The animal face must occupy a smaller portion of the frame while the colossal upright humanoid divine-form body, shoulders, torso and limbs read as vastly more monumental and imposing; retain an adult shepherd-dog identity without reverting to a normal four-legged pet portrait."],
  ["animal-fantasy-double-exposure", "action", "jimeng-2026-07-21-2568-Frank Frazetta绘画风格，奇幻插画大师，奇幻诡异风格双重曝光风格的高....png", "black-lab-dog", "portrait", "奇幻双重曝光", "Keep the dark fantasy double exposure, profile silhouette, landscape layers, warm highlights and painterly atmosphere; do not reproduce a named artist or known character identity."],
  ["animal-warrior-cat", "character", "jimeng-2026-07-22-6567-插画风格特效，古风，动漫风，3D，大师作品，超高清，动态，一只超萌的剑客猫耳娘作....png", "abyssinian-cat", "portrait", "古风剑客宠物", "Keep the original sword, layered costume, upright stance, warm rim light and stylized action. Raise the overall exposure and clean fill light enough that the complete face, costume layers and body silhouette are clearly readable without washing out the dramatic colour contrast."],
  ["animal-sunglasses-rabbit-alt", "fun", "jimeng-2026-08-01-3172-极繁主义，笔触细腻，仰拍，一个毛绒绒的小白兔，戴着墨镜，系着围巾，站在草丛中，被....png", "golden-dog", "portrait", "草丛墨镜萌宠二", "Keep this separate reference's exact crop, sunglasses, scarf, grass and sky. The entire subject, especially the face contours and both ears, must use the same intentionally loose, scratchy, unfinished and slightly chaotic painterly marks as the reference rather than polished realistic fur."],
  ["animal-tiger-storm", "action", "jimeng-2026-08-06-7301-【正向提示词】 史诗级巨物恐惧症概念艺术图，电影级构图，蚂蚁视角，超现实主义。 ....png", "golden-dog", "portrait", "风暴巨兽概念", "Keep the ant-scale viewpoint, storm clouds, lightning, central colossal silhouette and cinematic concept-art hierarchy; replace the tiger identity with a natural adult pet, not a humanoid monster."],
  ["animal-pink-scooter", "career", "jimeng-2026-08-10-5195-夜晚城市街道上，一只穿粉色洛丽塔裙、戴粉色头盔的兔兔驾驶粉色复古小摩托疾驰，闭眼....png", "corgi-dog", "portrait", "粉色摩托夜行", "Keep the pink vintage scooter, helmet, Lolita-inspired outfit, night street, speed feeling and closed-eye joy; adapt paws and body contact naturally without changing the scene."],
  ["animal-haunted-cctv-panels", "action", "jimeng-2026-08-12-6903-每张图片只能有一个镜头分别用四张来展现从开始到最后的过程，废弃游乐园鬼屋的遗留监....png", "shiba-dog", "portrait", "鬼屋监控四格", "Keep the four separate surveillance frames, abandoned amusement-park setting, timestamps-like layout and escalating suspense; replace the source creature with the same adult pet in all frames."],
  ["animal-sword-cat-alt", "action", "jimeng-2026-08-13-4087-插画风格特效，古风，动漫风，3D，大师作品，超高清，动态，一只超萌的剑客猫耳娘作....png", "abyssinian-cat", "portrait", "古风剑客宠物二", "Keep this reference's independent costume, sword pose, blue-red lighting and dynamic illustration treatment. Use one natural adult light-grey Abyssinian-like cat matching the reference's shallow cool-grey coat and elegant facial structure; remove the humanoid character identity without changing the action."],
  ["animal-rabbit-yokai", "action", "jimeng-2026-08-13-8904-插画风格特效，古风，动漫风，3D，大师作品，超高清，动态，一只超萌的贱兔作男妖仔....png", "cream-cat", "portrait", "古风妖灵宠物", "Keep the blue costume, ornamental headpiece, frontal heroic pose, cool fantasy palette and dynamic 3D illustration treatment. Render the complete face, eyes, ears, fur edges, layered costume, ornaments and light effects with refined high-detail finish; no muddy facial anatomy, simplified accessories or unfinished surfaces."],
];

const versionOverrides = {
  "animal-headphone-streetwear": "v02",
  "animal-sunglasses-rabbit": "v02",
  "animal-capybara-snapshot": "v02",
  "animal-enamel-cat-beast": "v02",
  "animal-glass-paw-portrait": "v02",
  "animal-giant-law-poster": "stylebridge-v03",
  "animal-warrior-cat": "v02",
  "animal-sunglasses-rabbit-alt": "v02",
  "animal-sword-cat-alt": "v02",
  "animal-rabbit-yokai": "stylebridge-v03",
};

export const animalJobs = rows.map(([templateId, entryId, sourceFile, identityId, orientation, title, guard]) => ({
  templateId,
  entryId,
  title,
  sourceFile,
  effectReferencePath: path.join(EFFECT_ROOT, sourceFile),
  identityId,
  identity: identities[identityId],
  orientation,
  version: versionOverrides[templateId] || "v01",
  guard
}));

export function buildAnimalPrompt(job) {
  const output = expansionOutputSpecs[job.orientation];
  const pet = job.identity;
  return [
    "Use case: internal self-owned template master production through multi-image identity-preserving edit.",
    `Create an exact final ${output.ratio} composition at ${output.size} pixels.`,
    "Image 1 is a one-time third-party effect reference used only in this controlled offline production request. Image 2 is the sole self-owned pet identity reference. Never expose Image 1 at runtime or in a public sample.",
    "Replace every designated original animal, human-like creature or character subject in Image 1 with the exact adult pet identity from Image 2. Image 2 controls only species, breed, coat, markings, ears, eyes, actual age and healthy natural proportions.",
    "Image 1 controls every transferred visual detail: composition, camera, crop, perspective, action, pose, expression, gaze, lighting, palette, medium, line quality, brushwork, texture, clothing, landmarks, props, text layout and contact relationships.",
    "Preserve Image 1 exactly. Scene-change budget is 0%. Do not redesign, simplify, beautify, juvenilize, thin, elongate, age, recolour or clean up the background. Change only the designated subject identity and the smallest contact-boundary detail required for correct pet anatomy.",
    `The replacement must be an adult ${pet.breed} with ${pet.identity}. Render the face, fur and anatomy completely in Image 1's visual language; do not paste a photographic pet face into an illustration or turn a stylized scene into a realistic photo. Keep the pet appealing and healthy, never skinny, gaunt, uncanny, aggressive or puppy-like.`,
    job.guard,
    "Keep all meaningful text, clothing, landmarks and distinctive props unless a rights-safe replacement is explicitly required. Replace known people, teams, brands, platform UI, watermarks and copyrighted character or artist names with short original pet-safe wording while preserving the same text blocks and visual hierarchy. Do not generate new logos or signatures.",
    "Correct anatomy only: no extra ears, eyes, limbs, paws, fingers, fused joints, human hands, floating heads, broken clothing boundaries, residual source subject or duplicate pets. Keep one coherent adult pet identity throughout.",
    "This is a self-owned frozen-master candidate, not a runtime request. Return only the finished image."
  ].join(" ");
}

export function animalRelative(file) {
  return relativeToRoot(file);
}

if (import.meta.url === `file://${process.argv[1]?.replaceAll("\\", "/")}`) {
  console.log(JSON.stringify(animalJobs.map((job) => ({
    templateId: job.templateId,
    entryId: job.entryId,
    title: job.title,
    sourceFile: job.sourceFile,
    identityId: job.identityId,
    orientation: job.orientation
  })), null, 2));
}
