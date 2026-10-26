const wallet = require("../../services/wallet");
const { displayMediaTree } = require("../../services/photo-files");
const api = require("../../services/api");
const companion = require("../../services/companion");
const { themedPage } = require("../../theme/page-mixin");
const manager = require("../../theme/manager");

/*
 * 我的（2026-09 改版；2026-10 按 prototype.html after-me 对齐）。
 *
 * 入口按用途分三组，每行一个图标块 + 名称 + 右侧信息（照片张数、当前外观）。
 * 图标是 scripts/build-tab-icons.js 生成的每主题 PNG，图标块底色走 token，不在 WXSS 里写死色值。
 */
const ENTRY_URLS = {
  photos: "/pages/photos/photos",
  health: "/pages/health/health",
  records: "/pages/records/records",
  memorials: "/pages/memorials/memorials",
  wallet: "/pages/wallet/wallet",
  invite: "/pages/invite/invite",
  orders: "/pages/orders/orders",
  commerce: "/pages/commerce/commerce",
  theme: "/pages/theme/theme",
  account: "/pages/account/account",
  login: "/pages/login/login"
};

themedPage({
  data: { profile: null, status: null, hero: null, pets: [], hasMemorialPet: false, loading: true, error: "", themeName: "", displayName: "微信用户", groups: [], walletBalance: null, notices: [], noticeUnread: 0, noticeMore: 0, noticesExpanded: false },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 3 });
    // 当前主题名展示在「外观」行右侧，让用户不进二级页也知道用的是哪套
    const current = manager.listThemes().find((item) => item.id === manager.getThemeId());
    this.setData({ themeName: current ? current.name : "" });
    this.buildGroups();
    this.loadAccount();
    wallet.getWallet().then((balance) => { this.setData({ walletBalance: balance.balance }); this.buildGroups(); }).catch(() => undefined);
    this.loadHero();
  },
  /**
   * 账户与额度。切回这个 tab 时沿用上次的数据原地刷新，不再整页清成骨架屏（2026-10-26：切 tab 慢的主要观感来源）。
   * 只有首次进入（还没有数据）才显示骨架。
   */
  loadAccount() {
    this.setData({ loading: !this.data.profile, error: "" });
    Promise.all([api.request("/api/account"), api.request("/api/account/status")])
      .then((result) => {
        this.setData({ profile: result[0], status: result[1], displayName: result[0] && result[0].displayName || "微信用户", loading: false });
        this.buildNotices();
      })
      .catch((error) => this.setData({ loading: false, error: error.message || "账户资料加载失败" }));
  },
  /**
   * 通知（2026-10-26）：默认只摆未读的前 3 条，其余收起；没有未读时整块不出现，铃铛也不亮。
   * 服务端仍下发最近 20 条（含已读），「查看全部」在本页展开，不另开页面。
   */
  buildNotices() {
    const all = (this.data.status && this.data.status.notifications) || [];
    const unread = all.filter((item) => !item.read_at);
    const expanded = this.data.noticesExpanded;
    this.setData({
      notices: expanded ? all : unread.slice(0, 3),
      noticeUnread: unread.length,
      noticeMore: expanded ? 0 : all.length - Math.min(3, unread.length)
    });
  },
  toggleNotices() {
    this.setData({ noticesExpanded: !this.data.noticesExpanded });
    this.buildNotices();
  },
  /** 三组入口。纪念空间只在有 senior / memorial 宠物时出现，与宠物档案页的规则一致。 */
  buildGroups() {
    const hero = this.data.hero;
    const record = [
      { key: "photos", name: "照片库", icon: "ic-photo", tone: "warm", side: hero && hero.counts ? hero.counts.photos + " 张" : "" },
      { key: "timeline", name: "成长时间线", icon: "ic-book", tone: "sun", sub: "去年今日也在这里" },
      { key: "records", name: "日常记录", icon: "ic-note", tone: "warm", sub: "吃喝、便便、用药、疫苗驱虫" },
      { key: "health", name: "健康助手", icon: "ic-cross", tone: "mint", sub: "说说症状，看看宝贝怎么了" }
    ];
    if (this.data.hasMemorialPet) record.push({ key: "memorials", name: "纪念空间", icon: "ic-heart", tone: "plain", sub: "把一起的日子安静地收好" });
    this.setData({
      groups: [
        { title: "记录与照顾", items: record },
        { title: "钱包与订单", items: [
          { key: "wallet", name: "冻干钱包", icon: "fd-coin", tone: "plain", side: this.data.walletBalance === null ? "" : this.data.walletBalance + " 颗" },
          { key: "invite", name: "邀请好友", icon: "ic-share", tone: "warm", sub: "好友建好档案，你得冻干" },
          { key: "orders", name: "订单与退款", icon: "ic-bag", tone: "plain" },
          { key: "commerce", name: "年度报告", icon: "ic-book", tone: "plain" }
        ] },
        { title: "设置", items: [
          { key: "theme", name: "外观", icon: "ic-gear", tone: "plain", side: this.data.themeName },
          { key: "account", name: "账户与隐私", icon: "ic-lock", tone: "plain", sub: "昵称、法务文档与账号注销" },
          { key: "login", name: "登录与退出", icon: "ic-user", tone: "plain" }
        ] }
      ]
    });
  },
  onHeroImageError(event) {
    const hero = this.data.hero;
    const src = event.currentTarget.dataset.src;
    if (!hero || hero.imageUrl !== src) return;
    const patch = { "hero.imageUrl": hero.fallbackUrl && hero.fallbackUrl !== src ? hero.fallbackUrl : "" };
    if (hero.avatarUrl === src) patch["hero.avatarUrl"] = "";
    this.setData(patch);
  },
  /**
   * 默认宠物给统计条和头像。单独一条请求、失败静默：
   * 这是锦上添花的区块，不该因为它拉不到就挡住额度和入口列表这些真正的功能。
   */
  loadHero() {
    const view = this._heroView = (this._heroView || 0) + 1;
    return api.request("/api/pets").then(displayMediaTree)
      .then((pets) => {
        if (view !== this._heroView) return;
        const pet = (pets || []).find((item) => item.isDefault) || (pets || [])[0];
        this.setData({ hasMemorialPet: (pets || []).some((item) => item.lifeStage === "senior" || item.lifeStage === "memorial"), pets: (pets || []).map((item) => ({ id: item.id, name: item.name, avatarUrl: item.avatarUrl || "", isDefault: item.id === (pet && pet.id), lifeStage: item.lifeStage })) });
        if (!pet) { this.setData({ hero: null }); return this.buildGroups(); }
        const days = companion.daysSince(companion.anchorOf(pet), pet.memorialSince);
        this.setData({
          hero: Object.assign({}, pet, {
            counts: pet.counts || { works: 0, photos: 0, memorials: 0 },
            imageUrl: pet.avatarUrl || "",
            fallbackUrl: "",
            companionDays: days,
            // 文案与「无固定截止日则不给数字」的判断都在 companion 里，三页共用
            companionText: companion.companionText(pet, days)
          })
        });
        this.buildGroups();
        if (!pet.counts || !pet.counts.photos) return;
        return api.request("/api/photos?petId=" + encodeURIComponent(pet.id) + "&pageSize=1&order=uploaded")
          .then(displayMediaTree)
          .then((result) => {
            if (view !== this._heroView || !this.data.hero || this.data.hero.id !== pet.id) return;
            const first = (result.items || []).find((item) => item.url);
            const fallbackUrl = first ? first.url : "";
            this.setData({ "hero.fallbackUrl": fallbackUrl, "hero.imageUrl": this.data.hero.imageUrl || fallbackUrl });
          });
      })
      .catch(() => undefined);
  },
  openEntry(event) {
    const key = event.currentTarget.dataset.key;
    if (key === "timeline") return this.openTimeline();
    // 日常记录与健康助手带上默认宠物（已离开的不带，由页面自己选一只在世的）
    const hero = this.data.hero;
    if ((key === "records" || key === "health") && hero && hero.lifeStage !== "memorial") return wx.navigateTo({ url: ENTRY_URLS[key] + "?petId=" + encodeURIComponent(hero.id) });
    if (ENTRY_URLS[key]) wx.navigateTo({ url: ENTRY_URLS[key] });
  },
  /** 铃铛：有通知时滚到通知区，没有就提示一句。 */
  openNotifications() {
    if (!this.data.status || !this.data.status.notifications.length) return wx.showToast({ title: "暂时没有新通知", icon: "none" });
    if (!this.data.notices.length) { this.setData({ noticesExpanded: true }); this.buildNotices(); }
    wx.pageScrollTo({ selector: "#me-notices", duration: 200 });
  },
  openPet(event) { const id = event.currentTarget.dataset.id; wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(id) }); },
  copyShortId() {
    const id = this.data.profile && this.data.profile.shortId;
    if (id) wx.setClipboardData({ data: id, success: () => wx.showToast({ title: "已复制，联系客服时报这个号", icon: "none" }) });
  },
  openTimeline() { if (this.data.hero) wx.navigateTo({ url: "/pages/timeline/timeline?petId=" + encodeURIComponent(this.data.hero.id) }); else this.openPets(); },
  /**
   * 点通知跳到对应页面，并记为已读。
   * 小程序路径（/pages/...）直接打开；历史通知存的是 Web 路径（/works/{id}、/create/{pluginId}），这里映射到对应小程序页。
   */
  openNotification(event) {
    const { id, path } = event.currentTarget.dataset;
    if (id) {
      api.request("/api/notifications/" + id, { method: "POST", data: {} }).catch(() => undefined);
      // 本地先记为已读，回到这页时这条就不再占位
      const list = (this.data.status && this.data.status.notifications) || [];
      const index = list.findIndex((item) => item.id === id);
      if (index >= 0 && !list[index].read_at) { this.setData({ ["status.notifications[" + index + "].read_at"]: new Date().toISOString() }); this.buildNotices(); }
    }
    const target = String(path || "");
    const work = /^\/works\/([0-9a-f-]{36})$/.exec(target);
    const create = /^\/create\/([^/?]+)/.exec(target);
    const url = target.indexOf("/pages/") === 0 ? target : work ? "/pages/work/work?id=" + work[1] : create ? "/pages/create/create?pluginId=" + encodeURIComponent(create[1]) : "";
    if (!url) return;
    if (url.indexOf("/pages/works/works") === 0 || url.indexOf("/pages/index/index") === 0 || url.indexOf("/pages/me/me") === 0) return wx.switchTab({ url: url.split("?")[0] });
    wx.navigateTo({ url });
  },
  openPets() { wx.navigateTo({ url: "/pages/pets/pets" }); },
  openCommerce() { wx.navigateTo({ url: "/pages/commerce/commerce" }); }
});
