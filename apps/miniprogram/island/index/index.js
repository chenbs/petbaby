const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const islandVars = require("../hud-vars");
const service = require("../service");
const ambient = require("../scene/ambient");
const assets = require("../scene/assets");
const rendererFactory = require("../scene/renderer");

/** 天气跨段检查间隔。段边界是整点，一分钟粒度足够（过渡本身要 2.4 秒） */
const AMBIENT_TICK_MS = 60000;

/**
 * 低端机判据：设备性能等级 `benchmarkLevel`。
 *
 * 微信给的是 0..∞ 的相对分，<10 属低端（官方口径），-1 / -2 表示未知或不支持 ——
 * 未知时**按低端处理**：多画 80 个粒子的收益远小于在低端机上掉帧的代价，
 * 而基准机型本来就是骁龙 6xx 级（22 号文 5.1）。
 */
function detectDegraded() {
  try {
    const info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {};
    const level = Number(info.benchmarkLevel);
    if (!isFinite(level) || level < 0) return true;
    return level < 10;
  } catch (error) {
    return true;
  }
}

themedPage({ immersive: true }, {
  data: {
    islandStyle: islandVars.getIslandStyle(),
    loading: true,
    error: "",
    /** 画布尺寸，px。WXML 用它给 canvas 定尺寸 */
    canvasWidth: 0,
    canvasHeight: 0,
    /** 状态栏高度，px。沉浸式页面自己让开刘海区 */
    safeTop: 20,
    /** HUD */
    petName: "",
    companionText: "",
    weatherText: "",
    phaseText: "",
    camera: "wide",
    /** 三个动作的可用状态。**上限来自服务端下发的 limits，不在端上写死** */
    gatherLeft: null,
    feedLeft: null,
    pettedLeft: null,
    /** 库存。**掉落物等服务端返回才显示**（5.6：允许乐观动画，不允许乐观数据） */
    inventory: [],
    /** 动作反馈文案。用完即隐 */
    actionHint: "",
    busy: false,
    /** 素材是否齐备。不齐时 HUD 给一句说明，画面走纯色底 + 立绘 */
    assetsReady: false,
    snapshot: null
  },

  /**
   * @param {object} query 可带 `petId`（从宠物档案的操作行进来时）。
   *        **不带 petId 时由服务端给默认宠物** —— 从「我的」页进来是这种情形，
   *        那里没有「哪一只」的上下文。带了就必须用它，否则点非默认宠物会看到错的那只。
   */
  onLoad(query) {
    this.petId = (query && query.petId) || "";
    this.degraded = detectDegraded();
    this.measure();
  },

  onReady() {
    this.setupCanvas();
  },

  onShow() {
    if (this.renderer) {
      this.renderer.setIdle(true);
      this.startAmbientTicker();
    }
    this.reload();
  },

  onHide() {
    // 页面不可见时停掉待机动画与天气粒子：雨雪档下帧循环本来不会自己停
    if (this.renderer) this.renderer.setIdle(false);
    this.stopAmbientTicker();
  },

  onUnload() {
    this.stopAmbientTicker();
    if (this.renderer) this.renderer.stop();
    this.renderer = null;
  },

  /** 画布按窗口尺寸铺满。沉浸式页面用 navigationStyle: custom，所以不减导航栏高度 */
  measure() {
    let info = {};
    try { info = (wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync()) || {}; } catch (error) { info = {}; }
    this.view = {
      width: info.windowWidth || 375,
      height: info.windowHeight || 667,
      dpr: info.pixelRatio || 2,
      statusBarHeight: info.statusBarHeight || 20
    };
    this.setData({ canvasWidth: this.view.width, canvasHeight: this.view.height, safeTop: this.view.statusBarHeight });
  },

  /**
   * 取 Canvas 2D 实例并建渲染器。
   *
   * **必须按 dpr 放大 backing store 再 scale**，否则在 2x/3x 屏上整张画面是模糊的 ——
   * 这是 `type="2d"` 的必做步骤，`<canvas>` 的 CSS 尺寸与像素尺寸不是一回事。
   */
  setupCanvas() {
    wx.createSelectorQuery().in(this).select("#island-scene").fields({ node: true, size: true }).exec((result) => {
      const node = result && result[0] && result[0].node;
      if (!node) return this.setData({ error: "画布初始化失败，退出重进试试" });
      const context = node.getContext("2d");
      const dpr = this.view.dpr;
      node.width = this.view.width * dpr;
      node.height = this.view.height * dpr;
      context.scale(dpr, dpr);
      // 素材加载要用 node.createImage()：Canvas 2D 的 Image 构造挂在画布实例上，不是全局的
      this.canvasNode = node;
      this.renderer = rendererFactory.createRenderer({
        canvas: node,
        context: context,
        view: { width: this.view.width, height: this.view.height, dpr: dpr }
      });
      this.renderer.setDegraded(this.degraded);
      this.applyAmbient();
      this.startAmbientTicker();
      /*
       * **`onShow` 早于 `onReady`**，所以首屏那一次 `applySnapshot` 几乎总是跑在
       * renderer 还不存在的时候 —— 它那边会跳过锚点与素材，由这里补。
       * 走同一个 `applyScene` 而不是只补素材：漏了锚点的话物件与站位会一直用预设坐标，
       * 而那种错位在没有底图时（纯色底路径）看不出来，等素材到齐才暴露。
       */
      if (this.data.snapshot) this.applyScene(this.data.snapshot);
    });
  },

  /** 把快照里的场景相关部分交给渲染器。renderer 就绪与快照到达的顺序不定，故单独成一处 */
  applyScene(snapshot) {
    if (!this.renderer || !snapshot) return;
    if (snapshot.anchors) this.renderer.setAnchors(snapshot.anchors);
    this.loadAssets(snapshot);
  },

  /**
   * 拉全量快照。
   *
   * 首次进入时岛可能还不存在 —— `POST /api/island` 是幂等的建岛，
   * 所以拿不到就建一次再拉，不需要额外的「是否已建岛」查询。
   */
  reload() {
    service.loadIsland(this.petId)
      .then((snapshot) => this.applySnapshot(snapshot))
      .catch(() => service.createIsland().then(() => service.loadIsland(this.petId)).then((snapshot) => this.applySnapshot(snapshot)))
      .catch((error) => this.setData({ loading: false, error: error.message || "小岛加载失败" }));
  },

  applySnapshot(snapshot) {
    if (!snapshot) return;
    const pet = snapshot.pet || {};
    /*
     * 陪伴天数**走 services/companion.js 不重算**（CLAUDE.md 硬约定：两端必须给出
     * 同一个数字）。已离开的宠物本不该进岛（服务端拦 + 列表过滤），
     * 但仍把 memorialSince 传进去 —— 万一有历史数据，天数也是封口的而不是递增的。
     */
    const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
    this.setData({
      loading: false,
      error: "",
      snapshot: snapshot,
      petName: pet.name || "",
      companionText: pet.name ? companion.companionText(pet, days) : "",
      inventory: snapshot.inventory || [],
      gatherLeft: service.remainingOf(snapshot, "gathered"),
      feedLeft: service.remainingOf(snapshot, "fed"),
      pettedLeft: service.remainingOf(snapshot, "petted")
    });
    // renderer 可能还没建好（onShow 早于 onReady），那时由 setupCanvas 末尾补这一步
    this.applyScene(snapshot);
  },

  /**
   * 素材远程加载。
   *
   * **逐张独立成败，取到几张画几张**（5.3）：底图失败不该拖垮立绘 —— 立绘是情感主体，
   * 哪怕只有它能画出来也比白屏好。全都没取到就是「素材未就绪」正式路径：
   * 纯色底 + 立绘，**不画占位色块**。
   */
  loadAssets(snapshot) {
    const entries = service.assetEntries(snapshot);
    if (!entries.length || !this.renderer || !this.canvasNode) return;
    assets.preload(this.canvasNode, entries)
      .then((map) => {
        if (!this.renderer) return;
        this.renderer.setImages(map);
        // 底图到了才算就绪。只有立绘时仍走纯色底那条路径，HUD 要照实说
        this.setData({ assetsReady: Boolean(map["scene-yard"]) });
      })
      .catch(() => undefined);
  },

  /** 按当前时间与岛 id 算环境并交给渲染器。同档位时渲染器会自己忽略 */
  applyAmbient() {
    const snapshot = this.data.snapshot;
    const islandId = (snapshot && snapshot.id) || "island";
    const next = ambient.ambientNow(islandId);
    if (this.renderer) this.renderer.setAmbient(next);
    this.setData({
      weatherText: ambient.WEATHER_LABEL[next.weather] || "",
      phaseText: ambient.PHASE_LABEL[next.phase] || ""
    });
  },

  /**
   * 跨段刷新。用户停留超过切换点时天气要跟着变（2.5.3），
   * 过渡由渲染器做 2.4 秒交叉淡入，不是瞬间跳变。
   */
  startAmbientTicker() {
    this.stopAmbientTicker();
    this.ambientTimer = setInterval(() => this.applyAmbient(), AMBIENT_TICK_MS);
  },

  stopAmbientTicker() {
    if (this.ambientTimer) { clearInterval(this.ambientTimer); this.ambientTimer = null; }
  },

  /**
   * 画布点击 → 命中表 → 动作。
   *
   * **Canvas 内没有节点，所以命中判定全靠自己维护的热区表**（5.1）。
   * 点空地不做任何事 —— 那不是「没反应」而是「那里本来就没有东西」。
   */
  handleCanvasTap(event) {
    if (!this.renderer || this.data.busy) return;
    const touch = (event.detail && typeof event.detail.x === "number") ? event.detail : (event.touches && event.touches[0]) || {};
    const zone = this.renderer.hitTest(touch.x, touch.y);
    if (!zone) return;
    if (zone.kind === "pet") return this.toggleCamera();
    if (zone.kind === "gather") return this.act("gather", zone.id);
    if (zone.kind === "feed") return this.act("feed", zone.id);
    if (zone.kind === "rest") return this.showRestHint();
  },

  /** 两档镜头。近景看表情，是情感承载层；全景看家园与积累（2.4） */
  toggleCamera() {
    const next = this.renderer.getCamera() === "close" ? "wide" : "close";
    this.renderer.setCamera(next);
    this.setData({ camera: next });
  },

  /**
   * 摸摸。近景 + 反馈动画 + 亲密度 +1（3.2）。
   *
   * **乐观动画、非乐观数据**：挤压与心形粒子立刻播（体验需要），
   * 亲密度由服务端返回后才落进快照。
   *
   * `ready()` 的守卫是必要的：动作条在 loading 期间就已渲染（它不等快照），
   * 而 renderer 要到 `onReady` 才建好 —— 这个窗口很短但真实存在，
   * 用户手快点一下会直接抛异常，表现是整页卡住。
   */
  pet() {
    if (!this.ready()) return;
    this.renderer.setCamera("close");
    this.setData({ camera: "close" });
    this.renderer.squash();
    this.renderer.emote("love", 4);
    this.act("pet", "pet");
  },

  /** 能否接受一次互动：渲染器已建、快照已到、上一次未在进行中 */
  ready() {
    return Boolean(this.renderer) && Boolean(this.data.snapshot) && !this.data.busy;
  },

  /** 采集。点草丛掉饼干等素材，每日上限 */
  gather() { this.act("gather", "grass"); },

  /** 喂食。用采集来的东西喂，反馈是表情与动作而不是数值弹字（4.2） */
  feed() { this.act("feed", "bowl"); },

  /**
   * 提交一次互动。
   *
   * 三个动作走同一个端点（5.5：拆开等于把额度校验与门禁复制三份，必漏改一处），
   * 端上这里也只有一条路径。
   */
  act(type, targetId) {
    if (!this.ready()) return;
    this.setData({ busy: true, actionHint: "" });
    // 乐观动画：先播，不等服务端
    if (type === "gather") this.renderer.emote("spark", 3);
    if (type === "feed") { this.renderer.squash(); this.renderer.emote("crumb", 4); }

    service.submitAction(type, { targetId: targetId })
      .then((result) => {
        /*
         * **掉落物到这里才显示。** 乐观加数会在断网重连后与服务端对不上，
         * 而岛的库存是要累积的 —— 对不上就不只是显示错，是用户觉得东西丢了。
         *
         * `|| {}` 兜住「请求在飞、用户退出了页面」：那时 snapshot 已随 onUnload 清掉，
         * 直接读 `.inventory` 会抛在一个没有界面能显示错误的地方。
         */
        const previous = this.data.snapshot || {};
        const snapshot = Object.assign({}, previous, {
          inventory: result.inventory || previous.inventory,
          today: result.today || previous.today
        });
        this.setData({
          busy: false,
          snapshot: snapshot,
          inventory: snapshot.inventory || [],
          gatherLeft: service.remainingOf(snapshot, "gathered"),
          feedLeft: service.remainingOf(snapshot, "fed"),
          pettedLeft: service.remainingOf(snapshot, "petted"),
          actionHint: result.message || ""
        });
      })
      .catch((error) => {
        /*
         * 超额时服务端返回 429。措辞是「今天的草丛都看过了」而不是「体力耗尽」——
         * **这个差异决定它是不是 4.1 #4 的体力值**，所以文案在端上按 type 给，
         * 不直接把服务端的错误码贴出来。
         */
        const limited = /429|上限|额度/.test(error.message || "");
        this.setData({
          busy: false,
          actionHint: limited ? this.limitHintOf(type) : (error.message || "刚才那下没成功，再试一次")
        });
      });
  },

  /**
   * 到达每日上限时的措辞。
   *
   * **不能说「体力耗尽」「行动点用完」** —— 那会把左列的采集变成右列的体力值机制
   * （22 号文 1.1 表 / 4.1 #4）。说的是「今天的草丛都看过了」：同样传达了「今天到这儿」，
   * 但读作世界的自然状态而不是资源被消耗，且没有任何「可付费恢复」的暗示。
   */
  limitHintOf(type) {
    if (type === "gather") return "今天的草丛都看过了，明天再来转转";
    if (type === "feed") return "它今天吃得挺好，明天再喂吧";
    return "今天已经摸够多啦";
  },

  /** 点窝：不是互动动作，只给一句状态描述 + 飘 Z 的粒子。不消耗额度、不发请求 */
  showRestHint() {
    if (!this.renderer) return;
    this.renderer.emote("sleep", 3);
    this.setData({ actionHint: this.data.petName ? this.data.petName + "的窝，晒着太阳" : "它的窝，晒着太阳" });
  },

  /** 写今天：唯一的悬浮按钮（2.3） */
  openDiary() {
    wx.navigateTo({ url: "/island/diary/diary" });
  },

  /** 立绘生成/重生成入口 */
  openAvatar() {
    wx.navigateTo({ url: "/island/avatar/avatar" });
  },

  /** 退回全景。近景档的动作条按钮触发，那时 renderer 一定在，但守一下不亏 */
  backToWide() {
    if (!this.renderer || this.renderer.getCamera() === "wide") return;
    this.renderer.setCamera("wide");
    this.setData({ camera: "wide" });
  }
});
