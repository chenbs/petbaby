/**
 * 页面主题混入。页面业务代码不写任何主题逻辑，只需用 themedPage() 包一层。
 *
 * 用法：
 *   themedPage({ ...pageOptions })                       普通页面
 *   themedPage({ mood: "memorial" }, { ...pageOptions }) 纪念场景，动效强制 fade、禁用装饰（需求 9.5）
 *   themedPage({ fixedTheme: "cute" }, { ... })          分享落地页，固定默认主题（需求 9.4）
 *   themedPage({ immersive: true }, { ... })             沉浸式页面，跳过导航栏同步（见 theme-2.md 5.4）
 *
 * 注入的 data：themeStyle / themeId / navBg / navFront / animType / glow / decor / blurOk
 */
const manager = require("./manager");
const themes = require("./index");

function buildThemeData(options) {
  const fixed = options.fixedTheme;
  const id = fixed || manager.getThemeId();
  const tokens = fixed ? manager.getThemeTokens(fixed) : manager.getTheme();
  const memorial = options.mood === "memorial";
  return {
    themeStyle: fixed ? manager.getCssVarsFor(fixed) : manager.getCssVars(),
    themeId: id,
    navBg: tokens.navBarBackground,
    navFront: tokens.navBarTextStyle === "white" ? "#ffffff" : "#000000",
    animType: memorial ? "fade" : tokens.animationType,
    glow: memorial ? false : tokens.glowAnimation,
    decor: !memorial && id === "cute",
    blurOk: manager.isBlurSupported()
  };
}

function themedPage(optionsOrPage, maybePage) {
  const options = maybePage ? optionsOrPage || {} : {};
  const page = maybePage || optionsOrPage || {};
  const originalLoad = page.onLoad;
  const originalShow = page.onShow;
  const originalUnload = page.onUnload;

  page.data = Object.assign({}, page.data, buildThemeData(options));

  page.__applyTheme = function () { this.setData(buildThemeData(options)); };

  page.onLoad = function (query) {
    this.__themeUnsubscribe = manager.subscribe(() => this.__applyTheme());
    this.__applyTheme();
    if (typeof originalLoad === "function") originalLoad.call(this, query);
  };

  page.onShow = function () {
    // 导航栏走 wx.setNavigationBarColor 而非 <navigation-bar> 组件：
    // 后者需基础库 2.29.2，与需求 8.4 的 2.9.0 下限冲突（见 docs/demand/theme.md 差异记录）。
    // 每次 onShow 同步一次，覆盖「从固定主题的分享页返回」这类跨主题跳转。
    // immersive 页面用 navigationStyle: "custom"，此时该调用无效，直接跳过；
    // 返回上级时由上级页面自身的 onShow 恢复导航栏。
    if (!options.immersive) manager.syncNavigationBar(options.fixedTheme);
    this.__applyTheme();
    if (typeof originalShow === "function") originalShow.call(this);
  };

  page.onUnload = function () {
    if (typeof this.__themeUnsubscribe === "function") { this.__themeUnsubscribe(); this.__themeUnsubscribe = null; }
    if (typeof originalUnload === "function") originalUnload.call(this);
  };

  return Page(page);
}

module.exports = { themedPage, buildThemeData, DEFAULT_THEME_ID: themes.DEFAULT_THEME_ID };
