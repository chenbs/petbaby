/*
 * 岛屿素材清单（22 号文 5.3、24 号文 7.4）。
 *
 * **素材 URL 由服务端下发，端上不硬编码。** 站内存相对路径，出口按 `PUBLIC_APP_URL`
 * 补域名 —— 与 `plugins/registry.ts` 的样例图同一个道理：小程序 `<image src>` 与
 * `wx.downloadFile` 遇到以 `/` 开头的值会当主包内本地文件找，必然裂图且不报错
 * （CLAUDE.md 已记录这个坑）。
 *
 * **键名带内容哈希，换图必须换键**：`/api/plugin-samples` 对这批对象下发
 * immutable 长缓存，同名换内容会让老客户端永远拿到旧图。哈希由
 * `tools/imagegen/upload-island.mjs` 计算并打印，粘进下面那张表。
 *
 * 落在 `samples/island/` 前缀下而非顶层 `island/`：那条公开只读路由把前缀锁死在
 * `samples/`，另起顶层前缀就得再开一条路由，而这批素材的公开性质与玩法样例图完全相同。
 *
 * **缺素材时留空，不画占位色块。** `LocalImageProvider` 的纯色 SVG 正是方案点名的
 * 抽象色块违例，挂上去比留空更糟 —— 端上对缺失键走「素材未就绪」路径
 * （纯色底 + 立绘，见 `island/scene/renderer.js` 的 `paintBase`）。
 */

/** M1 的素材槽位。顺序即端上加载优先级 —— 底图与立绘先到，可选层最后 */
export const ISLAND_ASSET_SLOTS = [
  "scene-yard",
  "pet-sample",
  "prop-grass",
  "prop-bowl",
  "prop-bed",
  "item-set",
  "hero-island",
  "scene-yard-front",
] as const;

export type IslandAssetSlot = (typeof ISLAND_ASSET_SLOTS)[number];

/**
 * 站内相对路径。**由 `upload-island.mjs` 的输出粘贴而来，不要手写哈希。**
 *
 * 2026-08-06 回填：7 张必需素材已全部到齐（用户提供 6 张，`hero-island` 由
 * `generate.mjs island` 以 `scene-yard.png` 作参考图**图生图**派生 ——
 * 入口卡与进岛画面紧挨着看，文生图的风格漂移会很明显）。
 * `scene-yard-front` 是可选的近景虚化层，未提供，缺它只少一层景深。
 *
 * 合计 6.19MB：**无单张超端上 `MAX_ENTRY_BYTES` 2MB**（超了那张不进缓存、
 * 每次进岛重下），总量在 `BUDGET_BYTES` 8MB 之内。加素材前先量这两个数。
 *
 * 换图必须重跑脚本换键（内容哈希），并**重量 `ISLAND_ANCHORS`** —— 那七组坐标
 * 与底图强耦合。
 */
const ISLAND_ASSET_PATHS: Partial<Record<IslandAssetSlot, string>> = {
  "scene-yard": "/api/plugin-samples/samples/island/scene-yard-34cf1c2ca13f.jpg",
  "prop-grass": "/api/plugin-samples/samples/island/prop-grass-40679d913e11.png",
  "prop-bowl": "/api/plugin-samples/samples/island/prop-bowl-97e0cc4b7f25.png",
  "prop-bed": "/api/plugin-samples/samples/island/prop-bed-9c51b6430344.png",
  "item-set": "/api/plugin-samples/samples/island/item-set-f3c002049280.png",
  "pet-sample": "/api/plugin-samples/samples/island/pet-sample-8875ffb8bd67.png",
  "hero-island": "/api/plugin-samples/samples/island/hero-island-0c8bf84d2812.jpg",
  // scene-yard-front（近景虚化前景层）是可选项，未提供 —— 缺它只是少一层景深，不影响功能
};

/**
 * 底图上的三组关键坐标（24 号文 7.3）。
 *
 * **与底图强耦合：换底图必须重量。** 端上有一份同值预设
 * （`island/scene/layout.js` 的 `DEFAULT_ANCHORS`），服务端下发的这份覆盖它 ——
 * `applyAnchors()` 逐键合并，只覆盖给了的键。两份都有的理由是首屏：
 * 快照还没回来时端上也要能画，缺一组坐标会让宠物直接消失。
 *
 * 取值当前是按 2.1 的构图约束推的预设（中左侧空草地作站位、右侧屋墙带一扇窗、
 * 顶部 15% 纯天空），素材定稿后用取色器量出来替换。
 */
export const ISLAND_ANCHORS = {
  /**
   * 晴档站位：中左侧那片干净空草地（2496×3744 定稿图上量得，2026-08-06）。
   * x/y 是宠物**脚底中心**，归一化于底图。
   *
   * 取这里而不是画面正中：正中是石板小径，宠物站在路上会压住路面纹理；
   * 而这片草地是底图刻意留空的（24 号文 2.1 的构图约束），四周无物件遮挡。
   */
  petClear: { x: 0.414, y: 0.607 },
  /**
   * 雨雪档站位：**茅草屋的开放式门廊下**（2.5.2「一起躲雨」而不是「淋雨的宠物」）。
   *
   * 门廊在底图左侧（柱子 + 地板那一格，x 约 0.06–0.22），所以站位比晴档更靠左、
   * 也更靠上 —— 门廊地板本身在画面中段。**不是屋顶右侧**：那边是实墙没有檐下空间。
   */
  petShelter: { x: 0.203, y: 0.443 },
  /**
   * 窗户矩形：夜间暖光径向渐变的绘制位置。
   *
   * 定稿图上是红门**上方**那扇圆窗（不是门本身）。尺寸按实测的圆窗直径给，
   * 比原预设小得多 —— 原来的 0.13×0.11 会让暖光糊满半间屋子。
   */
  window: { x: 0.383, y: 0.345, w: 0.042, h: 0.029 },
  /**
   * 地平线：天空向上延伸的接缝位置，也是物件层级排序基线。
   *
   * 定稿图的树线/天空交界在 **y≈0.195**，远高于原预设的 0.46 ——
   * 这张图的天空只占顶部一小条，主体是俯视的院子。预设值偏低会让
   * `skyGradientStops()` 从院子中段就开始画天空色，表现是画面中间横着一道亮边。
   *
   * **七组坐标都是在渲染图上画框验证过的，不是按裁切区算的。** 第一版按「裁切区
   * 偏移 + 缩放系数」推导，结果 window 落到屋顶天窗、petShelter 悬在门廊屋顶上方、
   * grass 压在花坛里 —— 而这类错位**不报错**，只是物件长在不该长的地方。
   * 改锚点后请重跑 `/tmp` 那段叠框脚本再看一眼，别只信算式。
   */
  horizonY: 0.195,
  /** 可点的草丛：落在左下那丛花草旁的空地，避开石板路 */
  grass: { x: 0.289, y: 0.686 },
  /** 食盆：门廊右前方的空地，靠近屋子（喂食的自然位置） */
  bowl: { x: 0.289, y: 0.518 },
  /** 宠物窝：右下池塘左侧的平地 */
  bed: { x: 0.523, y: 0.654 },
} as const;

/**
 * 把相对路径补成绝对地址。
 *
 * 域名复用既有的 `PUBLIC_APP_URL`，不新增变量：它已被 `deploy/scripts/preflight.sh`
 * 列为必填并校验 HTTPS（`/api/plugins` 的 `absolutize` 同一处理）。
 * 未配置时（本地联调）按请求来源推导。
 */
export function islandAssetUrls(origin: string): Partial<Record<IslandAssetSlot, string>> {
  const base = String(origin || "").replace(/\/+$/, "");
  const output: Partial<Record<IslandAssetSlot, string>> = {};
  for (const slot of ISLAND_ASSET_SLOTS) {
    const relative = ISLAND_ASSET_PATHS[slot];
    if (!relative) continue;
    output[slot] = relative.startsWith("/") ? `${base}${relative}` : relative;
  }
  return output;
}

/** 当前已配置的素材槽位数。`/api/health` 与冒烟脚本用它判断有没有漏灌 */
export function configuredIslandAssetCount(): number {
  return ISLAND_ASSET_SLOTS.filter((slot) => Boolean(ISLAND_ASSET_PATHS[slot])).length;
}

/**
 * 已配置的**站内相对路径**清单，给冒烟脚本逐张取字节用。
 *
 * 为什么不让冒烟脚本读 `/api/island`：那条路由要鉴权（`requireUserId`），
 * 而冒烟脚本在 Compose 网络内无会话地直连 web —— 读它只会拿到 401，
 * 于是「取不到任何地址」被当成「没配素材」静默通过，那正是这个校验要防的事。
 * `/api/health` 是公开的，且这些路径本身就是公开只读对象（`samples/` 前缀）。
 *
 * 给相对路径而不是绝对 URL：冒烟脚本按 `http://web:3000` 自己拼，
 * 而 `PUBLIC_APP_URL` 指向对外域名，容器内不一定解析得到。
 */
export function configuredIslandAssetPaths(): string[] {
  return ISLAND_ASSET_SLOTS.map((slot) => ISLAND_ASSET_PATHS[slot]).filter((path): path is string => Boolean(path));
}
