const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample } = require("../../services/sample-assets");

const collections = [
  { id: "everyday", title: "柔软日常", subtitle: "光线里最熟悉的我", ids: ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon"] },
  { id: "outside", title: "去看世界", subtitle: "每一步都像故事开场", ids: ["seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset"] },
  { id: "story", title: "奇妙时刻", subtitle: "为我留一帧特别的画面", ids: ["night-playful", "snow-cabin", "city-rain", "spring-picnic"] },
  { id: "journey", title: "出发去玩", subtitle: "和金毛一起探索新风景", ids: ["railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday"] },
  { id: "little-days", title: "小小职业与日常", subtitle: "泰迪的可爱主场", ids: ["berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day"] },
  { id: "cat-story", title: "英短的故事片", subtitle: "安静也有主角光", ids: ["museum-curator", "poolside-vacation", "post-office", "ballet-backstage"] }
];

themedPage({
  data: { collections: [], loading: true, error: "", packageMode: "single", singlePriceText: "", selectedSceneIds: [], selectedCount: 0, recentBatches: [] },
  onLoad() { this.load(); },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 1 });
    this.loadRecentBatches();
  },
  loadRecentBatches() {
    api.request("/api/art-photo-bundles").then((items) => this.setData({ recentBatches: (items || []).slice(0, 3).map((item) => Object.assign({}, item, { statusText: item.orderStatus === "pending" ? "待付款" : item.status === "completed" ? "已完成" : item.status === "partial" ? "部分完成" : item.status === "failed" ? "生成失败" : item.status === "cancelled" ? "已取消" : "制作中" })) })).catch(() => undefined);
  },
  load() {
    this.setData({ loading: true, error: "" });
    api.request("/api/plugins").then((plugins) => {
      const source = (plugins || []).find((item) => item.id === "pl-10");
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
      this.showSelection();
      this.setData({ loading: false, singlePriceText: "¥" + source.pricing.unlockPrice });
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    if (this.data.packageMode === "all") return;
    if (this.data.packageMode === "ten") {
      const current = this.data.selectedSceneIds.slice();
      const index = current.indexOf(id);
      if (index >= 0) current.splice(index, 1);
      else if (current.length < 10) current.push(id);
      else return wx.showToast({ title: "最多选择 10 套", icon: "none" });
      this.setData({ selectedSceneIds: current, selectedCount: current.length });
      return this.showSelection();
    }
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(id) });
  },
  choosePackage(event) {
    const mode = event.currentTarget.dataset.mode;
    if (["single", "ten", "all"].indexOf(mode) < 0) return;
    const selectedSceneIds = mode === "all" ? (this._baseCollections || []).reduce((all, group) => all.concat(group.scenes.map((scene) => scene.id)), []) : [];
    this.setData({ packageMode: mode, selectedSceneIds, selectedCount: selectedSceneIds.length });
    this.showSelection();
  },
  showSelection() {
    const selected = this.data.selectedSceneIds;
    this.setData({ collections: (this._baseCollections || []).map((group) => Object.assign({}, group, { scenes: group.scenes.map((scene) => Object.assign({}, scene, { selected: selected.indexOf(scene.id) >= 0 })) })) });
  },
  startBundle() {
    const mode = this.data.packageMode;
    const count = mode === "ten" ? 10 : mode === "all" ? 24 : 0;
    if (!count || this.data.selectedSceneIds.length !== count) return wx.showToast({ title: "请先选满 " + count + " 套写真", icon: "none" });
    const scenes = this.data.selectedSceneIds.join(",");
    wx.navigateTo({ url: "/pages/art-photo-bundle/art-photo-bundle?package=" + mode + "&sceneIds=" + encodeURIComponent(scenes) });
  },
  openBatch(event) { wx.navigateTo({ url: "/pages/art-photo-result/art-photo-result?id=" + encodeURIComponent(event.currentTarget.dataset.id) }); },
  onSceneImageError(event) {
    const id = event.currentTarget.dataset.id;
    const groups = this.data.collections.map((group) => Object.assign({}, group, {
      scenes: group.scenes.map((scene) => scene.id === id ? Object.assign({}, scene, { url: "" }) : scene)
    }));
    this.setData({ collections: groups });
  }
});
