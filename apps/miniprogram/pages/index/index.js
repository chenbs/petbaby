const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");

/**
 * 拆出 Hero 位与网格位（UI 重构方案 A：1 大 + 2 列）。
 *
 * Hero 只给「有真实样例图」的玩法 —— A 方向的全部价值都压在这张大图上，
 * 拿一个没有出图的玩法占位会得到一块空底色，比不做 Hero 更差。
 * 全都没有样例图时 heroPlugin 为空，页面退回纯文字卡列表。
 *
 * 排序沿用后端 registry 顺序（即人工策划序）。方案要求「排序由数据驱动」，
 * 但转化数据目前只在 /api/admin/dashboard 后面、需要管理员鉴权，
 * 公开接口没有热度字段；接出来是后端改动，不在页面层任务范围内。
 */
function splitHero(plugins) {
  const list = plugins || [];
  const heroIndex = list.findIndex((item) => item.samples && item.samples.heroUrl);
  if (heroIndex < 0) return { heroPlugin: null, gridPlugins: list };
  return {
    heroPlugin: list[heroIndex],
    gridPlugins: list.filter((_, index) => index !== heroIndex)
  };
}

themedPage({
  data: {
    plugins: [], heroPlugin: null, gridPlugins: [], loading: true, error: "",
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
    this.loadOnThisDay();
  },
  onLoad() { this.load(); },
  load() {
    this.setData({ loading: true, error: "" });
    api.request("/api/plugins")
      .then((plugins) => this.setData(Object.assign({ plugins, loading: false }, splitHero(plugins))))
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
  loadPet() {
    api.request("/api/pets")
      .then((pets) => {
        const pet = (pets || []).find((item) => item.isDefault) || (pets || [])[0];
        if (!pet) return this.setData({ pet: null, milestone: "" });
        const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
        this.setData({
          pet: Object.assign({}, pet, {
            companionText: companion.companionText(pet, days),
            counts: pet.counts || { works: 0, photos: 0, memorials: 0 }
          }),
          milestone: companion.milestoneToday(pet, days)
        });
      })
      .catch(() => undefined);
  },

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
    api.request("/api/events", { method: "POST", data: { name: "plugin_selected", pluginId, channel: "miniprogram", metadata: {} } }).catch(() => undefined);
    if (category === "ai-image") return wx.navigateTo({ url: "/pages/ai-create/ai-create" });
    if (category === "interactive") return wx.navigateTo({ url: "/pages/interactive-create/interactive-create" });
    if (category === "video") return wx.navigateTo({ url: "/pages/video-create/video-create" });
    if (category === "memorial") return wx.navigateTo({ url: "/pages/memorials/memorials" });
    if (category === "report") return wx.navigateTo({ url: "/pages/commerce/commerce" });
    wx.navigateTo({ url: "/pages/create/create?pluginId=" + encodeURIComponent(pluginId) });
  },
  openTheme() { wx.navigateTo({ url: "/pages/theme/theme" }); }
});
