const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const manager = require("../../theme/manager");

themedPage({
  data: { profile: null, status: null, hero: null, loading: true, themeName: "" },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 2 });
    // 当前主题名展示在入口行右侧，让用户不进二级页也知道用的是哪套
    const current = manager.listThemes().find((item) => item.id === manager.getThemeId());
    this.setData({ themeName: current ? current.name : "" });
    Promise.all([api.request("/api/account"), api.request("/api/account/status")])
      .then((result) => this.setData({ profile: result[0], status: result[1], loading: false }))
      .catch(() => this.setData({ loading: false }));
    this.loadHero();
  },
  /**
   * 方案 E：个人中心先给「对象」，再给功能。取默认宠物作为顶部区块，
   * 展示陪伴天数与统计条 —— 用户第一眼看到的是自己的宠物，不是货架。
   *
   * 单独一条请求、失败静默：这是锦上添花的区块，
   * 不该因为它拉不到就挡住额度和入口列表这些真正的功能。
   */
  loadHero() {
    api.request("/api/pets")
      .then((pets) => {
        const pet = (pets || []).find((item) => item.isDefault) || (pets || [])[0];
        if (!pet) return this.setData({ hero: null });
        const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
        this.setData({
          hero: Object.assign({}, pet, {
            counts: pet.counts || { works: 0, photos: 0, memorials: 0 },
            companionDays: days,
            // 文案与「无固定截止日则不给数字」的判断都在 companion 里，三页共用
            companionText: companion.companionText(pet, days)
          })
        });
      })
      .catch(() => undefined);
  },
  openOrders() { wx.navigateTo({ url: "/pages/orders/orders" }); },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },
  openPhotos() { wx.navigateTo({ url: "/pages/photos/photos" }); },
  openHealth() { wx.navigateTo({ url: "/pages/health/health" }); },
  openAccount() { wx.navigateTo({ url: "/pages/account/account" }); },
  /*
   * 原「AI、互动与视频」二级页（pages/growth）已删除（改造项 X2）。
   *
   * 那一页的全部内容是 `/api/plugins` 的子集筛选，而首页已按 category 分流
   * （index.js 的 start()），它存在的唯一理由是首页曾经放不下。
   *
   * **必须用 switchTab 而不是 navigateTo**：首页是 tabBar 页，
   * navigateTo 对 tabBar 目标会直接失败且不报错到界面上 —— 表现是点了没反应。
   */
  openGrowth() { wx.switchTab({ url: "/pages/index/index" }); },
  /**
   * 宠物小岛。分包页面，路径以 `/island/` 开头（分包 root）。
   *
   * **不加第四个 tab**（22 号文 5.2）：tabBar 页面必须在主包内，主包余量不足 700KB。
   * 所以入口只能是这一行 + 宠物档案的操作行。
   */
  openIsland() { wx.navigateTo({ url: "/island/index/index" }); },
  openMemorials() { wx.navigateTo({ url: "/pages/memorials/memorials" }); },
  openCommerce() { wx.navigateTo({ url: "/pages/commerce/commerce" }); },
  openLogin() { wx.navigateTo({ url: "/pages/login/login" }); },
  openTheme() { wx.navigateTo({ url: "/pages/theme/theme" }); }
});
