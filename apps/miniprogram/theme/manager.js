/**
 * ThemeManager 单例：读取 / 切换 / 持久化 / 广播主题。
 * 切换只走内存 + 缓存 + 订阅广播，不产生任何网络请求（需求 12.4）。
 */
const themes = require("./index");

const STORAGE_KEY = "petbaby_theme";
const BLUR_OVERRIDE_KEY = "petbaby_theme_blur_override";

let currentId = themes.DEFAULT_THEME_ID;
let blurSupported = true;
let initialized = false;
const listeners = [];

/**
 * 探测 backdrop-filter 支持度。小程序无法直接查询 CSS 支持，按平台与基础库版本推断：
 * iOS / 开发者工具 / 桌面端一律支持；Android 需基础库 2.10+ 且系统版本 >= 10。
 * 结果缓存在内存，不逐帧检测（需求 4.2 降级要求）。
 */
function detectBlurSupport() {
  const override = wx.getStorageSync(BLUR_OVERRIDE_KEY);
  if (override === "on") return true;
  if (override === "off") return false;
  let info = {};
  try { info = (wx.getDeviceInfo ? wx.getDeviceInfo() : wx.getSystemInfoSync()) || {}; } catch (error) { return true; }
  const platform = String(info.platform || "").toLowerCase();
  if (platform !== "android") return true;
  const system = parseFloat(String(info.system || "").replace(/[^\d.]/g, "")) || 0;
  let sdk = 0;
  try { sdk = parseFloat(String((wx.getAppBaseInfo ? wx.getAppBaseInfo() : wx.getSystemInfoSync()).SDKVersion || "").split(".").slice(0, 2).join(".")) || 0; } catch (error) { sdk = 0; }
  return system >= 10 && sdk >= 2.1;
}

function readStoredId() {
  let stored = "";
  try { stored = wx.getStorageSync(STORAGE_KEY); } catch (error) { stored = ""; }
  if (themes.isValidThemeId(stored)) return stored;
  try { wx.setStorageSync(STORAGE_KEY, themes.DEFAULT_THEME_ID); } catch (error) { /* 缓存不可写时仅退回默认 */ }
  return themes.DEFAULT_THEME_ID;
}

function applyNavigationBar(id) {
  const tokens = themes.resolveTokens(id, blurSupported);
  wx.setNavigationBarColor({
    backgroundColor: tokens.navBarBackground,
    frontColor: tokens.navBarTextStyle === "white" ? "#ffffff" : "#000000",
    animation: { duration: 0 },
    fail: () => undefined
  });
}

/** 通知全部订阅者 + 直接刷新页面栈内的每个实例，返回上级页面时不残留旧主题（需求 6.3.3）。 */
function broadcast() {
  const payload = { themeId: currentId, tokens: themes.resolveTokens(currentId, blurSupported), cssVars: manager.getCssVars(), blurSupported };
  for (const listener of listeners.slice()) {
    try { listener(payload); } catch (error) { console.error("[theme] 订阅回调异常", error); }
  }
  const pages = typeof getCurrentPages === "function" ? getCurrentPages() || [] : [];
  for (const page of pages) {
    if (page && typeof page.__applyTheme === "function") {
      try { page.__applyTheme(payload); } catch (error) { console.error("[theme] 页面刷新异常", error); }
    }
  }
}

const manager = {
  /** `app.onLaunch` 调用：读缓存 → 校验 → 落 globalData → 探测模糊支持度。 */
  init() {
    if (initialized) return currentId;
    blurSupported = detectBlurSupport();
    currentId = readStoredId();
    initialized = true;
    const app = typeof getApp === "function" ? getApp({ allowDefault: true }) : null;
    if (app) {
      app.globalData = app.globalData || {};
      app.globalData.themeId = currentId;
    }
    return currentId;
  },

  getThemeId() { return currentId; },
  getTheme() { return themes.resolveTokens(currentId, blurSupported); },
  getCssVars() { return themes.buildCssVars(currentId, blurSupported); },

  /** 常量变量串：只有渲染在页面视图树之外的自定义 tabbar 需要，页面由 app.wxss 提供。 */
  getConstantVars() { return themes.buildConstantVars(); },
  listThemes() { return themes.listThemes(); },
  isBlurSupported() { return blurSupported; },

  /** 任意主题的 token / 变量串，供主题选择页用各自 token 渲染预览卡。 */
  getThemeTokens(id) { return themes.resolveTokens(id, blurSupported); },
  getCssVarsFor(id) { return themes.buildCssVars(id, blurSupported); },

  /** 切换主题：校验 → 内存 → 缓存 → 导航栏 → 广播。非法 id 忽略并告警。 */
  setTheme(id) {
    if (!themes.isValidThemeId(id)) { console.warn("[theme] 忽略非法主题 id：" + id); return currentId; }
    if (id === currentId) return currentId;
    currentId = id;
    try { wx.setStorageSync(STORAGE_KEY, id); } catch (error) { console.warn("[theme] 主题偏好写入缓存失败"); }
    const app = typeof getApp === "function" ? getApp({ allowDefault: true }) : null;
    if (app && app.globalData) app.globalData.themeId = id;
    applyNavigationBar(id);
    broadcast();
    return currentId;
  },

  /** 注册变更回调，返回取消订阅函数。 */
  subscribe(fn) {
    if (typeof fn !== "function") return () => undefined;
    listeners.push(fn);
    return () => { const index = listeners.indexOf(fn); if (index >= 0) listeners.splice(index, 1); };
  },

  /** 供固定主题页面（分享落地页）显式同步导航栏。 */
  syncNavigationBar(id) { applyNavigationBar(themes.isValidThemeId(id) ? id : currentId); },

  STORAGE_KEY
};

module.exports = manager;
