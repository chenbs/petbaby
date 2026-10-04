const theme = require("../theme/manager");

/**
 * 自定义 TabBar（2026-09 改版）：首页 / 创作 / ＋记录 / 作品 / 我的。
 *
 * 组件不在 page 节点下，拿不到 page-meta 注入的 CSS 变量，
 * 因此必须自己订阅 ThemeManager 并把变量串写到自身根节点 style 上（需求 6.3.4）。
 *
 * 中间的「＋」不是 tab 页，而是动作：任何 Tab 都能一键收好照片（照片库记录模式）。
 * `selected` 仍是 app.json tabBar 的页序号（0–3），五个格子通过 `tab` 映射过去。
 * 图标是 scripts/build-tab-icons.js 生成的 PNG，按主题分目录（基础库 2.19.2 下 <image> 读本地 SVG 不稳）。
 */
Component({
  data: {
    selected: 0,
    themeStyle: "",
    themeId: "pet",
    animType: "fade",
    items: [
      { key: "home", pagePath: "/pages/index/index", text: "首页", tab: 0 },
      { key: "create", pagePath: "/pages/art-photo/art-photo", text: "创作", tab: 1 },
      { key: "plus", text: "记录", action: "record", tab: -1 },
      { key: "works", pagePath: "/pages/works/works", text: "作品", tab: 2 },
      { key: "me", pagePath: "/pages/me/me", text: "我的", tab: 3 }
    ]
  },
  attached() {
    this.applyTheme();
    this.unsubscribe = theme.subscribe(() => this.applyTheme());
  },
  detached() {
    if (typeof this.unsubscribe === "function") { this.unsubscribe(); this.unsubscribe = null; }
  },
  methods: {
    applyTheme() {
      const tokens = theme.getTheme();
      // 常量变量必须一起注入：它们只声明在 app.wxss 的 page{} 里，而本组件不在 page 节点下，
      // 少了这一段 --space-* / --radius-* / --shadow-* 会静默失效（无来源的 var() 不报错）。
      // 皮肤变量放最后：同名常量（圆角 / 阴影）要被皮肤覆盖。
      const style = theme.getConstantVars() + ";" + theme.getCssVars() + ";" + theme.getSkinVars();
      this.setData({ themeStyle: style, themeId: theme.getThemeId(), animType: tokens.animationType });
    },
    switchTab(event) {
      const item = this.data.items[Number(event.currentTarget.dataset.index)];
      if (!item) return;
      if (item.action === "record") {
        if (wx.vibrateShort) wx.vibrateShort({ type: "light" });
        return wx.navigateTo({ url: "/pages/photos/photos?mode=record&entry=tabbar" });
      }
      wx.switchTab({ url: item.pagePath });
    }
  }
});
