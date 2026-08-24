const theme = require("../theme/manager");

/**
 * 自定义 TabBar。组件不在 page 节点下，拿不到 page-meta 注入的 CSS 变量，
 * 因此必须自己订阅 ThemeManager 并把变量串写到自身根节点 style 上（需求 6.3.4）。
 */
Component({
  data: {
    selected: 0,
    themeStyle: "",
    themeId: "cute",
    animType: "fade",
    items: [
      { pagePath: "/pages/index/index", text: "玩法", glyph: "✦" },
      { pagePath: "/pages/works/works", text: "作品", glyph: "◈" },
      { pagePath: "/pages/me/me", text: "我的", glyph: "◉" }
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
      const style = theme.getConstantVars() + ";" + theme.getCssVars();
      this.setData({ themeStyle: style, themeId: theme.getThemeId(), animType: tokens.animationType });
    },
    switchTab(event) {
      const index = event.currentTarget.dataset.index;
      wx.switchTab({ url: this.data.items[index].pagePath });
    }
  }
});
