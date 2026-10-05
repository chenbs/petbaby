const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const { displayMediaTree } = require("../../services/photo-files");
const { manifest, pluginSample, imageEntries } = require("../../services/sample-assets");
const { HOME_COPY } = require("../../theme/home-copy");
const { CATEGORY_COVERS, BOSS_TEMPLATE_IDS, BOSS_SCENE_IDS, HUMAN_COVER_IDS, selectBossTemplates } = require("../../services/home-effect-ids");

/*
 * 首页（2026-09 改版，方案见 docs/ui-refactor/2026-09-29-产品UIUX评审/小程序产品与UIUX评审.md 6.1）。
 *
 * 原首页是 11 个同级区块，首屏只能看到宠物大图和一个全宽按钮，写真入口出现三次。
 * 改为四块，内容一个不删、只调层级：
 *   1. 宠物名片 + 今日一格（里程碑 > 去年今日 > 今日一拍提示，只显示一条，版面不跳）
 *   2. 如果我是人（第一主推）
 *   3. 麻麻精选（车窗主卡 + 精选横滑，去掉自动轮播）
 *   4. 写真馆（2026-10，原「写真也值得收藏」）：宠物写真 / 人宠写真两张入口卡 + 两种样片混排的横滑
 *   5. 挑一个玩法（分类 chip + 双列瀑布流，承接其余分类、图文 / 短片玩法与趣测）
 * 「最近收好的照片」移到时间线与照片库；记录入口在底栏中间的「＋」；主题入口在我的 › 外观。
 */

/** 瀑布流里的图文 / 短片玩法（图片模板分类之外的那部分）。 */
const PLUGIN_PLAYS = ["pet-movie-poster", "pet-time-album", "pl-19", "pl-23", "pet-id-card"];


/*
 * 瀑布流卡片的比例跟着素材走，不统一裁成 3:4（2026-10 修正）：
 * 模板样片 9:16（tall）、玩法封面 16:10（wide）、趣测 1:1（square）。
 * 容器与素材同比例，aspectFill 不会切掉宠物主体。分栏按估算高度放进较矮的一列，左右落差最小。
 */
const SHAPE_HEIGHT = { tall: 16 / 9, wide: 10 / 16, square: 1.12 };
const CARD_TEXT_HEIGHT = 0.32;

function arrangePlays(plugins) {
  const byId = Object.fromEntries((plugins || []).map((item) => [item.id, item]));
  return PLUGIN_PLAYS.map((id) => byId[id]).filter(Boolean).map((plugin) => ({
    key: "plugin-" + plugin.id, kind: "plugin", id: plugin.id, category: plugin.category, chip: "all", shape: "wide",
    title: plugin.name, cover: plugin.samples && plugin.samples.heroUrl || "",
    tag: plugin.id === "pet-movie-poster" ? "新" : "", tagTone: 2,
    note: plugin.pricing && plugin.pricing.unlockPrice ? "免费预览 · ¥" + plugin.pricing.unlockPrice + " 保存" : "免费制作"
  }));
}

function money(value) { return typeof value === "number" ? "¥" + value : ""; }

/** 「写真也值得收藏」右侧的起价：取套餐里最低的总价，不在端上写死。 */
function artPriceText(packages) {
  const list = packages ? Object.keys(packages).map((key) => packages[key]).filter((item) => item && typeof item.amount === "number") : [];
  if (!list.length) return "36 套 · 去写真馆";
  const total = Math.max.apply(null, list.map((item) => item.count || 0)) || 24;
  return total + " 套 · " + money(Math.min.apply(null, list.map((item) => item.amount))) + " 起";
}

themedPage({
  data: {
    plugins: [], loading: true, error: "",
    humanTemplateCount: 0, humanCovers: [],
    bossCoverUrl: "", bossTemplates: [], bossScenes: [], duoCovers: [], duoGroupCount: 0, studioStrip: [], bossLead: null, bossNote: "", artPriceText: "36 套 · 去写真馆", copy: HOME_COPY,
    chips: [{ id: "all", label: "全部" }], chip: "all", feed: [], feedLeft: [], feedRight: [],
    introSampleUrl: manifest.plugins["pl-10"],
    pet: null, petDisplayUrl: "", pets: [], petLoading: true, recordError: "",
    /** 今日一格：{ eyebrow, title, action, kind }。没有命中时给默认的今日一拍提示。 */
    moment: null
  },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 0 });
    api.request("/api/events", { method: "POST", data: { name: "visited", channel: "miniprogram", metadata: {} } }).catch(() => undefined);
    // 情绪区块在 onShow 里刷：用户建档 / 传照片回来后首屏应跟着变。玩法列表在 onLoad。
    this.loadPet();
  },
  onLoad() { this.load(); },
  load() {
    this.setData({ loading: true, error: "" });
    Promise.all([
      api.request("/api/plugins"),
      api.request("/api/image-templates").catch(() => ({ entries: [] })),
      // 麻麻精选由后台配置；接口不可用时回落到端上内置的默认清单。
      api.request("/api/home-curation").catch(() => null),
      api.request("/api/art-photo-bundles/packages").catch(() => null)
    ]).then((result) => {
      const curation = result[2] && result[2].lead ? result[2] : null;
      const plugins = (result[0] || []).map(pluginSample);
      const entries = imageEntries(result[1] && Array.isArray(result[1].entries) ? result[1].entries : []);
      const byId = {};
      entries.forEach((entry) => entry.templates.forEach((template) => { byId[template.templateId] = Object.assign({ entryId: entry.id }, template); }));

      const humanEntry = entries.find((entry) => entry.id === "human");
      const humanCovers = HUMAN_COVER_IDS.map((id) => byId[id]).filter((template) => template && template.sampleUrl);

      const leadId = curation ? curation.lead.templateId : BOSS_TEMPLATE_IDS[0];
      const bossTemplateIds = curation ? [leadId].concat(curation.templateIds) : BOSS_TEMPLATE_IDS;
      const selectedBossTemplates = selectBossTemplates(entries, bossTemplateIds);
      const bossCover = selectedBossTemplates.find((item) => item.templateId === leadId);
      const bossTemplates = selectedBossTemplates.filter((item) => item.templateId !== leadId).map((item, index) => Object.assign({}, item, { level: String(index + 1).padStart(2, "0") }));
      const artPlugin = plugins.find((item) => item.id === "pl-10");
      const samples = artPlugin && artPlugin.samples || {};
      const bossScenes = (curation ? curation.sceneIds : BOSS_SCENE_IDS).map((id) => {
        const scene = (samples.sceneOptions || []).find((item) => item.id === id);
        return scene && { id, title: scene.title, sampleUrl: samples.sceneUrls && samples.sceneUrls[id] || "", hdUrl: samples.sceneHdUrls && samples.sceneHdUrls[id] || "" };
      }).filter(Boolean);

      // 人宠写真：每组取第一个镜头作封面（同一组是同一场拍摄的两个镜头）
      const duoEntry = entries.find((entry) => entry.id === "duo");
      const duoCovers = [];
      (duoEntry ? duoEntry.templates : []).forEach((template) => {
        const groupId = template.groupId || template.templateId;
        if (template.sampleUrl && !duoCovers.some((item) => item.groupId === groupId)) duoCovers.push(Object.assign({ groupId }, template, { title: template.groupTitle || template.title }));
      });
      // 写真馆横滑：宠物写真与人宠写真交替排，两种都能一眼看到
      const studioStrip = [];
      for (let index = 0; index < Math.max(bossScenes.length, duoCovers.length); index += 1) {
        if (bossScenes[index]) studioStrip.push({ key: "scene-" + bossScenes[index].id, kind: "scene", id: bossScenes[index].id, title: bossScenes[index].title, sampleUrl: bossScenes[index].sampleUrl });
        if (duoCovers[index]) studioStrip.push({ key: "duo-" + duoCovers[index].templateId, kind: "duo", id: duoCovers[index].templateId, title: duoCovers[index].title, sampleUrl: duoCovers[index].sampleUrl });
      }

      // 瀑布流：每个图片模板分类一张封面卡 + 图文 / 短片玩法 + 趣测卡。人宠写真在写真馆里，不在瀑布流重复。
      const categories = entries.filter((entry) => ["boss", "human", "duo"].indexOf(entry.id) < 0 && entry.templates.length);
      const categoryCards = categories.map((entry, index) => {
        const cover = byId[CATEGORY_COVERS[entry.id]] || entry.templates[0];
        const artInk = entry.id === "art" && byId["ink-portrait"];
        const inkCover = artInk && manifest.covers && manifest.covers["ink-portrait"];
        return {
          key: "entry-" + entry.id, kind: "template", chip: entry.id, entryId: entry.id,
          templateId: artInk ? artInk.templateId : cover.templateId,
          title: artInk ? "黑白水墨肖像" : entry.title,
          // 水墨封面是专门做的 16:10 横图，其余用 9:16 模板样片
          cover: artInk ? inkCover || artInk.sampleUrl : cover.sampleUrl,
          shape: inkCover || cover.sampleShape === "wide" ? "wide" : "tall",
          tag: index === 0 ? "热门" : entry.id === "together" ? "主人 + 宠物" : "", tagTone: index === 0 ? 1 : 2,
          note: entry.templates.length + " 款 · 免费预览 · 满意再保存"
        };
      });
      const funCard = { key: "fun-tests", kind: "fun", chip: "all", shape: "square", tag: "免费", tagTone: 1, title: "我的隐藏性格", cover: "/assets/fun-tests/personality.jpg", note: "免费趣测 · 10 题" };
      const feed = categoryCards.concat(arrangePlays(plugins)).concat([funCard]);
      const chips = [{ id: "all", label: "全部" }].concat(categories.map((entry) => ({ id: entry.id, label: entry.title })));
      /*
       * 选了分类 chip 时展开这一类的全部模板（2026-10）：原先只剩一张分类封面卡，像是没加载完。
       * 写真模板（pet-art-photo）走写真馆，不在这里重复。
       */
      this._chipCards = Object.fromEntries(categories.map((entry) => [entry.id, entry.templates
        .filter((template) => template.templateId !== "pet-art-photo")
        .map((template) => ({
          key: "tpl-" + template.templateId, kind: "template", chip: entry.id, entryId: entry.id, templateId: template.templateId,
          title: template.title, cover: template.sampleUrl, shape: template.sampleShape === "wide" ? "wide" : "tall",
          tag: entry.id === "together" ? "主人 + 宠物" : "", tagTone: 2, note: "免费预览 · 满意再保存"
        }))]));

      this.setData({
        plugins, loading: false,
        humanTemplateCount: humanEntry ? humanEntry.templates.length : 0, humanCovers,
        bossCoverUrl: bossCover ? bossCover.sampleUrl : "", bossTemplates, bossScenes, duoCovers, duoGroupCount: duoCovers.length, studioStrip,
        bossLead: { templateId: leadId, title: curation ? curation.lead.title : "车窗风中写真", subtitle: curation ? curation.lead.subtitle : "风吹起来的这一刻，也值得留下" },
        // 运营没改过说明时按主题给一句；改过就以后台为准
        bossNote: curation && curation.note && curation.note !== "每周更新" ? curation.note : "",
        artPriceText: artPriceText(result[3]),
        chips, feed
      });
      this.layoutFeed();
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  chooseChip(event) {
    this.setData({ chip: event.currentTarget.dataset.id || "all" });
    this.layoutFeed();
  },
  /** 双列瀑布流：按估算高度放进较矮的一列；选「全部」看分类封面，选分类看这一类的全部模板，不跳页。 */
  layoutFeed() {
    const chip = this.data.chip;
    const expanded = chip !== "all" && this._chipCards && this._chipCards[chip];
    const visible = expanded && expanded.length ? expanded : this.data.feed.filter((item) => chip === "all" || item.chip === chip);
    const left = [], right = [];
    let leftHeight = 0, rightHeight = 0;
    visible.forEach((item) => {
      const height = (SHAPE_HEIGHT[item.shape] || SHAPE_HEIGHT.tall) + CARD_TEXT_HEIGHT;
      if (leftHeight <= rightHeight) { left.push(item); leftHeight += height; }
      else { right.push(item); rightHeight += height; }
    });
    this.setData({ feedLeft: left, feedRight: right });
  },

  /**
   * 默认宠物 + 陪伴天数 + 今日一格。
   *
   * **失败静默**：这是首屏的情绪区块，拉不到就不显示，不能挡住下面的玩法。
   * 天数一律走 `services/companion.js`：纪念阶段要按 memorialSince 封口。
   */
  async loadPet() {
    const view = this._view = (this._view || 0) + 1;
    const session = wx.getStorageSync("petbaby_session");
    if (session !== this._accountSession) this._petId = "";
    this._accountSession = session;
    this.setData({ petLoading: true, recordError: "", moment: null });
    try {
      const pets = await api.request("/api/pets").then(displayMediaTree);
      if (view !== this._view) return;
      const pet = this._petId ? pets.find((item) => item.id === this._petId) : pets.find((item) => item.isDefault) || pets[0];
      this.setData({ pets });
      if (this._petId && !pet) throw new Error("所选档案不可用，请重新选择宠物");
      if (!pet) return this.setData({ pet: null, petDisplayUrl: "", petLoading: false });
      this._petId = pet.id;
      const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
      const memorial = pet.lifeStage === "memorial";
      const milestone = memorial ? "" : companion.milestoneToday(pet, days);
      this.setData({
        pet: Object.assign({}, pet, {
          companionText: companion.companionText(pet, days), days: days || 0, photoCount: pet.counts && pet.counts.photos || 0,
          // 名片大号数字：纪念宠物只有封口日时才给数字，且用过去式；没有截止日就只显示文案
          daysNumber: memorial && !pet.memorialSince ? 0 : days || 0,
          daysPrefix: memorial ? "陪伴了 " : "",
          serial: String(days || 0).padStart(4, "0")
        }),
        petDisplayUrl: pet.avatarUrl || "", petLoading: false,
        moment: milestone ? { kind: "milestone", eyebrow: "今天", title: milestone, action: "回看 ›" } : this.defaultMoment(pet)
      });
      const result = await Promise.all([
        pet.avatarUrl ? Promise.resolve({ items: [] }) : api.request("/api/photos?petId=" + pet.id + "&pageSize=1&order=uploaded").then(displayMediaTree),
        api.request("/api/on-this-day?petId=" + pet.id).then(displayMediaTree).catch(() => ({ matches: [] }))
      ]);
      if (view !== this._view) return;
      const cover = (result[0].items || []).find((item) => item.url);
      const first = (result[1].matches || [])[0];
      const patch = {};
      if (!pet.avatarUrl && cover) patch.petDisplayUrl = cover.url;
      if (first && !milestone) {
        const more = Math.max(0, (result[1].matches || []).length - 1);
        patch.moment = { kind: "on-this-day", eyebrow: first.yearsAgo === 1 ? "去年今日" : first.yearsAgo + " 年前的今天", title: first.petName + "的第 " + first.day + " 天" + (more ? "，还有 " + more + " 张" : ""), action: "回看 ›", petId: first.petId };
      }
      this.setData(patch);
    } catch (error) { if (view === this._view) this.setData({ petLoading: false, recordError: error.message }); }
  },
  defaultMoment(pet) {
    if (pet.lifeStage === "memorial") return { kind: "record", eyebrow: "今天", title: "想我的时候，就回来看看", action: "看看 ›" };
    return pet.counts && pet.counts.photos
      ? { kind: "record", eyebrow: "今日一拍", title: "今天也给" + pet.name + "拍一张吧", action: "去拍 ›" }
      : { kind: "record", eyebrow: "从第一张开始", title: "先收好一张" + pet.name + "的照片", action: "去收 ›" };
  },
  openMoment() {
    const moment = this.data.moment;
    if (!moment) return;
    if (moment.kind === "record") return this.record();
    this.openTimeline(moment.petId);
  },
  choosePet(event) { const pet = this.data.pets[Number(event.detail.value)]; if (pet) { this._petId = pet.id; this.loadPet(); } },
  onImageError(event) {
    const { kind, id, src } = event.currentTarget.dataset;
    if (kind === "pet" && this.data.petDisplayUrl === src) this.setData({ petDisplayUrl: "" });
    if (kind === "human") {
      const index = this.data.humanCovers.findIndex((item) => item.templateId === id && item.sampleUrl === src);
      if (index >= 0) this.setData({ ["humanCovers[" + index + "].sampleUrl"]: "" });
    }
    if (kind === "feed") {
      const index = this.data.feed.findIndex((item) => item.key === id);
      if (index >= 0) { this.setData({ ["feed[" + index + "].cover"]: "" }); this.layoutFeed(); }
    }
  },
  record() { wx.navigateTo({ url: "/pages/photos/photos?mode=record&entry=index" + (this.data.pet ? "&petId=" + this.data.pet.id : "") }); },
  onHide() { this._view = (this._view || 0) + 1; },

  openTimeline(petId) {
    const id = typeof petId === "string" && petId ? petId : this.data.pet && this.data.pet.id;
    if (!id) return;
    // petId 必带：不带的话点非默认宠物会看到错的那只（见 CLAUDE.md）。
    wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(id) });
  },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },
  petQuery(prefix) { return this.data.pet ? prefix + "petId=" + encodeURIComponent(this.data.pet.id) : ""; },

  openFeed(event) {
    const key = event.currentTarget.dataset.id;
    const item = this.data.feed.concat(this.data.feedLeft, this.data.feedRight).find((entry) => entry.key === key);
    if (!item) return;
    if (item.kind === "fun") return wx.navigateTo({ url: "/pages/fun-tests/fun-tests" });
    if (item.kind === "template") return this.startTemplate({ currentTarget: { dataset: { entry: item.entryId, template: item.templateId } } });
    this.start({ currentTarget: { dataset: { id: item.id, category: item.category } } });
  },
  start(event) {
    const pluginId = event.currentTarget.dataset.id;
    const category = event.currentTarget.dataset.category;
    api.request("/api/events", { method: "POST", data: { name: "plugin_selected", pluginId, channel: "miniprogram", metadata: {} } }).catch(() => undefined);
    if (pluginId === "pl-10") return wx.switchTab({ url: "/pages/art-photo/art-photo" });
    if (category === "ai-image") return wx.navigateTo({ url: "/pages/ai-create/ai-create" + this.petQuery("?") });
    if (category === "video") return wx.navigateTo({ url: "/pages/video-create/video-create" + this.petQuery("?") });
    if (category === "memorial") return wx.navigateTo({ url: "/pages/memorials/memorials" });
    if (category === "report") return wx.navigateTo({ url: "/pages/commerce/commerce" });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + encodeURIComponent(pluginId) + this.petQuery("&") });
  },
  startTemplate(event) {
    const entryId = event.currentTarget.dataset.entry;
    const templateId = event.currentTarget.dataset.template;
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=" + encodeURIComponent(entryId) + "&templateId=" + encodeURIComponent(templateId) + this.petQuery("&") });
  },
  /** 点人化封面直达那一款；点标题区进 40 款造型页。 */
  openHuman(event) {
    const templateId = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=human" + (templateId ? "&templateId=" + encodeURIComponent(templateId) : "") + this.petQuery("&") });
  },
  startBossScene(event) {
    const sceneId = event.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(sceneId) + this.petQuery("&") });
  },
  /** 写真馆入口卡：switchTab 不能带参数，用 globalData 告诉创作页打开「宠物写真」还是「人宠写真」。 */
  openArtStudio(event) {
    const mode = event && event.currentTarget && event.currentTarget.dataset && event.currentTarget.dataset.mode;
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) app.globalData.artMode = mode === "duo" ? "duo" : "pet";
    wx.switchTab({ url: "/pages/art-photo/art-photo" });
  },
  openStudioItem(event) {
    const { kind, id } = event.currentTarget.dataset;
    if (kind === "duo") return this.startTemplate({ currentTarget: { dataset: { entry: "duo", template: id } } });
    this.startBossScene({ currentTarget: { dataset: { id } } });
  },
  /** 「全部 ›」：创作是 tab 页，switchTab 不能带参数，用 globalData 告诉它打开「其他玩法」分段。 */
  openAllPlays() {
    const app = typeof getApp === "function" ? getApp() : null;
    if (app && app.globalData) app.globalData.createSegment = "all";
    wx.switchTab({ url: "/pages/art-photo/art-photo" });
  },
  onShareAppMessage() { return { title: "给你家的毛孩子也拍一组照片吧", path: "/pages/index/index" }; },
  onShareTimeline() { return { title: "麻麻抱我 · 宠物照片创作与陪伴记录" }; }
});
