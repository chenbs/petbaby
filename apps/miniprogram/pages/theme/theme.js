const { themedPage } = require("../../theme/page-mixin");
const manager = require("../../theme/manager");

/**
 * 主题选择页。每张预览卡用「该主题自己的 token」渲染，而不是当前主题（需求 6.2）。
 * 切换即时生效、无需重启、不发网络请求。
 */
themedPage({
  data: { themes: [], previews: [], applied: "" },
  onLoad() { this.build(); },
  build() {
    const current = manager.getThemeId();
    const previews = manager.listThemes().map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      style: manager.getCssVarsFor(item.id),
      active: item.id === current
    }));
    this.setData({ themes: manager.listThemes(), previews, applied: current });
  },
  choose(event) {
    const id = event.currentTarget.dataset.id;
    if (id === manager.getThemeId()) return;
    manager.setTheme(id);
    this.build();
    wx.showToast({ title: "已切换主题", icon: "none" });
  }
});
