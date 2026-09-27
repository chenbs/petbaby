export const PET_ART_PHOTO_TEMPLATE_ID = "pet-art-photo";
export const PET_ART_PHOTO_VERSION = "v03";

export const petArtPhotoScenes = [
  { id: "window-morning", title: "蓝格睡衣卧室", description: "床上打哈欠 · 慵懒放松", prompt: "A real bright bedroom set with a blue gingham duvet, pale blue pillows and a tall window. The pet wears a soft blue gingham sleep cap and matching pajama collar, sitting in the bedding with a natural wide yawn. Morning window light and tactile cotton." },
  { id: "garden-curious", title: "绿幕恐龙朋友", description: "抱住玩偶 · 天真好奇", prompt: "A real green studio set with a leafy-green backdrop, knitted dinosaur hood and large soft plush dinosaur. The pet wears a simple green dinosaur hoodie and leans against the plush toy, looking toward camera with a curious innocent expression." },
  { id: "studio-confident", title: "薄荷领带影棚", description: "端坐回望 · 自信从容", prompt: "A red-and-cream editorial photo studio with a folding canvas deck chair, low wooden set edge and unbranded glass soda bottles. The pet wears a mint pinstripe shirt and turquoise tie, sitting upright and looking directly into the lens." },
  { id: "night-playful", title: "星夜小王子", description: "披风坐定 · 安静幻想", prompt: "A real dark-blue theatrical studio with paper stars, a small moon prop and a tiny plush fox. The pet wears a knitted mint sweater, mustard scarf and lightweight yellow cape, sitting naturally and gazing slightly upward. Photographic practical lights, no fantasy glow." },
  { id: "seaside-breeze", title: "柠檬黄日记", description: "柠檬入镜 · 俏皮大笑", prompt: "A saturated yellow tabletop studio with two fresh lemons on small stands, a red gingham head scarf and yellow gingham bib. The pet sits centered with a relaxed open-mouth expression. Real fruit and fabric texture, no hands." },
  { id: "library-whisper", title: "复古摄影师", description: "相机在旁 · 慢慢观察", prompt: "A warm cream vintage photography corner with brown corduroy jacket, silk neck scarf, tortoiseshell sunglasses and a compact film camera on the floor. The pet lies with front paws crossed and looks calmly past the lens. Natural window light." },
  { id: "autumn-leaves", title: "蓝调杂志封面", description: "耳机与领带 · 俏皮凝视", prompt: "A deep navy editorial set with orange-and-white over-ear headphones around the pet's neck, pale blue striped shirt and navy diagonal-striped tie. The pet sits in a confident three-quarter pose with a slightly open happy mouth. Blank background, no masthead or text." },
  { id: "snow-cabin", title: "黑白经典肖像", description: "黑白影棚 · 温柔凝视", prompt: "A timeless black-and-white film portrait on a pale gray seamless studio set. The pet sits naturally in a small dark velvet bow tie, looking slightly off-camera with a gentle expression. Real studio spotlight, soft contact shadow, textured floor and subtle silver-gelatin grain." },
  { id: "cafe-afternoon", title: "玫红眼镜写真", description: "衬衫领带 · 轻松回眸", prompt: "A rose-red and blush-pink real seamless-paper studio with soft reflected light. The pet wears a lavender-blue striped shirt, black tie with thin light stripes and oversized dark eyeglasses fitted naturally. Three-quarter standing pose, friendly tongue just visible." },
  { id: "lakeside-sunset", title: "草地花环午后", description: "花束相伴 · 温柔凝视", prompt: "A real outdoor garden portrait on a low picnic blanket with woven flower basket, loose daisies and gingham ribbon. The pet wears a pale linen collar with a tiny flower garland, sitting upright and gazing softly toward camera. Late-afternoon sunlight." },
  { id: "city-rain", title: "街头雨衣", description: "雨后水洼 · 小心探步", prompt: "A real covered city arcade after rain with clear acrylic umbrella, wet stone reflections and a small yellow raincoat on a low hook. The pet wears a mustard rain cape and carefully steps around a shallow puddle, looking down at the reflection. No signs or logos." },
  { id: "spring-picnic", title: "软玩具野餐", description: "野餐垫上 · 伸爪拨带", prompt: "A real spring picnic scene with blue checked blanket, woven basket, fabric ribbons, small plush rabbit and flowering branches. The pet wears a light knitted vest and gently bats one ribbon with one front paw while watching it. Bright daylight, no text." },
] as const;

export type PetArtPhotoSceneId = typeof petArtPhotoScenes[number]["id"];
export const PET_ART_PHOTO_SCENE_IDS = petArtPhotoScenes.map((scene) => scene.id) as [PetArtPhotoSceneId, ...PetArtPhotoSceneId[]];

export const legacyStyleSceneMap: Record<string, PetArtPhotoSceneId> = {
  "warm-film": "window-morning",
  "paper-cut": "garden-curious",
  studio: "studio-confident",
  fantasy: "night-playful",
};

export function resolvePetArtPhotoScene(input: { scene?: PetArtPhotoSceneId; style?: string }): PetArtPhotoSceneId {
  return input.scene || (input.style && legacyStyleSceneMap[input.style]) || "window-morning";
}

export function buildPetArtPhotoPrompt(sceneId: PetArtPhotoSceneId, rerollReason?: string) {
  const scene = petArtPhotoScenes.find((item) => item.id === sceneId);
  if (!scene) throw new Error("PET_ART_PHOTO_SCENE_INVALID");
  return [
    "Create one premium photorealistic editorial pet photograph using Image 1 as the sole pet identity reference.",
    "Preserve the pet's species, breed, facial structure, eye color, coat color and markings, actual age and healthy proportions. The pet must remain recognizable as the exact same individual. Do not copy the breed or markings of public sample images.",
    `Scene, action, expression, lighting and framing: ${scene.prompt}`,
    "Keep the complete pet visible at about 45-65% of frame height. Make clothing, props and the real set legible while preserving natural contact, fur texture and lens perspective. No human hands, extra limbs, duplicate pets, CGI, illustration, brand marks, pseudo-text, logo or watermark.",
    rerollReason === "pet-not-like" ? "Strengthen identity match to Image 1 while preserving the selected scene, action and expression." : "",
    rerollReason === "composition" ? "Improve framing and anatomy while preserving the selected scene, action and expression." : "",
    "Return exactly 720x1280.",
  ].filter(Boolean).join(" ");
}
