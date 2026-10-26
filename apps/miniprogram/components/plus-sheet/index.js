/**
 * t-plus-sheet：底栏中间「＋」的动作抽屉（2026-10-26，替换系统 showActionSheet）。
 *
 * 自定义底栏渲染在底栏层，遮罩盖不住页面，所以抽屉放在每个 Tab 页里，由 custom-tab-bar 调起
 * （getCurrentPages() 顶层页面的 #plus-sheet）。页面没挂这个组件时底栏回落到系统菜单。
 */
const ACTIONS = [
  { key: "art", title: "一键出片", sub: "一张照片，拍一组宠物写真", icon: "ic-photo", segment: "pet" },
  { key: "fun", title: "搞怪玩法", sub: "身份证、电影海报、表情包", icon: "ic-magic", segment: "all" },
  { key: "records", title: "记日常", sub: "吃喝、便便、用药、疫苗驱虫", icon: "ic-note", url: "/pages/records/records" }
];

Component({
  properties: { themeId: { type: String, value: "pet" } },
  data: { visible: false, actions: ACTIONS },
  methods: {
    open() { this.setData({ visible: true }); },
    close() { this.setData({ visible: false }); },
    noop() { /* 阻止穿透 */ },
    choose(event) {
      const action = ACTIONS.find((item) => item.key === event.currentTarget.dataset.key);
      this.setData({ visible: false });
      if (!action) return;
      if (action.url) return wx.navigateTo({ url: action.url });
      const pages = getCurrentPages();
      const current = pages[pages.length - 1];
      // 已经在「创作」页时 switchTab 不会触发 onShow，直接切分段
      if (current && current.route === "pages/art-photo/art-photo" && typeof current.chooseSegment === "function") {
        return current.chooseSegment({ currentTarget: { dataset: { id: action.segment } } });
      }
      const app = getApp();
      if (app && app.globalData) app.globalData.createSegment = action.segment;
      wx.switchTab({ url: "/pages/art-photo/art-photo" });
    }
  }
});
