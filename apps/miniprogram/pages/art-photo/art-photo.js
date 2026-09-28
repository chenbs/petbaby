const api = require("../../services/api");
const { themedPage } = require("../../theme/page-mixin");
const { pluginSample } = require("../../services/sample-assets");

const collections = [
  { id: "everyday", title: "柔软日常", subtitle: "光线里最熟悉的它", ids: ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon"] },
  { id: "outside", title: "去看世界", subtitle: "每一步都像故事开场", ids: ["seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset"] },
  { id: "story", title: "奇妙时刻", subtitle: "为它留一帧特别的画面", ids: ["night-playful", "snow-cabin", "city-rain", "spring-picnic"] },
  { id: "journey", title: "出发去玩", subtitle: "和金毛一起探索新风景", ids: ["railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday"] },
  { id: "little-days", title: "小小职业与日常", subtitle: "泰迪的可爱主场", ids: ["berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day"] },
  { id: "cat-story", title: "英短的故事片", subtitle: "安静也有主角光", ids: ["museum-curator", "poolside-vacation", "post-office", "ballet-backstage"] }
];

themedPage({
  data: { collections: [], loading: true, error: "" },
  onLoad() { this.load(); },
  onShow() {
    const tabbar = this.getTabBar && this.getTabBar();
    if (tabbar) tabbar.setData({ selected: 1 });
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
      this.setData({ collections: groups, loading: false });
    }).catch((error) => this.setData({ error: error.message, loading: false }));
  },
  chooseScene(event) {
    const id = event.currentTarget.dataset.id;
    wx.navigateTo({ url: "/pages/ai-create/ai-create?entryId=art&templateId=pet-art-photo&sceneId=" + encodeURIComponent(id) });
  },
  onSceneImageError(event) {
    const id = event.currentTarget.dataset.id;
    const groups = this.data.collections.map((group) => Object.assign({}, group, {
      scenes: group.scenes.map((scene) => scene.id === id ? Object.assign({}, scene, { url: "" }) : scene)
    }));
    this.setData({ collections: groups });
  }
});
