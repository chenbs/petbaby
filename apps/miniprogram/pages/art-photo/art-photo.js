const wallet = require("../../services/wallet");
const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample, imageEntries, manifest } = require("../../services/sample-assets");
const { CATEGORY_COVERS } = require("../../services/home-effect-ids");

/*
 * 「创作」Tab（2026-09 改版，原「写真」Tab）。
 *
 * 顶部分段（2026-10-09 由三段改四段）：宠物写真 / 人宠写真 / 如果我是人 / 其他玩法。宠物写真是默认第一屏。
 * - 人宠写真是主人 + 宠物同框，8 组、每组 2 个镜头，点镜头直达制作页；没有 live 人宠模板时不出这一段。
 * - 宠物写真：价格从服务端下发。套餐档位**从空白开始挑**（2026-10-09）：原先预选前 10 套，
 *   用户没选过的照片被打了勾，想换一张还得先取消，莫名其妙。现在点选按顺序编号，可「帮我挑满」随机补齐；
 *   10 张选满再点新的一张，问要不要换成 20 张一组，而不是只报错。
 * - 如果我是人：40 款造型带名字与筛选标签，点哪张就直达哪张。
 * - 其他玩法：首页的所有分类与图文 / 短片玩法都能在这里找到。
 */
const collections = [
  { id: "everyday", title: "柔软日常", subtitle: "光线里最熟悉的我", ids: ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon"] },
  { id: "outside", title: "去看世界", subtitle: "每一步都像故事开场", ids: ["seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset"] },
  { id: "story", title: "奇妙时刻", subtitle: "为我留一帧特别的画面", ids: ["night-playful", "snow-cabin", "city-rain", "spring-picnic"] },
  /*
   * 13–36 套（2026-10 v12 重做为「宠物瞬间」）暂不分类、按场景表原顺序平铺；用户审完模板后再定分类与排序。
   * 旧的「光影肖像 / 静物棚拍 / 胶片与布景 / 屋里的光 / 安静的静物」等分组已撤下。
   */
  { id: "more", title: "更多写真", subtitle: "抓住我最可爱的那一下", ids: ["railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday", "berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day", "museum-curator", "poolside-vacation", "post-office", "ballet-backstage", "shorthair-armchair", "shorthair-books", "shorthair-night-rim", "shorthair-paper-bag", "corgi-denim", "corgi-crate", "corgi-sploot", "corgi-sweater", "calico-silk", "calico-bowl", "calico-rain-window", "calico-cane-stool"] }
];
const SEGMENTS = [{ id: "pet", label: "宠物写真" }, { id: "duo", label: "人宠写真" }, { id: "human", label: "如果我是人" }, { id: "all", label: "其他玩法" }];
/** 老入口的分段名：「写真馆」拆成了宠物写真 / 人宠写真 */
const LEGACY_SEGMENT = { art: "pet" };
const PLUGIN_PLAYS = ["pet-movie-poster", "pet-time-album", "pl-19", "pl-23", "pet-id-card"];
const PACKAGE_COUNT = { single: 1, ten: 10, twenty: 20 };

function cost(value) { return typeof value === "number" ? wallet.costText(value) : ""; }
function segmentId(value) { const id = LEGACY_SEGMENT[value] || value; return SEGMENTS.some((item) => item.id === id) ? id : ""; }
/** 洗牌后取前 n 个，「帮我挑满」用 */
function pickRandom(list, n) {
  const pool = list.slice();
  for (let i = pool.length - 1; i > 0; i -= 1) { const j = Math.floor(Math.random() * (i + 1)); const t = pool[i]; pool[i] = pool[j]; pool[j] = t; }
  return pool.slice(0, n);
}

themedPage({
  data: {
    segments: SEGMENTS, segment: "pet", sceneCount: 0,
    duoGroups: [], duoCount: 0, duoPriceText: "",
    collections: [], loading: true, error: "",
    packageMode: "ten", packageTotal: 10, packages: null, selectedSceneIds: [], selectedCount: 0, dockText: "", dockSub: "",
    humanTags: [], humanTag: "", humanTemplates: [], humanVisible: [], humanPriceText: "",
    categories: [], plays: [], playChip: "all", playChips: [], visibleCategories: [], visiblePlays: []
  },
  onLoad(query) {
    const segment = query && (segmentId(query.segment) || segmentId(query.mode));
    if (segment) this.setData({ segment });
    this.load();
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 1 });
    // 首页入口卡 / 「挑一个玩法 › 全部」切过来时带上要打开的分段（switchTab 不能带参数）
    const app = typeof getApp === "function" ? getApp() : null;
    if (!app || !app.globalData) return;
    if (app.globalData.createSegment) {
      const segment = segmentId(app.globalData.createSegment);
      app.globalData.createSegment = "";
      if (segment) this.setData({ segment });
    }
    // 单张写真页「一次拍一组」切过来：带上档位和当前那一套，剩下的由用户自己挑
    if (app.globalData.artPackage) {
      this._pendingPackage = app.globalData.artPackage;
      app.globalData.artPackage = null;
      this.applyPendingPackage();
    }
  },
  applyPendingPackage() {
    const pending = this._pendingPackage;
    if (!pending || !this._allSceneIds) return;
    this._pendingPackage = null;
    const mode = PACKAGE_COUNT[pending.mode] && pending.mode !== "single" ? pending.mode : "ten";
    const picked = (pending.sceneIds || []).filter((id) => this._allSceneIds.indexOf(id) >= 0);
    const selectedSceneIds = picked.concat(this.data.selectedSceneIds.filter((id) => picked.indexOf(id) < 0)).slice(0, PACKAGE_COUNT[mode]);
    this.setData({ segment: "pet", packageMode: mode, packageTotal: PACKAGE_COUNT[mode], selectedSceneIds });
    this.showSelection();
  },
  chooseSegment(event) {
    const id = segmentId(event.currentTarget.dataset.id);
    if (id) this.setData({ segment: id });
  },
  load() {
    this.setData({ loading: true, error: "" });
    Promise.all([
      api.request("/api/plugins"),
      api.request("/api/art-photo-bundles/packages").catch(() => null),
      api.request("/api/image-templates").catch(() => ({ entries: [] }))
    ]).then((result) => {
      const plugins = result[0] || [];
      const source = plugins.find((item) => item.id === "pl-10");
      if (!source) throw new Error("写真场景暂不可用，请稍后重试");
      const samples = pluginSample(source).samples || {};
      const options = samples.sceneOptions || [];
      const groups = collections.map((group) => Object.assign({}, group, {
        scenes: group.ids.map((id) => {
          const option = options.find((item) => item.id === id);
          return option ? Object.assign({}, option, { url: samples.sceneUrls && samples.sceneUrls[id] || "" }) : null;
        }).filter(Boolean)
      })).filter((group) => group.scenes.length);
      this._baseCollections = groups;
      this._allSceneIds = groups.reduce((all, group) => all.concat(group.scenes.map((scene) => scene.id)), []);
      const priced = result[1] || {};
      const single = priced.single || { cost: source.dongan && source.dongan.from, count: 1 };
      // 套餐卡第三行写「比单张省多少」：颗数已经在价格行，再写一遍「每张 1.2 颗」只是噪声
      const saving = (pack) => {
        if (!pack || typeof pack.cost !== "number" || typeof single.cost !== "number" || !single.cost) return "";
        const percent = Math.round((1 - pack.cost / (pack.count * single.cost)) * 100);
        return percent > 0 ? "比单张省 " + percent + "%" : "";
      };
      const packages = {
        single: { label: "单张", price: cost(single.cost), unit: "先拍一套试试" },
        ten: { label: priced.ten && priced.ten.label || "10 张一组", price: cost(priced.ten && priced.ten.cost), unit: saving(priced.ten), recommended: true },
        twenty: { label: priced.twenty && priced.twenty.label || "20 张一组", price: cost(priced.twenty && priced.twenty.cost), unit: saving(priced.twenty) }
      };
      const entries = imageEntries(result[2] && Array.isArray(result[2].entries) ? result[2].entries : []);
      const human = entries.find((entry) => entry.id === "human");
      const humanTemplates = human ? human.templates : [];
      const tags = [];
      humanTemplates.forEach((item) => (item.tags || []).forEach((tag) => { if (tags.indexOf(tag) < 0) tags.push(tag); }));
      // 人宠写真按「组」展示：同一组是同一场拍摄的两个镜头
      const duo = entries.find((entry) => entry.id === "duo");
      const duoTemplates = duo ? duo.templates : [];
      const duoGroups = [];
      duoTemplates.forEach((item) => {
        const groupId = item.groupId || item.templateId;
        let group = duoGroups.find((entry) => entry.id === groupId);
        if (!group) { group = { id: groupId, title: item.groupTitle || item.title, description: item.groupDescription || "", shots: [] }; duoGroups.push(group); }
        group.shots.push(item);
      });
      // 人宠写真有自己的分段，「其他玩法」不再重复
      const categories = entries.filter((entry) => ["human", "boss", "duo"].indexOf(entry.id) < 0 && entry.templates.length).map((entry) => {
        // 水墨样片大面积留白，缩成分类卡后只剩一笔墨，艺术分类改用装饰艺术肖像作封面
        const coverId = entry.id === "art" ? "decorative-art-portrait" : CATEGORY_COVERS[entry.id];
        const cover = entry.templates.find((item) => item.templateId === coverId) || entry.templates[0];
        // 分类卡统一用 9:16 模板样片（含水墨），两列网格行高一致、样片不被裁
        return { id: entry.id, title: entry.title, count: entry.templates.length, cover: cover.sampleUrl, templateId: cover.templateId };
      });
      const plays = PLUGIN_PLAYS.map((id) => plugins.find((plugin) => plugin.id === id)).filter(Boolean).map(pluginSample).map((plugin) => ({
        id: plugin.id, name: plugin.name, category: plugin.category, cover: plugin.samples && plugin.samples.heroUrl || "",
        priceText: plugin.dongan && !plugin.dongan.free ? cost(plugin.dongan.from) + "起" : "免费"
      }));
      // 其他玩法：第一个 chip 是「麻麻精选」，后面是各分类，与首页瀑布流同源（评审 5.2）
      const playChips = (entries.some((entry) => entry.id === "boss") ? [{ id: "boss", label: "麻麻精选" }] : []).concat([{ id: "all", label: "全部" }], categories.map((item) => ({ id: item.id, label: item.title })));
      const duoCost = duoTemplates[0] && duoTemplates[0].donganCost;
      const humanCost = humanTemplates[0] && humanTemplates[0].donganCost;
      // 没有 live 人宠模板时不出「人宠写真」分段，停在它上面的回到宠物写真
      const segments = duoTemplates.length ? SEGMENTS : SEGMENTS.filter((item) => item.id !== "duo");
      const segment = segments.some((item) => item.id === this.data.segment) ? this.data.segment : "pet";
      this.setData({ segments, segment, duoGroups, duoCount: duoTemplates.length, duoPriceText: typeof duoCost === "number" ? "每张需要 " + cost(duoCost) : "", sceneCount: this._allSceneIds.length });
      // 套餐从空白开始挑；重新加载时保留用户已经挑的（只留仍然存在的场景）
      const kept = this.data.selectedSceneIds.filter((id) => this._allSceneIds.indexOf(id) >= 0);
      this.setData({ loading: false, packages, humanTemplates, humanVisible: humanTemplates, humanTags: tags, humanPriceText: typeof humanCost === "number" ? "每张需要 " + cost(humanCost) : "",
        categories, plays, playChips, visibleCategories: categories, visiblePlays: plays, selectedSceneIds: kept });
      this.showSelection();
      this.applyPendingPackage();
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  /**
   * 套餐档位下点图是「挑 / 取下」，按点选顺序编号。
   * 10 张选满后再点一张新的：问要不要换成 20 张一组（换了就把这张也放进去）；20 张选满只提示取下一张。
   */
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    const mode = this.data.packageMode;
    if (mode === "single") return wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(id) });
    const current = this.data.selectedSceneIds.slice();
    const index = current.indexOf(id);
    if (index >= 0) current.splice(index, 1);
    else if (current.length < PACKAGE_COUNT[mode]) current.push(id);
    else if (mode === "ten" && this.data.packages && this.data.packages.twenty && this.data.packages.twenty.price) return this.offerUpgrade(id);
    else return wx.showToast({ title: PACKAGE_COUNT[mode] + " 张选满了，点已选的可以取下", icon: "none" });
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    this.setData({ selectedSceneIds: current });
    this.showSelection();
  },
  offerUpgrade(id) {
    const twenty = this.data.packages.twenty;
    wx.showModal({
      title: "10 张已经挑满",
      content: "换成 20 张一组（" + twenty.price + "），这一张也能放进来。不换的话，先点已选的取下一张。",
      confirmText: "换 20 张",
      cancelText: "先不换",
      success: (result) => {
        if (!result.confirm) return;
        this.setData({ packageMode: "twenty", packageTotal: PACKAGE_COUNT.twenty, selectedSceneIds: this.data.selectedSceneIds.concat([id]) });
        this.showSelection();
      }
    });
  },
  /** 切档位不丢已挑的：20 → 10 时只保留先挑的 10 张；切到单张时先收着，切回来还在。 */
  choosePackage(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!PACKAGE_COUNT[mode] || mode === this.data.packageMode) return;
    let selectedSceneIds = this.data.selectedSceneIds;
    if (mode !== "single" && selectedSceneIds.length > PACKAGE_COUNT[mode]) {
      selectedSceneIds = selectedSceneIds.slice(0, PACKAGE_COUNT[mode]);
      wx.showToast({ title: "保留了先挑的 " + PACKAGE_COUNT[mode] + " 张", icon: "none" });
    }
    this.setData({ packageMode: mode, packageTotal: PACKAGE_COUNT[mode], selectedSceneIds });
    this.showSelection();
  },
  /** 「帮我挑满」：已挑的不动，剩下的名额从没挑的里随机补。 */
  fillSelection() {
    const mode = this.data.packageMode;
    const current = this.data.selectedSceneIds;
    const need = PACKAGE_COUNT[mode] - current.length;
    if (mode === "single" || need <= 0) return;
    const rest = (this._allSceneIds || []).filter((id) => current.indexOf(id) < 0);
    if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
    this.setData({ selectedSceneIds: current.concat(pickRandom(rest, need)) });
    this.showSelection();
  },
  clearSelection() {
    if (!this.data.selectedSceneIds.length) return;
    this.setData({ selectedSceneIds: [] });
    this.showSelection();
  },
  showSelection() {
    const selected = this.data.selectedSceneIds;
    const mode = this.data.packageMode;
    const total = PACKAGE_COUNT[mode];
    const pack = this.data.packages && this.data.packages[mode];
    const price = pack && pack.price || "";
    const multi = mode !== "single";
    const dockText = multi ? "已挑 " + selected.length + " / " + total + " 张" : "点一套布景就能开拍";
    const dockSub = multi
      ? (selected.length < total ? "还差 " + (total - selected.length) + " 张" : "挑好了，下一步选照片") + (price ? " · 共 " + price : "")
      : price ? "每张需要 " + price : "";
    this.setData({
      selectedCount: selected.length,
      dockText,
      dockSub,
      collections: (this._baseCollections || []).map((group) => Object.assign({}, group, { scenes: group.scenes.map((scene) => {
        const order = multi ? selected.indexOf(scene.id) + 1 : 0;
        return Object.assign({}, scene, { selected: order > 0, order });
      }) }))
    });
  },
  startBundle() {
    const mode = this.data.packageMode;
    const count = PACKAGE_COUNT[mode];
    if (mode === "single") return wx.showToast({ title: "点一套喜欢的布景就能开拍", icon: "none" });
    if (this.data.selectedSceneIds.length !== count) return wx.showToast({ title: "还差 " + (count - this.data.selectedSceneIds.length) + " 张，也可以点「帮我挑满」", icon: "none" });
    wx.navigateTo({ url: "/pages/art-photo-bundle/art-photo-bundle?package=" + mode + "&sceneIds=" + encodeURIComponent(this.data.selectedSceneIds.join(",")) });
  },
  onSceneImageError(event) {
    const id = event.currentTarget.dataset.id;
    this._baseCollections = (this._baseCollections || []).map((group) => Object.assign({}, group, { scenes: group.scenes.map((scene) => scene.id === id ? Object.assign({}, scene, { url: "" }) : scene) }));
    this.showSelection();
  },
  chooseHumanTag(event) {
    const tag = event.currentTarget.dataset.tag || "";
    const next = this.data.humanTag === tag ? "" : tag;
    this.setData({ humanTag: next, humanVisible: next ? this.data.humanTemplates.filter((item) => (item.tags || []).indexOf(next) >= 0) : this.data.humanTemplates });
  },
  onHumanImageError(event) {
    const id = event.currentTarget.dataset.id;
    const clear = (list) => list.map((item) => item.templateId === id ? Object.assign({}, item, { sampleUrl: "" }) : item);
    this.setData({ humanTemplates: clear(this.data.humanTemplates), humanVisible: clear(this.data.humanVisible) });
  },
  onDuoImageError(event) {
    const id = event.currentTarget.dataset.id;
    this.setData({ duoGroups: this.data.duoGroups.map((group) => Object.assign({}, group, { shots: group.shots.map((item) => item.templateId === id ? Object.assign({}, item, { sampleUrl: "" }) : item) })) });
  },
  openDuoTemplate(event) {
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=duo&templateId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  openHumanTemplate(event) {
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=human&templateId=" + encodeURIComponent(event.currentTarget.dataset.id) });
  },
  /** 其他玩法里的 chip：「麻麻精选」直接进精选制作页，其余在当前页筛出该分类。 */
  choosePlayChip(event) {
    const id = event.currentTarget.dataset.id || "all";
    if (id === "boss") return wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=boss" });
    this.setData({
      playChip: id,
      visibleCategories: id === "all" ? this.data.categories : this.data.categories.filter((item) => item.id === id),
      visiblePlays: id === "all" ? this.data.plays : []
    });
  },
  openCategory(event) {
    const { id, template } = event.currentTarget.dataset;
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=" + encodeURIComponent(id) + (template ? "&templateId=" + encodeURIComponent(template) : "") });
  },
  openPlay(event) {
    const { id, category } = event.currentTarget.dataset;
    if (category === "video") return wx.navigateTo({ url: "/pages/video-create/video-create" });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + encodeURIComponent(id) });
  },
  openFunTests() { wx.navigateTo({ url: "/pages/fun-tests/fun-tests" }); }
});
