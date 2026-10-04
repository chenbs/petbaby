const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const themes = require("../theme");

function luminance(hex) {
  const channels = hex.slice(1).match(/.{2}/g).map((part) => parseInt(part, 16) / 255);
  const linear = channels.map((value) => value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(foreground, background) {
  const values = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test("四主题正文、次级文字与按钮文字达到 4.5:1", () => {
  for (const theme of themes.THEMES) {
    const tokens = theme.tokens;
    const pairs = [
      [tokens.textPrimary, tokens.background],
      [tokens.textSecondary, tokens.background],
      [tokens.textSecondary, tokens.cardBackground],
      [tokens.buttonPrimaryText, tokens.buttonPrimary],
      [tokens.buttonSecondaryText, tokens.buttonSecondary]
    ];
    for (const [foreground, background] of pairs) {
      assert.ok(contrast(foreground, background) >= 4.5, `${theme.id}: ${foreground} / ${background}`);
    }
  }
});

test("四主题共享页面与文字结构尺寸", () => {
  const keys = ["pagePadding", "sectionSpacing", "pageBottomSafe", "titleSize", "bodySize", "smallSize", "eyebrowSize", "titleLetterSpacing"];
  const baseline = themes.THEMES[0].tokens;
  for (const theme of themes.THEMES.slice(1)) {
    for (const key of keys) assert.equal(theme.tokens[key], baseline[key], `${theme.id}.${key}`);
  }
});

function themeManager(stored) {
  const storage = { petbaby_theme: stored };
  const app = { globalData: {} };
  const navigation = [];
  const module = { exports: {} };
  const wx = {
    getStorageSync(key) { return storage[key]; },
    setStorageSync(key, value) { storage[key] = value; },
    getDeviceInfo() { return { platform: "ios" }; },
    setNavigationBarColor(value) { navigation.push(value); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../theme/manager.js"), "utf8"), {
    module, require: () => themes, wx, getApp: () => app, getCurrentPages: () => [], console
  });
  return { manager: module.exports, storage, navigation, app };
}

test("旧主题偏好逐一迁移，损坏值回退并写回默认主题", () => {
  for (const [oldId, newId] of Object.entries({ cute: "pet", glass: "film", light: "brand", dark: "night", broken: "pet" })) {
    const { manager, storage, app } = themeManager(oldId);
    assert.equal(manager.init(), newId);
    assert.equal(storage.petbaby_theme, newId);
    assert.equal(app.globalData.themeId, newId);
  }
});

test("主题切换只写本机偏好并刷新导航，四主题预览用各自变量", () => {
  const { manager, storage, navigation } = themeManager("pet");
  manager.init();
  assert.equal(manager.setTheme("night"), "night");
  assert.equal(storage.petbaby_theme, "night");
  assert.equal(navigation[0].frontColor, "#ffffff");
  // 2026-09 重做：手账相册米纸底、星夜影院深紫黑底
  assert.match(manager.getCssVarsFor("film"), /--background:#F4EEE2/);
  assert.match(manager.getCssVarsFor("night"), /--background:#141218/);
  assert.equal(manager.setTheme("unknown"), "night");
});

test("访客纪念 mood 使用当前主题，仅降低动效", () => {
  const module = { exports: {} };
  const manager = {
    getThemeId: () => "night",
    getTheme: () => themes.resolveTokens("night", true),
    getCssVars: () => themes.buildCssVars("night", true),
    isBlurSupported: () => true
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../theme/page-mixin.js"), "utf8"), {
    module, require(name) { return name.endsWith("manager") ? manager : themes; }, Page: (page) => page
  });
  const page = module.exports.themedPage({ mood: "memorial" }, { data: {} });
  assert.equal(page.data.themeId, "night");
  assert.equal(page.data.animType, "fade");
  assert.equal(page.data.glow, false);
  assert.match(page.data.themeStyle, /--background:#141218/);
  // 纪念场景在任何主题下都追加 skin-quiet：关掉倾斜、贴纸、底纹和按压位移
  assert.equal(page.data.skinClass, "skin-night skin-quiet");
});

test("四套主题是独立的皮肤：结构变量彼此不同，且都不进 page-style 注入串", () => {
  const byId = Object.fromEntries(themes.THEMES.map((theme) => [theme.id, theme]));
  assert.deepEqual(themes.THEMES.map((theme) => theme.name).sort(), ["手账相册", "星夜影院", "橘子汽水", "赛博街机"].sort());
  // 形状：大圆角 / 近直角 / 切角 / 中圆角
  assert.notEqual(byId.pet.tokens.cardRadius, byId.film.tokens.cardRadius);
  assert.notEqual(byId.brand.skin["--skin-clip"], byId.pet.skin["--skin-clip"]);
  assert.ok(byId.brand.skin["--skin-clip"].startsWith("polygon("));
  // 字体气质：手账衬线、赛博等宽
  assert.match(byId.film.skin["--skin-title-font"], /serif/);
  assert.match(byId.brand.skin["--skin-num-font"], /monospace/);
  // 动效各不相同
  assert.deepEqual(themes.THEMES.map((theme) => theme.id + ":" + theme.tokens.animationType).sort(), ["brand:fade", "film:fade", "night:glow", "pet:bounce"]);
  for (const theme of themes.THEMES) {
    const injected = themes.buildCssVars(theme.id, true);
    assert.doesNotMatch(injected, /--skin-/, theme.id + " 皮肤变量不应进注入串");
    assert.ok(Buffer.byteLength(injected, "utf8") <= 2048, theme.id + " 注入串超过 2KB");
    assert.match(themes.buildSkinVars(theme.id), /--skin-texture:/);
  }
});
