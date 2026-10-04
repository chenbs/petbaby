const { themedPage } = require("../../theme/page-mixin");
const manager = require("../../theme/manager");
const { manifest } = require("../../services/sample-assets");

/**
 * 主题选择页（2026-10 按 themes.html 第 3 节）。
 *
 * 每张预览卡渲染一份迷你首页，卡片根节点挂「该主题」的 token 串（需求 6.2）和 skin 类，
 * 所以看到的是那套主题的真实观感，而不是共用照片加几条色块。
 * 素材全部用包内图片：切换即时生效、无需重启、不发网络请求。
 */
const SAMPLE_COVERS = ["fish-chase", "pet-milk-tea-shopkeeper", "animal-sword-cat-alt"].map((id) => manifest.templates[id]).filter(Boolean);
const FEED_COVERS = [manifest.templates["pet-wanted-poster"], manifest.scenes["window-morning"]].filter(Boolean);

themedPage({
  data: { previews: [], sampleCovers: SAMPLE_COVERS, feedCovers: FEED_COVERS },
  onLoad() { this.build(); },
  build() {
    const current = manager.getThemeId();
    this.setData({
      previews: manager.listThemes().map((item) => ({
        id: item.id,
        name: item.name,
        description: item.description,
        style: manager.getCssVarsFor(item.id),
        skin: "skin-" + item.id,
        active: item.id === current
      }))
    });
  },
  choose(event) {
    const id = event.currentTarget.dataset.id;
    if (id === manager.getThemeId()) return;
    manager.setTheme(id);
    this.build();
    wx.showToast({ title: "已切换主题", icon: "none" });
  }
});
