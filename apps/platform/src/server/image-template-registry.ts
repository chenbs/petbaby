import "server-only";

export type ImageTemplateSubjectMode = "pet" | "owner-pet" | "pet-human";
export type ImageTemplateOrientation = "portrait" | "landscape";
export type ImageTemplateStatus = "live" | "pending-master" | "pending-review";
export type ImageTemplateRerollReason = "owner-not-like" | "pet-not-like" | "too-animal" | "composition";

export type ImageTemplateDefinition = {
  entryId: string;
  templateId: string;
  title: string;
  subjectMode: ImageTemplateSubjectMode;
  orientation: ImageTemplateOrientation;
  size: "720x1280" | "1280x720";
  version: string;
  status: ImageTemplateStatus;
  masterStorageKey?: string;
  sampleStorageKey?: string;
};

const petHumanPrompt = [
  "1、以图二作为主要视觉参考，参考权重约 50%。",
  "最大程度保持图二的：整体场景与构图、环境与空间关系、主体动作与姿态、整体色调与光影氛围、美术风格与表现形式、画面质感、细节丰富度、精细程度与完成度。",
  "生成结果应整体呈现出与图二高度一致的视觉世界与艺术表现，不要改变图二原有的场景设计、环境色彩、构图逻辑和整体风格。",
  "允许在不破坏图二整体视觉统一性的前提下，对人物进行适度重新设计，包括：五官颜色、头发颜色与造型、装饰元素、装饰颜色与形状、服饰款式、服饰颜色及相关配饰。",
  "2、提取图一动物主体的核心视觉特征，参考权重约 50%，并将这些动物特征转换为自然的人类视觉语言，融入图二的人物主体设计。",
  "重点提取：眼睛特征、脸部特征、口鼻区域特征、整体配色、神态与气质、毛发质感、毛发颜色、纹理特征及具有辨识度的视觉细节。",
  "将提取出的动物特征抽象、转译并人类化表达，应用于图二人物的：五官与五官配色、发型与头发颜色、服饰颜色、服饰设计、配饰与装饰元素、帽子、簪子、耳钉、手表、手链、戒指、领带及其他细节配件。",
  "必须遵循以下原则：",
  "不得直接将动物的耳朵、鼻子、眼睛、嘴巴、爪子、毛发结构等动物器官原样移植到人物身上。",
  "禁止改变图二人物原有五官形状与基本结构。",
  "禁止改变图二原有场景颜色与整体环境色调。",
  "最终效果应呈现为：",
  "图二人物仍然是完整、自然、协调的人类角色，仅在五官颜色、服饰、装饰品和气质层面能够明显感受到图一动物的特征。",
].join("\n");

const templatePromptExtensions: Partial<Record<string, readonly string[]>> = {
  "dessert-shopkeeper": [
    "Keep the pet behind the strawberry cake, the pink shopkeeper outfit and bow, all surrounding strawberries, warm dessert-shop light and centered portrait framing.",
  ],
  "original-magic-academy": [
    "Keep the dark green magic-academy robe and scarf, stone classroom, potion props, warm cinematic light and the same seated full-body composition.",
  ],
  "animal-giant-city-companion": [
    "Keep the monumental pet scale among skyscrapers and traffic. Both eyes must stay directed downward toward the tiny people and cars with focused curiosity, never toward the camera.",
  ],
  "animal-doodle-fisheye-chicken": [
    "Replace the master animal completely with the target pet while preserving the playful doodle language: a round fisheye body, huge slightly asymmetric comic eyes and a very thick irregular black hand-drawn contour.",
    "The two pink-red cheek circles and broad saturated red-orange zigzag crayon patches across the lower torso and sides are fixed decorative graphics. They must remain immediately visible at thumbnail size regardless of the target pet's natural coat colour.",
    "Translate identity only through ears, muzzle, eye colour, head silhouette and simplified coat cues. Use flat wax-crayon fills and broken strokes; never realistic fur, fine grey pencil texture, photographic volume or chicken anatomy.",
  ],
  "animal-car-window-westie": [
    "Keep the pet leaning from the yellow car window, light green shirt, windblown fur, blue sky, green roadside landscape and the same horizontal travel-photo framing.",
  ],
  "pet-milk-tea-shopkeeper": [
    "Keep the pet behind the milk-tea counter, paper shop hat, beige apron, cups and tapioca props, warm cream shop interior and all existing sign layout.",
  ],
};

const publicPreviewStorageKeyOverrides: Partial<Record<string, string>> = {
  "dessert-shopkeeper": "samples/image-template-previews/dessert-shopkeeper-d72ec372bf8d.webp",
  "original-magic-academy": "samples/image-template-previews/original-magic-academy-32b3092734f2.webp",
  "animal-giant-city-companion": "samples/image-template-previews/animal-giant-city-companion-41bbb8ca30f7.webp",
  "animal-doodle-fisheye-chicken": "samples/image-template-previews/animal-doodle-fisheye-chicken-43759e12d722.webp",
  "animal-car-window-westie": "samples/image-template-previews/animal-car-window-westie-ce10c248c6be.webp",
  "animal-enamel-cat-beast": "samples/image-template-previews/animal-enamel-cat-beast-3672325be667.webp",
  "animal-glass-paw-portrait": "samples/image-template-previews/animal-glass-paw-portrait-6e0a57339333.webp",
  "animal-sword-cat-alt": "samples/image-template-previews/animal-sword-cat-alt-cf590e99fc55.webp",
  "mini-companion": "samples/image-template-previews/mini-companion-347ec9958433.webp",
  "pet-milk-tea-shopkeeper": "samples/image-template-previews/pet-milk-tea-shopkeeper-c88f2aafc907.webp",
};

export const imageTemplateEntries = [
  { id: "fun", title: "好笑出片" },
  { id: "together", title: "和我合照" },
  { id: "human", title: "如果它是人" },
  { id: "travel", title: "旅行打卡" },
  { id: "career", title: "职业反差" },
  { id: "action", title: "动作剧情" },
  { id: "character", title: "角色设定" },
  { id: "archive", title: "图鉴与档案" },
  { id: "art", title: "艺术肖像 / 纪念收藏" },
] as const;

const registeredTemplates: ImageTemplateDefinition[] = [
  { entryId: "fun", templateId: "pet-wanted-poster", title: "萌宠通缉令", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-wanted-poster-0171c933caae.webp" },
  { entryId: "fun", templateId: "pet-expression-grid", title: "今日表情九宫格", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-expression-grid-30c2d3341262.webp" },
  { entryId: "together", templateId: "fish-chase", title: "偷鱼大作战", subjectMode: "owner-pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/fish-chase-e1afae3de413.webp" },
  { entryId: "together", templateId: "garden-together", title: "和你在花园", subjectMode: "owner-pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/garden-together-005ea7abd8bb.webp" },
  { entryId: "together", templateId: "street-comic-together", title: "潮流漫画合照", subjectMode: "owner-pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/street-comic-together-f3df172173bd.webp" },
  { entryId: "together", templateId: "night-together", title: "夜间宠物合影", subjectMode: "owner-pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/night-together-424aeb7d8e1a.webp" },
  { entryId: "travel", templateId: "travel-selfie", title: "海岛自拍", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v05", status: "live", masterStorageKey: "samples/image-templates/travel-selfie-7cddcdca2c12.webp" },
  { entryId: "travel", templateId: "landmark-adventure", title: "环球地标与户外探险", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/landmark-adventure-61ebb97fa9a7.webp" },
  { entryId: "career", templateId: "pet-barista", title: "咖啡主理人", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v05", status: "live", masterStorageKey: "samples/image-templates/pet-barista-c35b8c8b79e3.webp" },
  { entryId: "career", templateId: "dessert-shopkeeper", title: "甜品饮品主理人", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "public-v02-master-v01", status: "live", masterStorageKey: "samples/image-templates/dessert-shopkeeper-d72ec372bf8d.webp" },
  { entryId: "career", templateId: "pet-runway", title: "宠物时装周", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/pet-runway-77a15753d65d.webp" },
  { entryId: "career", templateId: "original-magic-academy", title: "原创魔法学院", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "public-v02-master-v01", status: "live", masterStorageKey: "samples/image-templates/original-magic-academy-32b3092734f2.webp" },
  { entryId: "action", templateId: "roller-coaster", title: "过山车", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/roller-coaster-5b7a3eababd7.webp" },
  { entryId: "action", templateId: "epic-ruins", title: "史诗遗迹探险", subjectMode: "pet", orientation: "landscape", size: "1280x720", version: "v02", status: "live", masterStorageKey: "samples/image-templates/epic-ruins-7a47743b445d.webp" },
  { entryId: "character", templateId: "pet-character-sheet", title: "宠物角色设定集", subjectMode: "pet", orientation: "landscape", size: "1280x720", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-character-sheet-d10172f389dc.webp" },
  { entryId: "character", templateId: "mini-companion", title: "同宠大小分身", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/mini-companion-52fb067810d4.webp" },
  { entryId: "archive", templateId: "pet-encyclopedia", title: "本宠百科图鉴", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/pet-encyclopedia-4c9d456a080d.webp" },
  { entryId: "archive", templateId: "adventure-rules", title: "冒险生存法则", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/adventure-rules-c5b79e112180.webp" },
  { entryId: "archive", templateId: "pet-life-journal", title: "本宠生涯日记", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-life-journal-d7a87fba5d3d.webp" },
  { entryId: "art", templateId: "ink-portrait", title: "黑白水墨肖像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "reset-v03-reference-gaze-rerun-v01", status: "live", masterStorageKey: "samples/image-templates/ink-portrait-050b7f7f346b.webp" },
  { entryId: "art", templateId: "decorative-art-portrait", title: "装饰艺术肖像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v05", status: "live", masterStorageKey: "samples/image-templates/decorative-art-portrait-7113eeca312f.webp" },

  // 65 图扩展货架：34 张扩展模板均已获用户批准并冻结。
  { entryId: "fun", templateId: "fun-chef-expression-grid", title: "厨师表情九宫格", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/fun-chef-expression-grid-d9c9d2584cde.webp" },
  { entryId: "fun", templateId: "fun-breed-expression-grid", title: "品种表情九宫格", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/fun-breed-expression-grid-d1c4152bc5fc.webp" },
  { entryId: "fun", templateId: "fun-bubble-cat", title: "气泡萌语", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/fun-bubble-cat-69710dea4cf2.webp" },
  { entryId: "fun", templateId: "fun-scream-reaction", title: "尖叫瞬间", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/fun-scream-reaction-c3b2acd53a29.webp" },
  { entryId: "fun", templateId: "fun-comic-panels", title: "城堡巨型伙伴", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v03", status: "live", masterStorageKey: "samples/image-templates/fun-comic-panels-72dca582f7eb.webp" },
  { entryId: "fun", templateId: "fun-beach-caption", title: "海边三格字幕", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/fun-beach-caption-c2518f34eb41.webp" },
  { entryId: "fun", templateId: "fun-bunny-reaction", title: "情绪角色头像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/fun-bunny-reaction-90c37c304654.webp" },
  { entryId: "fun", templateId: "fun-heart-comic", title: "四格爱心漫画", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/fun-heart-comic-5f9f66be529f.webp" },
  { entryId: "fun", templateId: "fun-fisheye-closeup", title: "鱼眼近脸", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v03", status: "live", masterStorageKey: "samples/image-templates/fun-fisheye-closeup-446494747c63.webp" },
  { entryId: "fun", templateId: "fun-handwritten-greeting", title: "手写问候头像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/fun-handwritten-greeting-5595565a16c1.webp" },
  { entryId: "travel", templateId: "travel-rome-dog-selfie", title: "罗马地标自拍", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/travel-rome-dog-selfie-f6c0eb880908.webp" },
  { entryId: "travel", templateId: "travel-great-wall-drink", title: "长城举杯自拍", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/travel-great-wall-drink-c4342bfb0cc9.webp" },
  { entryId: "travel", templateId: "travel-paris-dog-selfie", title: "巴黎街景自拍", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v03", status: "live", masterStorageKey: "samples/image-templates/travel-paris-dog-selfie-52e868ef3f8a.webp" },
  { entryId: "travel", templateId: "travel-alpine-expedition", title: "雪山探险大片", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/travel-alpine-expedition-4892416eb16c.webp" },
  { entryId: "travel", templateId: "travel-glass-summer", title: "透明杯夏日视角", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/travel-glass-summer-a6f5669deade.webp" },
  { entryId: "career", templateId: "pet-milk-tea-shopkeeper", title: "奶茶店主理人", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "public-v01-master-v01", status: "live", masterStorageKey: "samples/image-templates/pet-milk-tea-shopkeeper-c88f2aafc907.webp" },
  { entryId: "career", templateId: "pet-streetwear-editorial", title: "潮流街拍主理人", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-streetwear-editorial-7b2f1e589489.webp" },
  { entryId: "career", templateId: "pet-autumn-festival", title: "秋日节庆写真", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-autumn-festival-b692c737ce20.webp" },
  { entryId: "career", templateId: "pet-forest-editorial", title: "森林棚拍主理人", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-forest-editorial-4a90eb0e6cf9.webp" },
  { entryId: "career", templateId: "pet-monocle-editorial", title: "单片眼镜绅士", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/pet-monocle-editorial-9d40c04b0935.webp" },
  { entryId: "action", templateId: "action-giant-companion", title: "巨型伙伴幻想", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/action-giant-companion-ee03411029a9.webp" },
  { entryId: "action", templateId: "action-original-sci-fi-poster", title: "原创科幻海报", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/action-original-sci-fi-poster-9c0f2b1f8cd4.webp" },
  { entryId: "character", templateId: "character-outfit-grid", title: "穿搭动作设定九宫格", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v03", status: "live", masterStorageKey: "samples/image-templates/character-outfit-grid-6dd9f9f41a8d.webp" },
  { entryId: "character", templateId: "character-product-blueprint", title: "宠物产品设定蓝图", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/character-product-blueprint-bb078b77ea8a.webp" },
  { entryId: "character", templateId: "character-snow-leopard", title: "雪豹幻想角色设定", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v05", status: "live", masterStorageKey: "samples/image-templates/character-snow-leopard-f399ef35aaa1.webp" },
  { entryId: "character", templateId: "character-white-tiger", title: "白虎多姿态设定", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/character-white-tiger-1223945670fe.webp" },
  { entryId: "character", templateId: "character-mini-display", title: "迷你搭档装备展示", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/character-mini-display-fd16dadc6131.webp" },
  { entryId: "archive", templateId: "archive-career-poster", title: "本宠高光生涯海报", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/archive-career-poster-29c191ad266f.webp" },
  { entryId: "archive", templateId: "archive-memory-double-exposure", title: "本宠记忆双曝", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/archive-memory-double-exposure-190b34cc6fb7.webp" },
  { entryId: "archive", templateId: "archive-dragon-atlas", title: "本宠龙纹图鉴", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/archive-dragon-atlas-fbbbc6fbc8cc.webp" },
  { entryId: "archive", templateId: "archive-fish-anatomy", title: "本宠结构图谱", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/archive-fish-anatomy-cf9676c5dfdb.webp" },
  { entryId: "art", templateId: "ink-silhouette", title: "直立情绪角色", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/ink-silhouette-ed16c5c7eda4.webp" },
  { entryId: "art", templateId: "ink-fullbody-flight", title: "立体情绪头像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/ink-fullbody-flight-8800ea7f50c0.webp" },
  { entryId: "art", templateId: "ink-brush-avatar", title: "飞羽水墨全身像", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/ink-brush-avatar-8df38948469b.webp" },

  // 宠物人化 V2：素材数字 ID N 稳定映射为 human-effect-NN，审批前不上传、不公开。
  { entryId: "human", templateId: "human-effect-01", title: "宠物人化 01", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-01-a927e036d08d.webp" },
  { entryId: "human", templateId: "human-effect-02", title: "宠物人化 02", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-02-30c797531c47.webp" },
  { entryId: "human", templateId: "human-effect-03", title: "宠物人化 03", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-03-1b1a9db5a435.webp" },
  { entryId: "human", templateId: "human-effect-04", title: "宠物人化 04", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-04-ccc17cf9c205.webp" },
  { entryId: "human", templateId: "human-effect-05", title: "宠物人化 05", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-05-bd4a6e9079d6.webp" },
  { entryId: "human", templateId: "human-effect-06", title: "宠物人化 06", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-06-82930d1920c4.webp" },
  { entryId: "human", templateId: "human-effect-07", title: "宠物人化 07", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-07-290fc960f7cc.webp" },
  { entryId: "human", templateId: "human-effect-08", title: "宠物人化 08", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-08-12f0dd2d6746.webp" },
  { entryId: "human", templateId: "human-effect-09", title: "宠物人化 09", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-09-21e504d1316f.webp" },
  { entryId: "human", templateId: "human-effect-10", title: "宠物人化 10", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-10-65bb836ea431.webp" },
  { entryId: "human", templateId: "human-effect-11", title: "宠物人化 11", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-11-11b5aa226d33.webp" },
  { entryId: "human", templateId: "human-effect-12", title: "宠物人化 12", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-12-77a2d28b95c1.webp" },
  { entryId: "human", templateId: "human-effect-13", title: "宠物人化 13", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-13-6e8a5b6cc997.webp" },
  { entryId: "human", templateId: "human-effect-14", title: "宠物人化 14", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-14-9486bbcc4644.webp" },
  { entryId: "human", templateId: "human-effect-15", title: "宠物人化 15", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-15-771b705c8249.webp" },
  { entryId: "human", templateId: "human-effect-16", title: "宠物人化 16", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-16-7780c8f70285.webp" },
  { entryId: "human", templateId: "human-effect-17", title: "宠物人化 17", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-17-1b3593483479.webp" },
  { entryId: "human", templateId: "human-effect-18", title: "宠物人化 18", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-18-294820366b14.webp" },
  { entryId: "human", templateId: "human-effect-19", title: "宠物人化 19", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-19-a200dce06825.webp" },
  { entryId: "human", templateId: "human-effect-20", title: "宠物人化 20", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-20-4a8541055192.webp" },
  { entryId: "human", templateId: "human-effect-21", title: "宠物人化 21", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-21-90776adfd549.webp" },
  { entryId: "human", templateId: "human-effect-22", title: "宠物人化 22", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-22-e487fd46400c.webp" },
  { entryId: "human", templateId: "human-effect-23", title: "宠物人化 23", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-23-c648aa659485.webp" },
  { entryId: "human", templateId: "human-effect-24", title: "宠物人化 24", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-24-3d5898c03757.webp" },
  { entryId: "human", templateId: "human-effect-25", title: "宠物人化 25", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-25-2fc22e61a114.webp" },
  { entryId: "human", templateId: "human-effect-26", title: "宠物人化 26", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-26-af4a29f85ef1.webp" },
  { entryId: "human", templateId: "human-effect-27", title: "宠物人化 27", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-27-ccec562a1dc6.webp" },
  { entryId: "human", templateId: "human-effect-28", title: "宠物人化 28", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-28-66ff11375df1.webp" },
  { entryId: "human", templateId: "human-effect-29", title: "宠物人化 29", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-29-34e10c51ce58.webp" },
  { entryId: "human", templateId: "human-effect-30", title: "宠物人化 30", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-30-42e99d930586.webp" },
  { entryId: "human", templateId: "human-effect-31", title: "宠物人化 31", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-31-4f33700902a6.webp" },
  { entryId: "human", templateId: "human-effect-32", title: "宠物人化 32", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-32-cf7a9549c795.webp" },
  { entryId: "human", templateId: "human-effect-33", title: "宠物人化 33", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-33-d937d17790d0.webp" },
  { entryId: "human", templateId: "human-effect-34", title: "宠物人化 34", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-34-c460841fd9c7.webp" },
  { entryId: "human", templateId: "human-effect-35", title: "宠物人化 35", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-35-e5475d671682.webp" },
  { entryId: "human", templateId: "human-effect-36", title: "宠物人化 36", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-36-e59958e39d32.webp" },
  { entryId: "human", templateId: "human-effect-37", title: "宠物人化 37", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-37-cd8ed373733a.webp" },
  { entryId: "human", templateId: "human-effect-38", title: "宠物人化 38", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-38-d50883eb1583.webp" },
  { entryId: "human", templateId: "human-effect-39", title: "宠物人化 39", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-39-046d7a55f026.webp" },
  { entryId: "human", templateId: "human-effect-40", title: "宠物人化 40", subjectMode: "pet-human", orientation: "portrait", size: "720x1280", version: "v01", status: "pending-review", masterStorageKey: "samples/image-templates/human-effect-40-4874f74e1026.webp" },

  // animal 目录扩展：24 张历史模板中 21 张当前 live，3 张已下架归档。
  { entryId: "career", templateId: "animal-desert-pilot", title: "沙漠飞行员", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/animal-desert-pilot-fc04632d29a1.webp" },
  { entryId: "character", templateId: "animal-headphone-streetwear", title: "耳麦潮流宠物", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-headphone-streetwear-911c9bf3cc46.webp" },
  { entryId: "fun", templateId: "animal-sunglasses-rabbit", title: "草丛墨镜萌宠", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-sunglasses-rabbit-163c1dc99645.webp" },
  { entryId: "fun", templateId: "animal-capybara-snapshot", title: "日常快照萌宠", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-capybara-snapshot-18aeb7bcc0d2.webp" },
  { entryId: "action", templateId: "animal-giant-city-companion", title: "巨型城市伙伴", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "public-v02-master-v01", status: "live", masterStorageKey: "samples/image-templates/animal-giant-city-companion-41bbb8ca30f7.webp" },
  { entryId: "fun", templateId: "animal-doodle-fisheye-chicken", title: "鱼眼涂鸦表情", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "public-v02-master-v01", status: "live", masterStorageKey: "samples/image-templates/animal-doodle-fisheye-chicken-43759e12d722.webp" },
  { entryId: "career", templateId: "animal-car-window-westie", title: "车窗风中写真", subjectMode: "pet", orientation: "landscape", size: "1280x720", version: "public-v02-master-v01", status: "live", masterStorageKey: "samples/image-templates/animal-car-window-westie-ce10c248c6be.webp" },
  { entryId: "character", templateId: "animal-enamel-dragon", title: "珐琅彩龙宠", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "stylebridge-v02", status: "live", masterStorageKey: "samples/image-templates/animal-enamel-dragon-ae44bbbcdb96.webp" },
  { entryId: "character", templateId: "animal-enamel-cat-beast", title: "流体珐琅猫神兽", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-enamel-cat-beast-a29ec8b6d047.webp" },
  { entryId: "art", templateId: "animal-watercolor-cat-closeup", title: "金箔水彩猫咪", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "stylebridge-v03", status: "live", masterStorageKey: "samples/image-templates/animal-watercolor-cat-closeup-e1e6abeba4d4.webp" },
  { entryId: "fun", templateId: "animal-glass-paw-portrait", title: "玻璃爪印特写", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-glass-paw-portrait-c1fb2e4903c7.webp" },
  { entryId: "career", templateId: "animal-urban-takeover-poster", title: "城市潮流活动海报", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/animal-urban-takeover-poster-aab05fb3a5f5.webp" },
  { entryId: "action", templateId: "animal-giant-law-poster", title: "巨物法相海报", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v04", status: "live", masterStorageKey: "samples/image-templates/animal-giant-law-poster-8350536372ed.webp" },
  { entryId: "action", templateId: "animal-fantasy-double-exposure", title: "奇幻双重曝光", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "eastern-myth-v02", status: "live", masterStorageKey: "samples/image-templates/animal-fantasy-double-exposure-243baf5783f3.webp" },
  { entryId: "character", templateId: "animal-warrior-cat", title: "古风剑客宠物", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-warrior-cat-75e8984bfb4b.webp" },
  { entryId: "fun", templateId: "animal-sunglasses-rabbit-alt", title: "草丛墨镜萌宠二", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-sunglasses-rabbit-alt-8812cad9e909.webp" },
  { entryId: "action", templateId: "animal-tiger-storm", title: "风暴巨兽概念", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "stylebridge-v02", status: "live", masterStorageKey: "samples/image-templates/animal-tiger-storm-6b9dc5cd3c13.webp" },
  { entryId: "career", templateId: "animal-pink-scooter", title: "粉色摩托夜行", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/animal-pink-scooter-1f0caec0e1df.webp" },
  { entryId: "action", templateId: "animal-haunted-cctv-panels", title: "鬼屋监控四格", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v01", status: "live", masterStorageKey: "samples/image-templates/animal-haunted-cctv-panels-dd6e1a01e2ee.webp" },
  { entryId: "action", templateId: "animal-sword-cat-alt", title: "古风剑客宠物二", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "v02", status: "live", masterStorageKey: "samples/image-templates/animal-sword-cat-alt-08ff8046f31d.webp" },
  { entryId: "action", templateId: "animal-rabbit-yokai", title: "古风妖灵宠物", subjectMode: "pet", orientation: "portrait", size: "720x1280", version: "stylebridge-v03", status: "live", masterStorageKey: "samples/image-templates/animal-rabbit-yokai-c0a115de22a5.webp" },
];

const templates = registeredTemplates.map((template) => {
  if (template.status !== "live" || !template.masterStorageKey) return template;
  const masterFilename = template.masterStorageKey.slice("samples/image-templates/".length);
  return {
    ...template,
    // 宠物人化的新方案明确要求同一张自有效果图同时用于展示和图二参考。
    sampleStorageKey: template.subjectMode === "pet-human"
      ? template.masterStorageKey
      : publicPreviewStorageKeyOverrides[template.templateId]
        || `samples/image-template-previews/${masterFilename}`,
  };
});

export function getImageTemplate(templateId: string, options: { includePending?: boolean } = {}) {
  const template = templates.find((item) => item.templateId === templateId);
  if (!template || (!options.includePending && template.status !== "live")) return undefined;
  return template;
}

export function listImageTemplates(options: { includePending?: boolean } = {}) {
  return options.includePending ? templates.slice() : templates.filter((template) => template.status === "live");
}

export function listPublicImageTemplateEntries() {
  const live = listImageTemplates();
  return imageTemplateEntries
    .map((entry) => ({ ...entry, templates: live.filter((template) => template.entryId === entry.id) }))
    .filter((entry) => entry.templates.length > 0);
}

export function getImageTemplateCandidateCount(template: ImageTemplateDefinition): 2 | 4 {
  return template.subjectMode === "pet-human" ? 2 : 4;
}

export function imageTemplateSupportsReroll(template: ImageTemplateDefinition) {
  return template.subjectMode !== "pet-human";
}

export function buildImageTemplatePrompt(template: ImageTemplateDefinition, rerollReason?: ImageTemplateRerollReason) {
  if (template.subjectMode === "pet-human") {
    if (rerollReason) throw new Error("PET_HUMAN_REROLL_NOT_SUPPORTED");
    return petHumanPrompt;
  }
  const shared = [
    "This is an identity replacement image edit, not a new scene design.",
    "Image 1 is the self-owned frozen master and is the only authority for composition, camera, scene, pose, expression, color, lighting, brushwork, texture, costume, landmarks, props and text layout.",
    "Preserve Image 1 exactly except for replacing the designated subject identities. Scene-change budget is 0%.",
    "Do not add, remove, duplicate, merge or swap subjects. Keep all text, clothing, landmarks and unique props from Image 1; only adapt text when the subject identity makes that necessary.",
  ];
  if (template.subjectMode === "owner-pet") {
    shared.push(
      "Keep the new subjects' recognizable identity, breed, markings and adult age. Do not make them younger, thinner, stranger or less cute.",
      "Image 2 is the owner's identity reference. Image 3 is the pet's identity reference.",
      "Replace only the human identity with Image 2 and only the pet identity with Image 3. Keep each role, body, pose, gaze, expression and spatial relationship from Image 1.",
    );
  } else {
    shared.push(
      "Keep the new subject's recognizable identity, breed, markings and adult age. Do not make it younger, thinner, stranger or less cute.",
      "Image 2 is the pet identity reference.",
      "Replace only the pet identity with Image 2 while preserving every pose and expression instance from Image 1.",
    );
  }
  shared.push(...(templatePromptExtensions[template.templateId] || []));
  if (rerollReason === "owner-not-like") shared.push("Strengthen only the owner's facial identity match to Image 2; do not change the pet or composition.");
  if (rerollReason === "pet-not-like") shared.push(`Strengthen only the pet's identity match to Image ${template.subjectMode === "owner-pet" ? "3" : "2"}; do not change the owner or composition.`);
  if (rerollReason === "composition") shared.push("Restore the composition and role positions to Image 1; do not redesign either identity.");
  shared.push(`Return exactly ${template.size}.`);
  return shared.join(" ");
}
