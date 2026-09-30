const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const { displayMediaTree } = require("../../services/photo-files");
const { manifest, pluginSample, imageEntries } = require("../../services/sample-assets");
const { CATEGORY_COVERS, BOSS_TEMPLATE_IDS, BOSS_SCENE_IDS, HUMAN_COVER_IDS, selectBossTemplates } = require("../../services/home-effect-ids");

function arrangePlays(plugins) {
  const byId = Object.fromEntries((plugins || []).map((item) => [item.id, item]));
  return {
    carouselPlugins: ["pet-time-album", "pet-movie-poster"].map((id) => byId[id]).filter(Boolean),
    gridPlugins: ["pl-10", "pl-19", "pl-23", "pet-id-card"].map((id) => byId[id]).filter(Boolean)
  };
}

themedPage({
  data: {
    plugins: [], carouselPlugins: [], carouselIndex: 0, gridPlugins: [], featuredTemplates: [], bossTemplates: [], bossScenes: [], bossCoverUrl: "", humanTemplateCount: 0, humanCovers: [], loading: true, error: "",
    introSampleUrl: manifest.plugins["pl-10"],
    /*
     * 首屏的「对象」区块（改造项 E1）。
     *
     * 20 号文 2.2 的判断：情绪价值不是内容问题而是**分发问题** ——
     * 服务端 8 项情绪能力全建成，而端上入口缺失或单端的有 6 项，
     * 原首页全文 0 处出现宠物或陪伴字样，用户打开的动机只剩「做张图」。
     *
     * 所以第一屏先给默认宠物（封面 + 陪伴天数），玩法货架下移。
     * 这是全批唯一改变「用户打开时先看到谁」的改动。
     */
    pet: null,
    petDisplayUrl: "",
    pets: [], petLoading: true, recordError: "", recent: [], recordAction: "开始记录",
    /** 今天刚达成的里程碑（E3）。只在当天出现一次，不是常驻标签 */
    milestone: "",
    /** 去年今日（E4）。命中才有，没命中整块静默隐藏 */
    onThisDay: null,
    onThisDayMore: 0
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 0 });
    api.request("/api/events", { method: "POST", data: { name: "visited", channel: "miniprogram", metadata: {} } }).catch(() => undefined);
    /*
     * 情绪区块在 onShow 而不是 onLoad 里刷：用户去建了档案 / 传了照片再回来，
     * 首屏应该跟着变。玩法列表放在 onLoad —— 它不会因为用户的操作而变。
     */
    this.loadPet();
  },
  onLoad() { this.load(); },
  load() {
    this.setData({ loading: true, error: "" });
    Promise.all([
      api.request("/api/plugins"),
      api.request("/api/image-templates").catch(() => ({ entries: [] }))
    ])
      .then((result) => {
        const plugins = (result[0] || []).map(pluginSample);
        const entries = imageEntries(result[1] && result[1].entries);
        const byId = {};
        entries.forEach((entry) => entry.templates.forEach((template) => { byId[template.templateId] = Object.assign({ entryId: entry.id }, template); }));
        const featuredTemplates = entries.filter((entry) => entry.id !== "boss" && entry.id !== "human" && entry.templates.length).map((entry) => {
          const cover = byId[CATEGORY_COVERS[entry.id]] || entry.templates[0];
          const artInk = entry.id === "art" && byId["ink-portrait"];
          return { entryId: entry.id, title: artInk ? "黑白水墨肖像" : entry.title,
            templateId: artInk ? artInk.templateId : cover.templateId,
            sampleUrl: artInk ? (manifest.covers && manifest.covers["ink-portrait"]) || artInk.sampleUrl : cover.sampleUrl,
            sampleShape: artInk ? "wide" : cover.sampleShape };
        });
        const selectedBossTemplates = selectBossTemplates(entries);
        const humanEntry = entries.find((entry) => entry.id === "human");
        const humanCovers = HUMAN_COVER_IDS.map((id) => byId[id]).filter((template) => template && template.sampleUrl);
        const bossCover = selectedBossTemplates.find((item) => item.templateId === BOSS_TEMPLATE_IDS[0]);
        const bossTemplates = selectedBossTemplates.filter((item) => item.templateId !== BOSS_TEMPLATE_IDS[0]);
        const artPlugin = plugins.find((item) => item.id === "pl-10");
        const samples = artPlugin && artPlugin.samples || {};
        const bossScenes = BOSS_SCENE_IDS.map((id) => {
          const scene = (samples.sceneOptions || []).find((item) => item.id === id);
          return scene && { id, title: scene.title, sampleUrl: samples.sceneUrls && samples.sceneUrls[id] || "" };
        }).filter(Boolean);
        this.setData(Object.assign({ plugins, featuredTemplates, bossTemplates, bossScenes, humanTemplateCount: humanEntry ? humanEntry.templates.length : 0, humanCovers, carouselIndex: 0,
          bossCoverUrl: bossCover ? bossCover.sampleUrl : "", loading: false }, arrangePlays(plugins)));
      })
      .catch((error) => this.setData({ error: error.message, loading: false }));
  },

  /**
   * 默认宠物 + 陪伴天数。
   *
   * **失败静默**：这是首屏的情绪区块，拉不到就不显示，不能挡住下面的玩法货架 ——
   * 那是产品的主功能。同 pages/me 的 loadHero 口径。
   *
   * 天数一律走 `services/companion.js`，不在这里重算：纪念阶段要按
   * memorialSince 封口，而那个判断（含「没有截止日就不给数字」）只在那里有。
   */
  async loadPet() {
    const view = this._view = (this._view || 0) + 1;
    const session = wx.getStorageSync("petbaby_session");
    if (session !== this._accountSession) this._petId = "";
    this._accountSession = session;
    this.setData({ petLoading: true, recordError: "", pet: null, petDisplayUrl: "", recent: [], onThisDay: null, milestone: "" });
    try {
      const pets = await api.request("/api/pets").then(displayMediaTree);
      if (view !== this._view) return;
      const pet = this._petId ? pets.find((item) => item.id === this._petId) : pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets });
      if (this._petId && !pet) throw new Error("所选档案不可用，请重新选择宠物");
      if (!pet) return this.setData({ petLoading: false, recordAction: "开始记录" });
      this._petId = pet.id;
      const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
      this.setData({ pet: Object.assign({}, pet, { companionText: companion.companionText(pet, days) }), petDisplayUrl: pet.avatarUrl || "", petLoading: false,
        recordAction: pet.lifeStage === "memorial" ? "收好照片" : pet.counts && pet.counts.photos ? "记录今天" : "收好第一张照片",
        milestone: pet.lifeStage === "memorial" ? "" : companion.milestoneToday(pet, days) });
      const result = await Promise.all([
        api.request("/api/photos?petId=" + pet.id + "&pageSize=3&order=uploaded").then(displayMediaTree),
        api.request("/api/on-this-day?petId=" + pet.id).then(displayMediaTree)
      ]);
      if (view !== this._view) return;
      const first = (result[1].matches || [])[0];
      const source = { manual: "你设置的日期", exif: "照片里的拍摄时间", upload: "按上传时间记录" };
      const recent = result[0].items.map((item) => Object.assign({}, item, { savedOn: item.createdAt.slice(0, 10), sourceText: source[item.memoryDateSource] }));
      this.setData({ recent, petDisplayUrl: this.data.pet.avatarUrl || (recent.find((item) => item.url) || {}).url || "",
        onThisDay: first ? Object.assign({}, first, { eyebrow: first.yearsAgo === 1 ? "去年今日" : first.yearsAgo + " 年前的今天" }) : null,
        onThisDayMore: Math.max(0, (result[1].matches || []).length - 1) });
    } catch (error) { if (view === this._view) this.setData({ petLoading: false, recordError: error.message }); }
  },
  choosePet(event) { const pet = this.data.pets[Number(event.detail.value)]; if (pet) { this._petId = pet.id; this.loadPet(); } },
  onImageError(event) {
    const { kind, id, src } = event.currentTarget.dataset;
    if (kind === "pet" && this.data.petDisplayUrl === src) {
      const patch = { petDisplayUrl: "" };
      if (this.data.pet && this.data.pet.avatarUrl === src) patch["pet.avatarUrl"] = "";
      const index = this.data.recent.findIndex((item) => item.url === src);
      if (index >= 0) patch["recent[" + index + "].url"] = "";
      patch.petDisplayUrl = (this.data.recent.find((item) => item.url && item.url !== src) || {}).url || "";
      this.setData(patch);
    }
    if (kind === "recent") {
      const index = this.data.recent.findIndex((item) => item.id === id && item.url === src);
      if (index >= 0) this.setData({ ["recent[" + index + "].url"]: "", ["recent[" + index + "].imageError"]: "照片暂时无法显示" });
    }
    if (kind === "on-this-day" && this.data.onThisDay && this.data.onThisDay.photo.url === src) this.setData({ "onThisDay.photo.url": "" });
    if (kind === "grid") {
      const index = this.data.gridPlugins.findIndex((item) => item.id === id && item.samples.heroUrl === src);
      if (index >= 0) this.setData({ ["gridPlugins[" + index + "].samples.heroUrl"]: "" });
    }
    if (kind === "carousel") {
      const index = this.data.carouselPlugins.findIndex((item) => item.id === id && item.samples.heroUrl === src);
      if (index >= 0) this.setData({ ["carouselPlugins[" + index + "].samples.heroUrl"]: "" });
    }
    if (kind === "human") {
      const index = this.data.humanCovers.findIndex((item) => item.templateId === id && item.sampleUrl === src);
      if (index >= 0) this.setData({ ["humanCovers[" + index + "].sampleUrl"]: "" });
    }
  },
  onCarouselChange(event) { this.setData({ carouselIndex: event.detail.current }); },
  chooseCarousel(event) { this.setData({ carouselIndex: Number(event.currentTarget.dataset.index) }); },
  record() { wx.navigateTo({ url: "/pages/photos/photos?mode=record&entry=index" + (this.data.pet ? "&petId=" + this.data.pet.id : "") }); },
  recentDetail(event) { if (this.data.pet) wx.navigateTo({ url: "/pages/photos/photos?petId=" + this.data.pet.id + "&photoId=" + event.currentTarget.dataset.id }); },
  onHide() { this._view = (this._view || 0) + 1; },

  /**
   * 去年今日（E4）。Web 首页早有这一块，小程序没有 —— 而小程序是主端。
   *
   * **命中才显示，没命中静默隐藏**：不渲染「今天没有回忆」，
   * 那是在提醒用户产品没内容。硬凑出来的回忆是产品的表演。
   */
  loadOnThisDay() {
    api.request("/api/on-this-day")
      .then((result) => {
        // 接口在 E2 后返回 { matches, pushConsented }，授权状态这里用不上。
        const matches = (result && result.matches) || [];
        const first = matches[0];
        if (!first) return this.setData({ onThisDay: null, onThisDayMore: 0 });
        this.setData({
          onThisDay: Object.assign({}, first, {
            // 1 才说「去年今日」，2 以上说「N 年前的今天」——「去年」是个具体的词。
            eyebrow: first.yearsAgo === 1 ? "去年今日" : first.yearsAgo + " 年前的今天"
          }),
          onThisDayMore: matches.length - 1
        });
      })
      .catch(() => undefined);
  },

  openTimeline() {
    const pet = this.data.pet;
    if (!pet) return;
    // petId 必带：不带的话点非默认宠物会看到错的那只（见 CLAUDE.md）。
    wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(pet.id) });
  },
  openOnThisDay() {
    const hit = this.data.onThisDay;
    if (!hit) return;
    wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(hit.petId) });
  },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },

  start(event) {
    const pluginId = event.currentTarget.dataset.id;
    const category = event.currentTarget.dataset.category;
    const petQuery = this.data.pet ? "?petId=" + encodeURIComponent(this.data.pet.id) : "";
    api.request("/api/events", { method: "POST", data: { name: "plugin_selected", pluginId, channel: "miniprogram", metadata: {} } }).catch(() => undefined);
    if (pluginId === "pl-10") return wx.switchTab({ url: "/pages/art-photo/art-photo" });
    if (category === "ai-image") return wx.navigateTo({ url: "/pages/ai-create/ai-create" + petQuery });
    if (category === "interactive") return wx.navigateTo({ url: "/pages/interactive-create/interactive-create" + petQuery });
    if (category === "video") return wx.navigateTo({ url: "/pages/video-create/video-create" + petQuery });
    if (category === "memorial") return wx.navigateTo({ url: "/pages/memorials/memorials" });
    if (category === "report") return wx.navigateTo({ url: "/pages/commerce/commerce" });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + encodeURIComponent(pluginId) + (this.data.pet ? "&petId=" + this.data.pet.id : "") });
  },
  startTemplate(event) {
    const entryId = event.currentTarget.dataset.entry;
    const templateId = event.currentTarget.dataset.template;
    const petQuery = this.data.pet ? "&petId=" + encodeURIComponent(this.data.pet.id) : "";
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=" + encodeURIComponent(entryId) + "&templateId=" + encodeURIComponent(templateId) + petQuery });
  },
  openHuman() {
    const petQuery = this.data.pet ? "&petId=" + encodeURIComponent(this.data.pet.id) : "";
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=human" + petQuery });
  },
  startBossScene(event) {
    const sceneId = event.currentTarget.dataset.id;
    const petQuery = this.data.pet ? "&petId=" + encodeURIComponent(this.data.pet.id) : "";
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(sceneId) + petQuery });
  },
  openFunTests() { wx.navigateTo({ url: "/pages/fun-tests/fun-tests" }); },
  openTheme() { wx.navigateTo({ url: "/pages/theme/theme" }); }
});
