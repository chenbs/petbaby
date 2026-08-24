/**
 * 提示词库。
 *
 * 分三类，性质不同不可混用：
 *
 * 1. SOURCE_PETS —— 「用户上传的宠物照片」。这是全部素材的源头：图文玩法样例图靠它
 *    跑真实生成器，风格对比图靠它做 edits 的保真基准。因此刻意要求手机随拍的观感，
 *    不要影棚感，否则后续成品会像素材库拼贴而非用户自己的照片。
 *
 * 2. MODEL_PET_SHOTS —— 样板宠物的多张照片。方案 3.3 硬规则：风格对比必须同一只主体，
 *    否则用户分不清差异来自风格还是来自宠物。PL-03 时光画册需 6-20 张同一只，也靠这批。
 *
 * 3. AI_STYLES / AI_PLAYS —— 与 growth-service.ts 的 z.enum 严格对齐，不可自造。
 */

const REALISM = "shot on a modern smartphone, natural available light, casual candid framing, shallow depth of field, true-to-life fur texture and colour";
const CLEAN = "no text, no watermark, no logo, no border, no caption, single animal only, full head visible";

/** 历史对比样板：橘白猫。仅服务旧版风格对比与兼容产物，不是宠物小岛的卡通摩奇。 */
export const MODEL_PET = {
  key: "legacy-tabby",
  name: "legacy-tabby",
  species: "cat",
  identity: "a young orange-and-white tabby cat with amber eyes, a white chest bib and one white front paw"
};

/** 样板宠物的 8 个场景。覆盖正脸（PL-01 需要）、全身、侧影、生活场景（PL-03 需要）。 */
export const MODEL_PET_SHOTS = [
  { key: "front", scene: "sitting upright facing the camera straight on, symmetrical head-and-shoulders framing, plain pale wall behind", anchor: 0.28 },
  { key: "window", scene: "curled on a wooden windowsill with warm late-afternoon sunlight across its back", anchor: 0.35 },
  { key: "sofa", scene: "sprawled belly-up on a linen sofa, relaxed and sleepy", anchor: 0.4 },
  { key: "play", scene: "mid-pounce on a carpet chasing a felt ball, motion in the paws", anchor: 0.35 },
  { key: "profile", scene: "side profile looking out of a rain-flecked window, soft grey daylight", anchor: 0.3 },
  { key: "box", scene: "sitting inside a cardboard box, only head and front paws visible over the edge", anchor: 0.3 },
  { key: "yawn", scene: "mid-yawn on a bed with rumpled white sheets, eyes squeezed shut", anchor: 0.32 },
  { key: "garden", scene: "standing on a stone garden step among green leaves, dappled shade", anchor: 0.35 }
];

/** 覆盖猫/狗/异宠与不同毛色，用于列表页与网格的多样性。 */
export const SOURCE_PETS = [
  { key: "cat-black", identity: "an adult solid-black domestic shorthair cat with bright green eyes", scene: "sitting on a dark wooden floor beside a sunlit doorway" },
  { key: "cat-british", identity: "a plump blue-grey British Shorthair cat with round copper eyes", scene: "sitting on a grey armchair, facing the camera" },
  { key: "cat-tuxedo", identity: "a black-and-white tuxedo cat with a white muzzle and chest", scene: "perched on a kitchen counter looking down at the lens" },
  { key: "cat-cream", identity: "a long-haired cream-coloured cat with a fluffy tail and pale blue eyes", scene: "lying on a knitted blanket by a radiator" },
  { key: "dog-golden", identity: "an adult golden retriever with a broad smiling mouth and feathered ears", scene: "sitting on autumn grass in a park, tongue slightly out" },
  { key: "dog-corgi", identity: "a corgi with tan-and-white markings and upright ears", scene: "standing on a pavement in front of a low hedge, looking up" },
  { key: "dog-husky", identity: "a siberian husky with grey-and-white coat and pale blue eyes", scene: "sitting in light snow, breath faintly visible" },
  { key: "dog-black-lab", identity: "a black labrador with a glossy coat and brown eyes", scene: "lying on a wooden deck in evening light" },
  { key: "dog-shiba", identity: "a red shiba inu with cream cheeks and a curled tail", scene: "sitting on a tatami floor beside a paper screen door" },
  { key: "pet-rabbit", identity: "a lop-eared rabbit with brown-and-white fur", scene: "sitting on a hay-strewn floor next to a wicker basket" },
  { key: "pet-parrot", identity: "a green-cheeked conure parrot with grey head and green wings", scene: "perched on a wooden branch stand near a bright window" },
  { key: "pet-hamster", identity: "a golden hamster with cream belly holding a sunflower seed", scene: "standing on wood shavings inside a glass tank, very close framing" }
];

/** 与 growth-service.ts 的 style z.enum 一一对应。用于 edits 端点做同主体风格对比。 */
export const AI_STYLES = [
  { id: "warm-film", label: "暖调胶片", direction: "warm analogue film photograph, visible grain, amber colour cast, gentle halation around highlights, 1990s point-and-shoot feel" },
  { id: "paper-cut", label: "纸艺拼贴", direction: "layered paper-cut collage illustration, visible torn paper edges, matte textured card stock, flat stacked shapes casting soft drop shadows" },
  { id: "studio", label: "克制影棚", direction: "clean studio portrait, seamless neutral grey backdrop, single large softbox from upper left, restrained and precise, no props" },
  { id: "fantasy", label: "轻幻想", direction: "gentle fantasy illustration, drifting light motes and soft bloom, pastel dusk palette, dreamlike but not garish" }
];

/** 与 ai-create.js 的 PLAYS 对齐，用于玩法选项的缩略图。 */
export const AI_PLAYS = [
  { id: "portrait", label: "肖像封面", direction: "single subject centred, head-and-shoulders portrait crop, background fully subordinate to the face" },
  { id: "storybook", label: "绘本主角", direction: "children's picture-book illustration, soft gouache texture, simple storybook scene around the subject" },
  { id: "magazine", label: "杂志大片", direction: "editorial magazine cover composition, generous negative space at the top for a masthead, confident graphic framing" }
];

/**
 * 玩法入口样例图，16:10，供 PluginManifest.samples.heroUrl 使用。
 *
 * 每张必须展示该玩法「真实产出长什么样」——首屏改大图入口后（方案 4.1），
 * 用户是靠这张图判断要不要点进去的，拿素材图或抽象色块顶替等于什么都没说。
 * id 与 apps/platform/src/plugins/registry.ts 的 plugin id 一一对应。
 *
 * 全部走 edits 端点、以历史对比样板猫的正脸照为输入：同一只宠物贯穿所有入口，
 * 用户浏览首屏时不会把「换了只宠物」误读成玩法差异。
 */
/*
 * anchor 是本条目专用的 16:10 裁切锚点（0=顶边，0.5=居中，1=底边）。
 * 接口忽略 size、一律返回竖图，裁宽幅要削掉近一半高度，锚点错了主体就没了：
 * 平铺类（证件、画册）主体居中，取 0.5；宽景类主体压在下半幅，要取 0.8 以上。
 * 原图已缓存在 out/plugins/raw/，调锚点不再打接口。
 */
export const PLUGIN_HEROES = [
  { id: "pet-id-card", anchor: 0.5, direction: "a printed pet identity card lying flat on a plain desk, the whole card visible within the frame, small portrait photo of the pet on the left side and neat blank label rows on the right, clean official document layout, soft even overhead light" },
  // 首版给出的是「装裱在墙上的油画布」，既不像海报、又跟 pl-10 的挂画撞车。
  // 这里改为强调纸质、上下留白条与竖版比例，把「印刷海报」这件事说死。
  { id: "pet-movie-poster", anchor: 0.5, direction: "a tall portrait-format paper film poster taped flat on a concrete wall, the whole sheet visible with wall on both sides, matte paper with slightly curled corners, the pet as the small dramatic lead figure in the upper artwork area, a wide empty band across the lower third reserved for a title and a narrow empty credits strip along the very bottom edge, high-contrast cinematic colour grade" },
  { id: "pet-time-album", anchor: 0.5, direction: "an open printed photo album resting on a wooden table, both pages visible, several small printed photographs of the same pet arranged across the spread, warm nostalgic tone, shallow depth of field" },
  { id: "pl-10", anchor: 0.55, direction: "a framed fine-art painted portrait of the pet hanging on a gallery wall, the frame fully visible with wall space around it, painterly brushwork, restrained palette, museum spot lighting" },
  { id: "pl-15", anchor: 0.8, direction: "a wide dreamlike starfield scene with the pet small in the lower portion of the frame, drifting luminous dust motes filling the air, deep indigo night palette, gentle bloom" },
  { id: "pl-19", anchor: 0.8, direction: "a wide cinematic film still with visible letterbox bars top and bottom, the pet small within a warm sunlit room, anamorphic lens flare, shallow focus, the feeling of a frame paused from a moving picture" },
  { id: "pl-20", anchor: 0.5, direction: "a quiet memorial keepsake book resting on linen, the open page carrying a small printed portrait of the pet, dried flowers beside it, muted desaturated palette, soft diffused window light, dignified and calm" },
  { id: "pl-21", anchor: 0.8, direction: "a wide cinematic memorial film still with letterbox bars, the pet small and softly lit in fading evening light, muted palette, a great deal of empty space, a sense of stillness and farewell" },
  // 首版出的是「明亮正脸 + 星空壁纸」，对丧宠产品是错的调性。
  // 因此显式压掉正脸与直视镜头，并把主体退为剪影、留出大面积空夜空。
  { id: "pl-22", anchor: 0.9, direction: "a serene starlit memorial scene seen from a distance, the pet rendered as a small dim rim-lit silhouette turned away from the viewer, not facing the camera, no eye contact, vast empty night sky filling most of the frame, deep indigo and silver palette, very low contrast on the subject, quiet and reverent, absolutely not a bright portrait" }
];

/**
 * 官网素材的品种清单（`docs/website/01-KittyPaw复刻规格.md` 第 10.2 节）。
 *
 * 与 SOURCE_PETS 的区别：SOURCE_PETS 模拟「用户随手拍的原图」，是 edits 的输入；
 * 这里是**官网展示位的成品主体**，走文生图直出，不需要底图。
 *
 * 为什么不复用 SOURCE_PETS：官网需要的是「一卡一品种」的辨识度（布偶、缅因、
 * 边牧这类特征鲜明的品种），SOURCE_PETS 里的黑猫、英短、仓鼠是为空态和列表
 * 多样性挑的，两组诉求不同。
 *
 * 规格第 10.2 节列了 12 种，此处 11 种 —— 五黑犬按要求不生成。
 */
export const WEBSITE_PETS = [
  // ── 猫 5 ──
  { key: "cat-ragdoll", zh: "布偶猫", identity: "a ragdoll cat with a cream body, dark brown points on ears and face, and deep blue eyes, long silky coat" },
  { key: "cat-devon", zh: "德文卷毛猫", identity: "a grey-and-white Devon Rex cat with a short curly suede-like coat, very large wide-set ears, a slender wedge-shaped face and big curious eyes" },
  { key: "cat-maine", zh: "缅因猫", identity: "a large brown tabby Maine Coon cat with a shaggy ruff, tufted ear tips and a very bushy tail" },
  { key: "cat-abyssinian", zh: "阿比西尼亚猫", identity: "an Abyssinian cat with a short ticked ruddy-brown coat, large almond eyes and tall alert ears, lithe muscular build" },
  { key: "cat-dragonli", zh: "田园狸花猫", identity: "a Chinese Li Hua cat with a classic brown-and-black mackerel tabby coat, sturdy build and round yellow-green eyes" },
  // ── 狗 6 ──
  { key: "dog-golden", zh: "金毛犬", identity: "an adult golden retriever with a broad smiling mouth, feathered ears and a dense golden coat" },
  { key: "dog-poodle", zh: "泰迪", identity: "a small apricot toy poodle with tightly curled fluffy fur, a rounded trimmed face and dark round eyes" },
  { key: "dog-border", zh: "边境牧羊犬", identity: "a black-and-white border collie with a white blaze down the muzzle, semi-erect ears and an intense focused gaze" },
  { key: "dog-shepherd", zh: "德国牧羊犬", identity: "a german shepherd with a black-and-tan saddle coat, large erect ears and an alert upright posture" },
  { key: "dog-shiba", zh: "柴犬", identity: "a red shiba inu with cream cheeks and underside, small triangular ears and a curled tail" },
  // 模型对「中华田园犬」先验很弱，只写 Chinese rural dog 会出一只泛泛的黄狗，
  // 故把头型、耳朵、尾巴都写进 identity。
  { key: "dog-mixed", zh: "中华田园犬", identity: "a Chinese rural dog with a short tan-and-white coat, a wedge-shaped head, upright ears and a naturally curved tail" }
];

const WEBSITE_PET_BY_KEY = new Map(WEBSITE_PETS.map((pet) => [pet.key, pet]));

/** 按 id 取 AI_STYLES / AI_PLAYS 的 direction，避免官网这边另抄一份风格描述。 */
function directionOf(id) {
  const found = [...AI_STYLES, ...AI_PLAYS].find((item) => item.id === id);
  if (!found) throw new Error(`未知风格/玩法 id ${id}`);
  return found.direction;
}

/**
 * 官网各展示位的槽位表（规格第 10.3 节）。
 *
 * `kind` 决定提示词写法，四种不可混用：
 *   artefact —— 主体是「印出来的成品物」，宠物在画面里可以很小。玩法成品卡与服务详情 A 用。
 *   photo    —— 真实感照片，近景脸部。头像位用。
 *   styled   —— 风格化产出，`style` 指向 AI_STYLES/AI_PLAYS 的 id。作品瀑布流用。
 *   memorial —— 纪念调性：主体退为剪影侧背影、不直视镜头、留大面积空景。
 *
 * `ratio` / `anchor` 交给 crop.mjs。接口忽略 size 一律返回竖图，裁 4:3 横幅要削掉
 * 四成高度，锚点错了主体就没了 —— 与 PLUGIN_HEROES 同一个坑。
 */
export const WEBSITE_SHOTS = [
  // ① 玩法成品卡（第 3 区块，3 张）
  { key: "play-id-card", pet: "cat-ragdoll", ratio: "cover", anchor: 0.5, kind: "artefact", label: "宠物身份证", direction: "a printed pet identity card lying flat on a pale desk, the whole card visible and centred with empty desk above and below it, a small portrait photo of the pet on the left side and neat blank label rows on the right, clean official document layout, soft even overhead light" },
  { key: "play-poster", pet: "dog-golden", ratio: "cover", anchor: 0.5, kind: "artefact", label: "宠物电影海报", direction: "a paper film poster taped flat on a pale concrete wall, the whole sheet visible and centred with wall on both sides, matte paper with slightly curled corners, the pet as the small dramatic lead figure in the artwork area, a wide empty band across the lower third reserved for a title, high-contrast cinematic colour grade" },
  { key: "play-album", pet: "cat-maine", ratio: "cover", anchor: 0.5, kind: "artefact", label: "时光画册", direction: "an open printed photo album resting on a wooden table, both pages visible and centred in the frame, several small printed photographs of the same pet arranged across the spread, warm nostalgic tone, shallow depth of field" },

  // ③ 服务详情 A：AI 肖像（第 5 区块，图在左）
  { key: "detail-portrait", pet: "dog-border", ratio: "cover", anchor: 0.45, kind: "artefact", label: "AI 肖像", direction: "a framed fine-art painted portrait of the pet hanging on a pale gallery wall, the frame fully visible and centred with wall space above and below, painterly brushwork, restrained palette, museum spot lighting" },

  // ④ 服务详情 B：纪念空间（第 6 区块，图在右）。
  //   调性沿用 PLUGIN_HEROES 的 pl-22 教训：首版出「明亮正脸 + 星空壁纸」，对丧宠产品是错的。
  { key: "detail-memorial", pet: "dog-mixed", ratio: "cover", anchor: 0.5, kind: "memorial", label: "星尘纪念", direction: "a serene starlit memorial scene seen from a distance, vast quiet night sky and a low empty horizon filling most of the frame, deep indigo and silver palette" },

  // ⑤ 口碑头像（第 8 区块，3 张）
  { key: "avatar-dragonli", pet: "cat-dragonli", ratio: "square", anchor: 0.28, kind: "photo", label: "田园狸花猫", direction: "close head-and-shoulders framing against a plain warm wall, looking slightly off camera" },
  { key: "avatar-poodle", pet: "dog-poodle", ratio: "square", anchor: 0.28, kind: "photo", label: "泰迪", direction: "close head-and-shoulders framing on a sofa, soft indoor daylight" },
  { key: "avatar-abyssinian", pet: "cat-abyssinian", ratio: "square", anchor: 0.28, kind: "photo", label: "阿比西尼亚猫", direction: "close head-and-shoulders framing on a windowsill, warm side light" },

  // ⑥ hero 社群头像（3 张）。规格原列「柴犬 / 德牧 / 五黑」，五黑不生成，
  //   第三只换德文卷毛猫 —— 与 hero 视频里的德文猫呼应。
  { key: "hero-shiba", pet: "dog-shiba", ratio: "square", anchor: 0.28, kind: "photo", label: "柴犬", direction: "close head-and-shoulders framing outdoors on a stone path, dappled afternoon light" },
  { key: "hero-shepherd", pet: "dog-shepherd", ratio: "square", anchor: 0.28, kind: "photo", label: "德国牧羊犬", direction: "close head-and-shoulders framing on grass, alert expression, soft overcast light" },
  { key: "hero-devon", pet: "cat-devon", ratio: "square", anchor: 0.28, kind: "photo", label: "德文卷毛猫", direction: "close head-and-shoulders framing on a linen chair, curious expression, soft window light" },

  // ⑧ 作品瀑布流（第 11 区块，11 张，一品种一张）。
  //   刻意混比例：CSS columns 在等高图下会退化成规整网格，高度参差才是瀑布流的价值。
  { key: "work-ragdoll", pet: "cat-ragdoll", ratio: "card", anchor: 0.28, kind: "styled", style: "warm-film", label: "暖调胶片" },
  { key: "work-devon", pet: "cat-devon", ratio: "cover", anchor: 0.4, kind: "styled", style: "magazine", label: "杂志大片" },
  { key: "work-maine", pet: "cat-maine", ratio: "square", anchor: 0.3, kind: "styled", style: "studio", label: "克制影棚" },
  { key: "work-abyssinian", pet: "cat-abyssinian", ratio: "card", anchor: 0.28, kind: "styled", style: "fantasy", label: "轻幻想" },
  { key: "work-dragonli", pet: "cat-dragonli", ratio: "card", anchor: 0.28, kind: "styled", style: "paper-cut", label: "纸艺拼贴" },
  { key: "work-golden", pet: "dog-golden", ratio: "card", anchor: 0.28, kind: "styled", style: "portrait", label: "肖像封面" },
  { key: "work-poodle", pet: "dog-poodle", ratio: "square", anchor: 0.3, kind: "styled", style: "storybook", label: "绘本主角" },
  { key: "work-border", pet: "dog-border", ratio: "card", anchor: 0.28, kind: "styled", style: "warm-film", label: "暖调胶片" },
  { key: "work-shepherd", pet: "dog-shepherd", ratio: "cover", anchor: 0.4, kind: "styled", style: "studio", label: "克制影棚" },
  { key: "work-shiba", pet: "dog-shiba", ratio: "card", anchor: 0.28, kind: "styled", style: "paper-cut", label: "纸艺拼贴" },
  { key: "work-mixed", pet: "dog-mixed", ratio: "card", anchor: 0.28, kind: "styled", style: "portrait", label: "肖像封面" }
];

/* ────────────────────────────────────────────────────────────────────────────
 * 宠物小岛素材（`24-宠物小岛素材清单.md`）
 *
 * 与上面三类的关键区别：**风格锚点是《猫咪和汤》的官方宣传插画，有细描边。**
 *
 * 24 号文初版的公共前缀写的是 `completely outline-free` + 排除项 `no outlines`，
 * 那对标的是该游戏的**引擎内场景**（厚涂无描边）。但用户 2026-08-05 提供的四张
 * 参考图（`out/island/cankao{1..4}`）全部是**官方宣传/活动插画**，是另一套画法：
 * 细描边 + 扁平上色 + 腮红 + 豆豆眼。同一 IP 下两套画风并存，锚点必须取用户给的那套 ——
 * 否则提示词在明令禁止参考图最显著的特征，主体描述怎么调都不会对。
 *
 * 附带收益：22 号文 2.7 把「无描边画风抠图难」列为本路线唯一的技术风险
 * （柔和边缘留半透明毛边、啃掉绒毛）。改成有描边后该风险大幅下降 ——
 * 闭合轮廓线本身就是色键抠图最好的边界。
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 岛素材公共前缀。**每一张岛素材都要带**，它承载全部风格锚点。
 *
 * 描边色是关键的一条：参考图用的是**深棕/深蓝灰**细线，不是纯黑。纯黑描边会立刻
 * 掉到廉价贴纸观感，与 22 号文诊断 9（阴影不用灰黑，走暖褐 `SHADOW_HUE`）同一个道理。
 */
const ISLAND_STYLE = [
  "Official promotional illustration art style of the mobile game \"Cats & Soup\" (NEOWIZ):",
  "clean thin uniform hand-drawn outlines in dark warm brown or deep slate blue (never pure black),",
  "completely flat cel colouring, rounded chunky simplified shapes,",
  "soft muted pastel palette, storybook sticker illustration feel, cosy calm healing atmosphere."
].join(" ");

/**
 * 角色专属的简化规则。**只给 `character: true` 的槽位**，物件与场景不带。
 *
 * 单独抽出来的原因有两个：一是把「豆豆眼、腮红、短肢」这类描述塞进通用前缀，对食盆、
 * 草丛、道具是无意义的污染（它们没有脸）；二是这套规则需要写得很长很硬，塞在通用前缀里
 * 会把风格描述挤到权重末尾。
 *
 * **每一句都在修一处实测偏差**（2026-08-05 第一轮产物对照四张参考图）：
 *   - 头身融合、无脖子无肩 —— 第一轮画成了「头身分明、有肩有后腿弧线」的猫解剖结构，
 *     这是「不够可爱」的**最大来源**：参考图的角色是一整块连续的蛋形/钟形 blob。
 *   - 花纹简化成大色斑 + 至多几条粗条纹 —— 第一轮给了细密虎斑，细节密度一上来就转写实。
 *   - 豆豆眼、无高光无虹膜 —— 第一轮的眼睛偏大且带高光，接近日系动画而非参考图。
 *   - 纯平涂、无渐变 —— 第一轮身上有渐变明暗。
 *   - 圆爪只在底边露一点、无趾线 —— 第一轮画了带趾线的爪子与明显长胡须。
 */
const ISLAND_CHARACTER = [
  "The character is drawn in an extremely simplified chibi blob style, exactly like a kawaii sticker mascot:",
  "the head and the body merge into ONE single continuous rounded egg-shaped silhouette,",
  "with no visible neck, no defined shoulders, no haunches and no realistic animal anatomy at all.",
  "The head is very large relative to the body and sits directly on it.",
  "All facial features are tiny and clustered in a small area low on the face, leaving a lot of empty flat space:",
  "two small solid dark dot eyes with no highlights and no visible iris or pupil,",
  "a minimal tiny dot nose, one very small simple closed smiling mouth,",
  "and a small soft round blush patch on each cheek.",
  "Limbs are reduced to tiny stubby rounded paws that only just peek out from the bottom edge of the body.",
  "Coat markings are simplified into a few large soft flat patches plus at most a few broad simple stripes.",
  "Colouring is entirely flat."
].join(" ");

/** 角色专属排除项。与 `ISLAND_EXCLUDE` 叠加使用 —— 这些负面词对物件无意义。 */
const ISLAND_CHARACTER_EXCLUDE = [
  "no realistic animal anatomy, no visible neck, no defined shoulders or haunches,",
  "no slender athletic or muscular body, no fine detailed fur striping, no individual fur strands,",
  "no gradient shading, no airbrushed shading, no large anime eyes, no eye highlights,",
  "no glossy reflections in the eyes, no visible pupils or irises,",
  "no long whiskers, no sharp claws, no separated paw toes, no toe lines"
].join(" ");

/**
 * 岛素材排除项。**每一张都要带。**
 *
 * 与 `CLEAN` 不能混用：`CLEAN` 是给写实照片的（禁 border、要求 full head visible）。
 * 这里必须显式禁的是**参考图自带但我们不要的东西**：
 *   - `no text` —— 四张参考图全部带「猫咪和汤」标题字与活动文案，模型会照抄。
 *   - `no numbers` / `no health bars` —— 22 号文 4.1 #5 禁数值条（会强化「这是游戏」
 *     的观感并加重类目风险）。
 *   - `no human` —— 22 号文诊断 1：人类占据视觉中心时用户看到的是别人的游戏。
 *   - `no thick black outlines` —— 只禁**粗黑**线，不禁描边本身。这与初版排除项的
 *     `no outlines` 是**相反**的取值，改动的核心就在这里。
 */
const ISLAND_EXCLUDE = [
  "no text, no letters, no numbers, no title, no logo, no watermark, no signature,",
  "no thick black outlines, no sketchy or uneven line weight, no pixel art, no dithering,",
  "no photorealism, no 3D render, no anime screenshot style, no harsh cel shading,",
  "no drop shadow, no lens flare, no vignette, no film grain, no texture noise,",
  "no UI elements, no health bars, no progress bars, no icons, no speech bubbles,",
  "no human characters, no people, no hands"
].join(" ");

/** 场景类共用的视角措辞（22 号文 2.2：浅俯视 15–25°，这是「看得见猫的脸」的前提）。 */
const ISLAND_CAMERA = "Shallow high-angle view, camera only 15-25 degrees above horizontal, almost eye-level, NOT isometric, NOT top-down.";

/**
 * 透明底措辞。**只在模型拒绝 `background: "transparent"` 时才用到品红。**
 *
 * 品红 `#FF00FF` 的选择依据（24 号文硬要求 2）：猫狗毛色里不存在这个色相，抠图不会
 * 啃掉主体；白底会把白猫和奶白器物一起抠掉 —— 历史对比样板猫是橘白猫，有白胸兜。
 */
const ISLAND_MAGENTA = "Centred on a completely flat solid pure magenta background (#FF00FF), one single uniform colour with absolutely no gradient, no vignette, no shadow, no ground plane, no reflection.";

/**
 * 宠物小岛示例宠物「摩奇」的 Q 版身份描述。
 *
 * 它是小岛专用卡通角色，不与历史写实样板 `MODEL_PET` 建立身份绑定。
 * 特征三件套（白胸兜、一只白前爪、橘白双色）必须逐字保留 —— 24 号文 2.4 的验收标准
 * 要求「橘白花纹分布可辨」，而这三样是它的唯一载体。
 */
const ISLAND_MOCHI = [
  "a very round chubby blob-shaped cartoon cat, orange-and-white bicolour:",
  "soft warm orange patches covering the top of the head, the ears, the back and the tail,",
  "a large clear white area covering the whole front of the body and the belly,",
  "one white front paw, small rounded ears set low and wide on the big round head,",
  "and a short thick tail curled softly against the side of the body"
].join(" ");

/**
 * 岛素材槽位表（24 号文 7.4 的 7 张必需 + 1 张可选）。
 *
 * `transparent: true` 的走 PNG + `background: "transparent"`，失败时回落品红；
 * 其余走 JPG。`ratio` / `anchor` 交给 crop.mjs —— 接口忽略 size（`generate.mjs` 已记录
 * 实测：请求 1024x1024 返回 1122x1402），比例只能本地强制。
 */
export const ISLAND_ASSETS = [
  {
    /*
     * 岛的入口卡图（24 号文 7.1）。挂在「我的」页的入口卡与玩法宫格上。
     *
     * **走图生图（`edits`）而不是文生图**，参考图是已定稿的 `scene-yard.png`。
     * 理由是画风一致性：文生图只能靠提示词复述风格，而这批素材的判据是**人眼比对**
     * —— 同一句 `ISLAND_STYLE` 两次调用产出的笔触、描边粗细、色相偏移都会不同，
     * 而入口卡与进岛后的画面是紧挨着看的（点卡片即进岛），风格差一点就很明显。
     * 从底图派生等于把「风格」这件事交给参考图而不是文字。
     *
     * `fromScene: true` 是给 `generate.mjs` 的开关：它据此走 `edit()` 并把
     * `out/island/scene-yard.png` 作为输入。**底图必须已经定稿**（这就是它排在
     * 数组末尾、且 24 号文把它列作「第 3 轮」的原因）。
     *
     * 16:10 横构图而不是底图的 2:3：卡片位是宽幅，用竖图会被裁掉大半。
     * 所以提示词要求「重新取景成横构图」，而不是简单改比例。
     */
    key: "hero-island",
    ratio: "hero",
    anchor: 0.5,
    fromScene: true,
    label: "岛的入口卡图",
    direction: [
      "Re-frame this exact same garden scene as a wide horizontal 16:10 landscape banner illustration.",
      "Keep the identical art style, identical colour palette, identical lighting and the same buildings,",
      "fences, flowers, trees and stone path as the reference image — this must read as the same place.",
      "Compose it as an inviting establishing shot of the whole garden seen from a gentle high angle,",
      "with the cottage and the garden path clearly visible and generous open sky along the top edge.",
      // 与底图同一条硬约束：卡图里也不能有动物，否则用户会以为岛上本来就有一只
      "Absolutely no animals, no cats, no dogs, no pets and no people anywhere in the image.",
      "No text, no letters, no logo, no watermark, no UI elements, no frame, no border."
    ].join(" ")
  },
  {
    key: "pet-sample",
    ratio: "source", // 3:4 → 1200×1600（24 号文 7.4 已从 900×1200 上调）
    anchor: 0.5,
    transparent: true,
    character: true,
    label: "样板宠物摩奇",
    /*
     * 「三分之四侧身」保留（24 号文 2.4 验收标准的第一条，脸必须清楚可见），
     * 但**改说成「身体正面朝前、只把脸略偏」** —— 第一轮的 three-quarter view 被理解成
     * 整只猫侧转，于是画出了侧面的肩与后腿轮廓，正是最伤可爱度的那处结构。
     * blob 造型要的是正面剪影，侧向只体现在五官的微小偏移上。
     */
    direction: `A full-body character illustration of ${ISLAND_MOCHI}. Sitting facing the viewer with the body seen straight from the front as one symmetrical rounded blob, with the face turned only very slightly to the left. Calm, content and cute. The whole animal is visible from the ear tips down to the paws, with clear empty margin on all four sides. The face must be clearly visible and readable.`
  }
];

/**
 * 岛素材提示词。
 *
 * 顺序是刻意的：**风格前缀在最前、排除项在最后**。中间夹主体描述，因为多数模型对
 * 首尾的权重更高，而这里最怕丢的恰好是风格与禁止项 —— 主体（一只橘白猫）本身
 * 是模型的强先验，丢不掉。
 */
export function islandPrompt(asset, { magenta = false } = {}) {
  const parts = [ISLAND_STYLE];
  // 角色简化规则紧跟风格前缀、在主体描述之前：它约束的是「怎么画」，
  // 必须先于「画什么」，否则模型已按解剖结构起形，再简化就晚了。
  if (asset.character) parts.push(ISLAND_CHARACTER);
  parts.push(asset.direction);
  if (asset.camera) parts.push(ISLAND_CAMERA);
  if (asset.transparent) {
    /*
     * 两句**互斥**，不能都给。
     *
     * 「fully transparent」与「solid pure magenta background」是直接矛盾的指令 ——
     * 都塞进去时模型很可能既填品红又不给 alpha，等于两条路都没走成。
     * 所以品红那句只在**回落调用**时出现（`magenta: true`），由调用方在模型拒绝
     * `background: "transparent"` 后显式指定。
     */
    parts.push(magenta
      ? ISLAND_MAGENTA
      : "The subject is isolated on a fully transparent background — no scenery, no ground, no floor, no props, nothing behind the subject, alpha channel empty around the subject.");
  }
  parts.push(ISLAND_EXCLUDE);
  if (asset.character) parts.push(ISLAND_CHARACTER_EXCLUDE);
  return parts.join(" ");
}

/** 源照片提示词：真实感 + 干净（无文字水印）。 */
export function sourcePrompt(identity, scene) {
  return `A realistic photograph of ${identity}, ${scene}. ${REALISM}. ${CLEAN}.`;
}

/**
 * 官网槽位提示词：文生图，品种特征内联。
 *
 * 走文生图而非 edits，是因为 11 个新品种都没有底图 —— 先生成底图再 edits 等于
 * 把张数和费用翻倍，而官网展示位并不需要「同一只主体」这条约束（规格第 10.1 节：
 * 并列比较的槽位锁定主体，独立展示的槽位放开品种；风格对比带仍用历史对比样板猫的现成 7 张）。
 */
export function websitePrompt(shot) {
  const pet = WEBSITE_PET_BY_KEY.get(shot.pet);
  if (!pet) throw new Error(`未知品种 ${shot.pet}`);

  if (shot.kind === "photo") {
    return sourcePrompt(pet.identity, shot.direction);
  }

  if (shot.kind === "styled") {
    // 与 stylePrompt 同源的风格描述，但主体由 identity 给出而非「保持输入图不变」。
    return `An image of ${pet.identity}, rendered as: ${directionOf(shot.style)}. ${CLEAN}.`;
  }

  if (shot.kind === "memorial") {
    // pl-22 踩过的坑：不要明亮正脸、不要直视镜头，主体退为剪影或侧背影。
    return `Create ${shot.direction}. Somewhere small and low in the frame stands ${pet.identity}, rendered as a dim rim-lit silhouette turned away from the viewer — not facing the camera, no eye contact, very low contrast on the subject. Wide landscape composition, the subject centred with generous empty space above and below. Quiet and reverent, absolutely not a bright portrait. ${CLEAN}.`;
  }

  // artefact：主体是成品物而非脸。CLEAN 不能整段套用 —— 它禁 border，
  // 而身份证、海报、画册本身就是有边界的印刷物。
  return `Create ${shot.direction}. The pet in the artwork is ${pet.identity} — keep its breed, coat colour and markings unmistakable. The finished artefact is the subject of this image, not the animal's face: the pet may appear small within the composition. Wide landscape composition, the artefact centred with generous empty space above and below it. No lettering, no words, no watermark, no logo: leave any area where text would appear completely blank.`;
}

/**
 * 玩法入口图提示词。
 *
 * 不能复用 stylePrompt：那句以「Restyle this pet photograph」开头、又要求五官
 * 「clearly recognisable」，模型会稳定给出一张占满画面的正脸像 —— 首版 pet-movie-poster
 * 与 pl-19 就退化成了普通影棚猫照，海报和电影感全丢。入口图的主角是「产出物」而非脸。
 *
 * 因此这里反过来写：先声明要做的是什么成品，再允许宠物在画面里占比很小。
 * CLEAN 也不能整段套用 —— 它禁 border，而身份证、海报本身就是有边界的印刷物。
 */
export function heroPrompt(direction) {
  return `Create ${direction}. The finished artefact is the subject of this image, not the animal's face — the pet may appear small within the composition. Use the pet in the supplied photograph, keeping its species, breed, coat colour and markings unchanged. Wide landscape composition. No lettering, no words, no watermark, no logo: leave any area where text would appear completely blank.`;
}

/** 风格对比提示词：只换风格，主体特征必须保持。 */
export function stylePrompt(direction) {
  return `Restyle this pet photograph as: ${direction}. Keep the animal's exact species, breed, coat colour, markings and facial features unchanged and clearly recognisable as the same individual. ${CLEAN}.`;
}
