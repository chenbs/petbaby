import type { PluginManifest } from "@/domain/models";
import { petArtPhotoScenes } from "@/domain/pet-art-photo";

export const plugins: PluginManifest[] = [
  {
    id: "pet-id-card",
    code: "PL-01",
    name: "宠物身份证",
    category: "layout",
    tagline: "今天起，我也是有证的小朋友",
    description: "正脸照生成宠物身份证，附赠猫猫管理局签发彩蛋。",
    accent: "orange",
    input: {
      photos: { min: 1, max: 1 },
      profileFields: ["name", "species", "birthday", "gender"],
    },
    generator: { type: "html-template", template: "id-card-v1" },
    /*
     * 转免费（改造方案 C6）。宠物身份证/证件照的免费替代太密 ——
     * Reeyee、Nano Banana、EaseMate 都免费，支付宝与杭州有官方电子身份证，
     * 抖音有成熟的「AI 萌宠证件照口令」玩法，还有教程教直接用 ChatGPT 做。
     * 9.9 撑不住这个竞争，它的价值在获客不在收入。
     */
    pricing: { unlockPrice: 0, label: "免费保存" },
    output: { formats: ["image"] },
    samples: { heroUrl: "/api/plugin-samples/samples/mp26-pet-id-card-e7e1697450c7.jpg" },
    status: "live",
  },
  {
    id: "pet-movie-poster",
    code: "PL-02",
    name: "宠物电影海报",
    category: "layout",
    tagline: "年度巨制，领衔主演是我",
    description: "选一套原创电影场景，用宠物照片生成主角海报，再加上片名与短评。",
    accent: "blue",
    input: {
      photos: { min: 1, max: 1 },
      profileFields: ["name", "species"],
    },
    generator: { type: "image-api", template: "movie-poster-v1" },
    pricing: { unlockPrice: 12.9, label: "保存高清原图" },
    output: { formats: ["image"] },
    samples: { heroUrl: "/api/plugin-samples/samples/mp26-pet-movie-poster-v4-8a4c189d768e.jpg" },
    status: "live",
  },
  {
    id: "pet-time-album",
    code: "PL-03",
    name: "宠物时光画册",
    category: "layout",
    tagline: "把相册里的碎片，装订成故事",
    description: "从成长、生日或治愈日常中生成手机长图和纪念 PDF。",
    accent: "yellow",
    input: {
      photos: { min: 6, max: 20 },
      profileFields: ["name", "species", "birthday"],
    },
    generator: { type: "html-template", template: "time-album-v1" },
    /*
     * 基础价。实际收费按积累量分档（domain/pricing.ts）：
     * ≤20 张 19.9 / 21–60 张 39.9 / 跨度满年 49。
     * manifest 里留基础价，是为了不分档的路径（会员、纪念形态）有回落值。
     */
    pricing: { unlockPrice: 19.9, label: "保存高清原图（含 PDF）" },
    output: { formats: ["image", "pdf"] },
    samples: { heroUrl: "/api/plugin-samples/samples/mp26-pet-time-album-8da9fa598537.jpg" },
    // 原 PL-20「纪念册」并入此处（改造方案 D3）。两者本来都是多照片图文册，
    // memorial/album.ts 的实现本身就是参考 time-album-v1 写的。
    // 老 manifest 保留为 archived（见文件末尾）而不是删除 —— 理由在那里说明。
    /*
     * `senior` 的调性：**克制但不纪念**（改造方案 L4）。
     *
     * 这是最难写的一档。方案 3.2 指出 `senior` 此前是一个空标签 ——
     * 用户手动设成晚年后什么都不会变，「这比没有这个选项更差：
     * 它给了一个承诺然后什么都不做」。而 16 号文 P1-3 认定这一段是付费意愿峰值。
     *
     * 措辞的分界线：**不能提「离别」「最后」「剩下的时间」** ——
     * 那是替用户宣告一件还没发生的事，冒犯程度接近纪念文案错用在活着的宠物上。
     * 也不能沿用 active 的轻快调（「装订成故事」在这个阶段读起来轻浮）。
     * 落点是「把每一天都记下来」：陈述现在，不预告将来。
     *
     * 价格不变（不加价也不降价）：晚年阶段涨价是趁人之危，降价则暗示
     * 「这个阶段的东西不值钱」。两者都不对。
     */
    toneVariants: {
      senior: { tagline: "把现在的每一天都装订起来", description: "晚年的日常同样值得成册。选中的照片与你写下的段落，装订成一本可以长期保存的册子。" },
      memorial: { name: "纪念册", tagline: "把共同生活整理成一本册子", description: "把选中的照片与你写下的段落，装订成一本可以长期保存的册子。", unlockPrice: 49, label: "高清纪念册" },
    },
    status: "live",
  },
  {
    id: "pl-10",
    code: "PL-10",
    name: "宠物艺术写真",
    category: "ai-image",
    tagline: "换一个场景，看见我不一样的神态",
    description: "选择宠物身份照和写真场景，生成一张保留我真实模样的艺术写真。",
    accent: "orange",
    input: {
      photos: { min: 1, max: 1 },
      profileFields: ["name", "species"],
    },
    generator: { type: "image-api", template: "ai-portrait-v1" },
    pricing: { unlockPrice: 16.9, label: "保存高清原图" },
    output: { formats: ["image"] },
    samples: {
      heroUrl: "/api/plugin-samples/samples/mp26-gray-toy-poodle-editorial-v1-7c583b9dcb50.jpg",
      /*
       * 三十六套写真由布偶猫、金毛、泰迪、英短、美短、柯基、三花猫、无毛猫、阿富汗猎犬、意大利灵缇、金吉拉、暹罗，以及（v12 起）奶牛猫、奶油长毛猫、黑拉布拉多、哈士奇、柴犬、黑猫示范（v14 起黑白大片、驼色大衣也由泰迪、金毛示范）；用户身份仍只取其私有照片。
       * 旧 styleUrls 不再作为默认字段；runtime.ts 仅为历史配置保留读取能力。
       */
      sceneUrls: {
        "window-morning": "/api/plugin-samples/samples/scene-window-morning-v3-396d098a6999.jpg",
        "garden-curious": "/api/plugin-samples/samples/scene-garden-curious-v3-0778c1b4a102.jpg",
        "studio-confident": "/api/plugin-samples/samples/scene-studio-confident-v3-1af96b734e2a.jpg",
        "night-playful": "/api/plugin-samples/samples/scene-night-playful-v3-fc3d97dedc94.jpg",
        "seaside-breeze": "/api/plugin-samples/samples/scene-seaside-breeze-v3-2a54b86c666a.jpg",
        "library-whisper": "/api/plugin-samples/samples/scene-library-whisper-v3-29dffafc3a93.jpg",
        "autumn-leaves": "/api/plugin-samples/samples/scene-autumn-leaves-v3-4092e8d074ba.jpg",
        "snow-cabin": "/api/plugin-samples/samples/scene-snow-cabin-v14-d8cc92bf1595.jpg",
        "cafe-afternoon": "/api/plugin-samples/samples/scene-cafe-afternoon-v3-820e1318d077.jpg",
        "lakeside-sunset": "/api/plugin-samples/samples/scene-lakeside-sunset-v14-c0bf35adb577.jpg",
        "city-rain": "/api/plugin-samples/samples/scene-city-rain-v14-c1f458654847.jpg",
        "spring-picnic": "/api/plugin-samples/samples/scene-spring-picnic-v14-ab03a09ca82a.jpg",
        "railway-traveler": "/api/plugin-samples/samples/scene-railway-traveler-v14-a2a544795749.jpg",
        "tennis-champion": "/api/plugin-samples/samples/scene-tennis-champion-v14-169502ad95dd.jpg",
        "greenhouse-gardener": "/api/plugin-samples/samples/scene-greenhouse-gardener-v14-70fc5d966fc0.jpg",
        "sailboat-holiday": "/api/plugin-samples/samples/scene-sailboat-holiday-v14-ef6b395c05e8.jpg",
        "berry-pastry-chef": "/api/plugin-samples/samples/scene-berry-pastry-chef-v14-362bd1b32ff3.jpg",
        "paper-flower-window": "/api/plugin-samples/samples/scene-paper-flower-window-v14-35aa349e8055.jpg",
        "mountain-cable-car": "/api/plugin-samples/samples/scene-mountain-cable-car-v14-38f8f57ec124.jpg",
        "laundry-day": "/api/plugin-samples/samples/scene-laundry-day-v14-87925c8cc352.jpg",
        "museum-curator": "/api/plugin-samples/samples/scene-museum-curator-v14-905b73dda411.jpg",
        "poolside-vacation": "/api/plugin-samples/samples/scene-poolside-vacation-v14-65eb4c8fead2.jpg",
        "post-office": "/api/plugin-samples/samples/scene-post-office-v14-9df3e452befe.jpg",
        "ballet-backstage": "/api/plugin-samples/samples/scene-ballet-backstage-v12-a6336d6b5100.jpg",
        "shorthair-armchair": "/api/plugin-samples/samples/scene-shorthair-armchair-v14-9a5a0ece84b8.jpg",
        "shorthair-books": "/api/plugin-samples/samples/scene-shorthair-books-v13-ce3a51957ec7.jpg",
        "shorthair-night-rim": "/api/plugin-samples/samples/scene-shorthair-night-rim-v11-6d759271e937.jpg",
        "shorthair-paper-bag": "/api/plugin-samples/samples/scene-shorthair-paper-bag-v14-f4665e5aab7f.jpg",
        "corgi-denim": "/api/plugin-samples/samples/scene-corgi-denim-v11-12537d4acd2d.jpg",
        "corgi-crate": "/api/plugin-samples/samples/scene-corgi-crate-v9-249049005c23.jpg",
        "corgi-sploot": "/api/plugin-samples/samples/scene-corgi-sploot-v14-1a1fb0355773.jpg",
        "corgi-sweater": "/api/plugin-samples/samples/scene-corgi-sweater-v14-4004951696c0.jpg",
        "calico-silk": "/api/plugin-samples/samples/scene-calico-silk-v12-7a8bd8325eb0.jpg",
        "calico-bowl": "/api/plugin-samples/samples/scene-calico-bowl-v12-33d46a92b440.jpg",
        "calico-rain-window": "/api/plugin-samples/samples/scene-calico-rain-window-v14-a39a62e4c131.jpg",
        "calico-cane-stool": "/api/plugin-samples/samples/scene-calico-cane-stool-v11-78fc47981c48.jpg",
      },
      sceneOptions: petArtPhotoScenes.map(({ id, title, description }) => ({ id, title, description })),
    },
    status: "live",
  },
  {
    id: "pl-15",
    code: "PL-15",
    name: "星尘互动页",
    category: "interactive",
    tagline: "让照片、文案和星光在一页里慢慢发生",
    description: "编辑一张可公开访问的互动 H5，并导出统一的 15 秒 MP4 纪念片。",
    accent: "blue",
    input: {
      photos: { min: 1, max: 6 },
      profileFields: ["name", "species"],
    },
    generator: { type: "h5-theme", template: "stardust-v1" },
    pricing: { unlockPrice: 0, label: "互动页与 15 秒导出" },
    output: { formats: ["h5"] },
    // 原 PL-22「星尘纪念页」并入此处（D5）。两者是同一个 h5-theme 模板的
    // 两套调性包装，都免费，没有理由占两张卡位。
    // senior 只换一句 tagline：星尘页本身已经足够安静，描述不必改。
    toneVariants: {
      senior: { tagline: "让此刻的星光慢慢发生" },
      memorial: { name: "星尘纪念页", tagline: "在一页星光里安静地记住", description: "克制、无留言与营销内容的公开纪念页。" },
    },
    /*
     * 2026-09 下线：互动星尘页的页面、接口和导出都已删除，manifest 只保留为 archived。
     * **不能删**：纪念空间「星尘纪念页」与历史互动导出作品都以 plugin_id='pl-15' 入库，
     * works 没有 plugin_snapshot，hydrateWork 现查 manifest，删掉会让这些作品打不开。
     * toneVariants.memorial 提供纪念星尘页的显示名，同样保留。
     */
    status: "archived",
  },
  {
    id: "pl-19",
    code: "PL-19",
    name: "宠物记忆短片",
    category: "video",
    tagline: "把照片、字幕和音乐剪成一段会呼吸的记忆",
    description: "可编辑的竖屏宠物短片，时长 10 / 20 / 30 秒可选，支持预览和高清解锁。",
    accent: "orange",
    input: { photos: { min: 1, max: 20 }, profileFields: ["name", "species"] },
    generator: { type: "ffmpeg", template: "memory-film-v1" },
    // 基础价，实际按积累量分档（≤20 张 19.9 / 21–60 张 29.9 / 跨度满年 39.9）。
    pricing: { unlockPrice: 19.9, label: "保存高清视频" },
    output: { formats: ["video"] },
    samples: { heroUrl: "/api/plugin-samples/samples/mp26-pl-19-713030e67164.jpg" },
    // 原 PL-21「纪念视频」并入此处（D4）。两者走同一条 ffmpeg 链路。
    /*
     * senior 调性同画册：去掉「会呼吸的记忆」这类修饰（此刻读起来轻浮），
     * 换成陈述现在的说法。同样不提「最后」「剩下的时间」。
     */
    toneVariants: {
      senior: { tagline: "把现在的样子剪成一段短片", description: "晚年的日常同样值得成片。可编辑的竖屏短片，时长 10 / 20 / 30 秒可选。" },
      memorial: { name: "纪念短片", tagline: "让照片在一段短片里重新流动", description: "把选中的照片剪成一段安静的短片。", unlockPrice: 49, label: "高清纪念短片" },
    },
    status: "live",
  },
  {
    /*
     * 成长对比图。属「积累」层，`unlockPrice: 0` 免费带水印，作分享钩子。
     *
     * `photos.min` 是 **2** 而不是 1：一张照片比不出变化，
     * 放行 1 张只会让用户拿到一张左右一样的图，然后觉得这个玩法是坏的。
     *
     * 样例图仅演示两张同一宠物不同阶段的并排构图；实际结果始终使用用户自己的两张照片。
     */
    id: "pl-23", code: "PL-23", name: "成长对比图", category: "layout", tagline: "把两个时间点放在一起看", description: "同一只宠物两个时间点的并排对比，标注中间过了多少天。", accent: "yellow", input: { photos: { min: 2, max: 2 }, profileFields: ["name", "birthday"] }, generator: { type: "html-template", template: "growth-compare-v1" }, pricing: { unlockPrice: 0, label: "免费保存" }, output: { formats: ["image"] }, samples: { heroUrl: "/api/plugin-samples/samples/mp26-pl-23-v4-e7a4b4054ae8.jpg" }, status: "live",
  },

  /*
   * ---------- 已合并的老玩法：保留为 archived，不删条目 ----------
   *
   * PL-20/21/22 的能力已并入 PL-03/19/15 的 `toneVariants.memorial`
   * （改造方案 D3–D5），首页不再出现它们（`/api/plugins` 只输出 live）。
   *
   * **但不能把条目删掉。** `works` 表**没有** `plugin_snapshot` 列
   * （只有 `generation_tasks` 和 `orders` 有），`hydrateWork` 一律走
   * `getRuntimePlugin(work.pluginId)` 现查 —— 删掉条目会让所有历史
   * 纪念册/纪念视频/纪念页作品直接抛 `WORK_INCOMPLETE`，打不开也删不掉。
   *
   * 这是产品改造方案 4.1 里判断错了的一处：那里以为作品有快照兜底。
   * archived 状态同时满足两个要求：新用户看不到，老作品仍读得出。
   */
  {
    id: "pl-20", code: "PL-20", name: "纪念册", category: "memorial", tagline: "把共同生活整理成一本册子", description: "已并入宠物画册的纪念形态。", accent: "yellow", input: { photos: { min: 1, max: 20 }, profileFields: ["name", "species"] }, generator: { type: "html-template", template: "memorial-album-v1" }, pricing: { unlockPrice: 29.9, label: "高清纪念册" }, output: { formats: ["image", "pdf"] }, status: "archived",
  },
  {
    id: "pl-21", code: "PL-21", name: "纪念视频", category: "memorial", tagline: "让照片在一段短片里重新流动", description: "已并入宠物短片的纪念形态。", accent: "blue", input: { photos: { min: 1, max: 20 }, profileFields: ["name", "species"] }, generator: { type: "ffmpeg", template: "memorial-video-v1" }, pricing: { unlockPrice: 29.9, label: "高清纪念视频" }, output: { formats: ["video"] }, status: "archived",
  },
  {
    id: "pl-22", code: "PL-22", name: "星尘纪念页", category: "memorial", tagline: "在一页星光里安静地记住", description: "已并入星尘页的纪念形态。", accent: "blue", input: { photos: { min: 1, max: 20 }, profileFields: ["name", "species"] }, generator: { type: "h5-theme", template: "memorial-stardust-v1" }, pricing: { unlockPrice: 0, label: "纪念页" }, output: { formats: ["h5"] }, status: "archived",
  },
];

export function getPlugin(id: string) {
  return plugins.find((plugin) => plugin.id === id);
}
