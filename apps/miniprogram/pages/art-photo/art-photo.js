const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample, imageEntries, manifest } = require("../../services/sample-assets");
const { CATEGORY_COVERS } = require("../../services/home-effect-ids");

/*
 * 「创作」Tab（2026-09 改版，原「写真」Tab）。
 *
 * 顶部分段：写真馆 / 如果我是人 / 其他玩法。写真馆仍是默认第一屏。
 * - 写真馆：价格从服务端下发（原先 ¥9.9 / ¥19.9 写死在 WXML），默认预选 10 套，用户只需替换；
 *   选全部套餐时点图提示「全部已包含」，不再毫无反馈。
 * - 如果我是人：40 款造型带名字与筛选标签，点哪张就直达哪张。
 * - 其他玩法：首页的所有分类与图文 / 短片玩法都能在这里找到。
 */
const collections = [
  { id: "everyday", title: "柔软日常", subtitle: "光线里最熟悉的我", ids: ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon"] },
  { id: "outside", title: "去看世界", subtitle: "每一步都像故事开场", ids: ["seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset"] },
  { id: "story", title: "奇妙时刻", subtitle: "为我留一帧特别的画面", ids: ["night-playful", "snow-cabin", "city-rain", "spring-picnic"] },
  { id: "journey", title: "光影肖像", subtitle: "一盏灯、一扇窗，就够了", ids: ["railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday"] },
  { id: "little-days", title: "静物棚拍", subtitle: "干净的底色，只留下我", ids: ["berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day"] },
  { id: "cat-story", title: "胶片与布景", subtitle: "像老照片一样耐看", ids: ["museum-curator", "poolside-vacation", "post-office", "ballet-backstage"] },
  { id: "cozy-room", title: "屋里的光", subtitle: "扶手椅、旧书和一束夜光", ids: ["shorthair-armchair", "shorthair-books", "shorthair-night-rim", "shorthair-paper-bag"] },
  { id: "sunny-floor", title: "暖色布景", subtitle: "笑一笑，趴一趴", ids: ["corgi-denim", "corgi-crate", "corgi-sploot", "corgi-sweater"] },
  { id: "quiet-still", title: "安静的静物", subtitle: "绸布、陶碗和雨天窗台", ids: ["calico-silk", "calico-bowl", "calico-rain-window", "calico-cane-stool"] }
];
const SEGMENTS = [{ id: "art", label: "写真馆" }, { id: "human", label: "如果我是人" }, { id: "all", label: "其他玩法" }];
const PLUGIN_PLAYS = ["pet-movie-poster", "pet-time-album", "pl-19", "pl-23", "pet-id-card"];
const PACKAGE_COUNT = { single: 1, ten: 10, all: 36 };

function money(value) { return typeof value === "number" ? "¥" + value : ""; }

themedPage({
  data: {
    segments: SEGMENTS, segment: "art",
    collections: [], loading: true, error: "",
    packageMode: "ten", packages: null, selectedSceneIds: [], selectedCount: 0, dockText: "",
    humanTags: [], humanTag: "", humanTemplates: [], humanVisible: [],
    categories: [], plays: [], playChip: "all", playChips: [], visibleCategories: [], visiblePlays: []
  },
  onLoad(query) {
    if (query && SEGMENTS.some((item) => item.id === query.segment)) this.setData({ segment: query.segment });
    this.load();
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 1 });
    // 首页「挑一个玩法 › 全部」切过来时打开「其他玩法」分段（switchTab 不能带参数）
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData && app.globalData.createSegment) {
      const segment = app.globalData.createSegment;
      app.globalData.createSegment = "";
      if (SEGMENTS.some((item) => item.id === segment)) this.setData({ segment });
    }
  },
  chooseSegment(event) {
    const id = event.currentTarget.dataset.id;
    if (SEGMENTS.some((item) => item.id === id)) this.setData({ segment: id });
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
      const single = priced.single || { amount: source.pricing && source.pricing.unlockPrice, count: 1 };
      const packages = {
        single: { label: "单张写真", price: money(single.amount), unit: "每套 1 张" },
        ten: { label: (priced.ten && priced.ten.label) || "精选 10 套", price: money(priced.ten && priced.ten.amount), unit: priced.ten ? "≈ ¥" + priced.ten.perScene + " / 套" : "每套 1 张", recommended: true },
        all: { label: (priced.all && priced.all.label) || "全部 36 套", price: money(priced.all && priced.all.amount), unit: priced.all ? "≈ ¥" + priced.all.perScene + " / 套" : "每套 1 张" }
      };
      const entries = imageEntries(result[2] && Array.isArray(result[2].entries) ? result[2].entries : []);
      const human = entries.find((entry) => entry.id === "human");
      const humanTemplates = human ? human.templates : [];
      const tags = [];
      humanTemplates.forEach((item) => (item.tags || []).forEach((tag) => { if (tags.indexOf(tag) < 0) tags.push(tag); }));
      const categories = entries.filter((entry) => ["human", "boss"].indexOf(entry.id) < 0 && entry.templates.length).map((entry) => {
        // 水墨样片大面积留白，缩成分类卡后只剩一笔墨，艺术分类改用装饰艺术肖像作封面
        const coverId = entry.id === "art" ? "decorative-art-portrait" : CATEGORY_COVERS[entry.id];
        const cover = entry.templates.find((item) => item.templateId === coverId) || entry.templates[0];
        // 分类卡统一用 9:16 模板样片（含水墨），两列网格行高一致、样片不被裁
        return { id: entry.id, title: entry.title, count: entry.templates.length, cover: cover.sampleUrl, templateId: cover.templateId };
      });
      const plays = PLUGIN_PLAYS.map((id) => plugins.find((plugin) => plugin.id === id)).filter(Boolean).map(pluginSample).map((plugin) => ({
        id: plugin.id, name: plugin.name, category: plugin.category, cover: plugin.samples && plugin.samples.heroUrl || "",
        priceText: plugin.pricing && plugin.pricing.unlockPrice ? "免费预览 · ¥" + plugin.pricing.unlockPrice + " 保存" : "免费"
      }));
      // 默认预选 10 套（按分组顺序取每组前面的场景），用户只需替换不喜欢的。
      const preselected = this._allSceneIds.slice(0, 10);
      // 其他玩法：第一个 chip 是「麻麻精选」，后面是各分类，与首页瀑布流同源（评审 5.2）
      const playChips = (entries.some((entry) => entry.id === "boss") ? [{ id: "boss", label: "麻麻精选" }] : []).concat([{ id: "all", label: "全部" }], categories.map((item) => ({ id: item.id, label: item.title })));
      this.setData({ loading: false, packages, humanTemplates, humanVisible: humanTemplates, humanTags: tags, categories, plays, playChips, visibleCategories: categories, visiblePlays: plays,
        selectedSceneIds: this.data.packageMode === "all" ? this._allSceneIds.slice() : this.data.packageMode === "ten" ? preselected : [] });
      this.showSelection();
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    const mode = this.data.packageMode;
    if (mode === "all") return wx.showToast({ title: PACKAGE_COUNT.all + " 套已全部包含", icon: "none" });
    if (mode === "ten") {
      const current = this.data.selectedSceneIds.slice();
      const index = current.indexOf(id);
      if (index >= 0) current.splice(index, 1);
      else if (current.length < 10) current.push(id);
      else return wx.showToast({ title: "已选满 10 套，先取消一套再换", icon: "none" });
      if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
      this.setData({ selectedSceneIds: current });
      return this.showSelection();
    }
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(id) });
  },
  choosePackage(event) {
    const mode = event.currentTarget.dataset.mode;
    if (!PACKAGE_COUNT[mode]) return;
    const all = this._allSceneIds || [];
    const selectedSceneIds = mode === "all" ? all.slice() : mode === "ten" ? all.slice(0, 10) : [];
    this.setData({ packageMode: mode, selectedSceneIds });
    this.showSelection();
  },
  showSelection() {
    const selected = this.data.selectedSceneIds;
    const mode = this.data.packageMode;
    const pack = this.data.packages && this.data.packages[mode];
    const dockText = mode === "single" ? "点任意一套开始，" + (pack && pack.price ? pack.price + " 保存" : "满意再保存")
      : "已选 " + selected.length + " / " + PACKAGE_COUNT[mode] + (pack && pack.price ? " · " + pack.price : "");
    this.setData({
      selectedCount: selected.length,
      dockText,
      collections: (this._baseCollections || []).map((group) => Object.assign({}, group, { scenes: group.scenes.map((scene) => Object.assign({}, scene, { selected: selected.indexOf(scene.id) >= 0 })) }))
    });
  },
  startBundle() {
    const mode = this.data.packageMode;
    const count = PACKAGE_COUNT[mode];
    if (mode === "single") return wx.showToast({ title: "点一套喜欢的写真就能开始", icon: "none" });
    if (this.data.selectedSceneIds.length !== count) return wx.showToast({ title: "还差 " + (count - this.data.selectedSceneIds.length) + " 套", icon: "none" });
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
