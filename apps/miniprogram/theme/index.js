/**
 * 主题对外出口：主题清单、token 解析、CSS 变量串生成。
 * 新增主题只需在 THEMES 追加一项，页面与组件无需改动（见需求 9.7）。
 */
const tokens = require("./tokens");

const THEMES = [require("./themes/pet"), require("./themes/film"), require("./themes/brand"), require("./themes/night")];
const DEFAULT_THEME_ID = "pet";
const INDEX = {};
for (const theme of THEMES) INDEX[theme.id] = theme;

function isValidThemeId(id) { return typeof id === "string" && Boolean(INDEX[id]); }

function getThemeDefinition(id) { return INDEX[isValidThemeId(id) ? id : DEFAULT_THEME_ID]; }

/** 4 项元信息，供主题选择页与 `listThemes()` 使用。 */
function listThemes() {
  return THEMES.map((theme) => ({ id: theme.id, name: theme.name, description: theme.description, preview: theme.preview.slice() }));
}

/**
 * 解析出最终 token：先做完整性校验（缺键回落默认主题同名键），再按需应用降级取值。
 * @param {string} id 主题 id
 * @param {boolean} blurSupported backdrop-filter 是否可用
 */
function resolveTokens(id, blurSupported) {
  const theme = getThemeDefinition(id);
  const fallback = INDEX[DEFAULT_THEME_ID].tokens;
  const problems = tokens.validateTokens(theme.id, theme.tokens);
  if (problems.length) console.error("[theme] token 校验失败：\n" + problems.join("\n"));
  const resolved = {};
  for (const key of tokens.TOKEN_KEYS) resolved[key] = key in theme.tokens ? theme.tokens[key] : fallback[key];
  if (blurSupported === false && theme.degrade) Object.assign(resolved, theme.degrade);
  return resolved;
}

/**
 * 皮肤层（2026-09）：各主题的结构差异（材质、形状、装饰、底纹、字体气质）。
 *
 * 不进 page-style 注入串（注入串有 2KB 门禁）：页面由 app.wxss 的 `.skin-<id>{}` 按根节点类名提供，
 * 这里的 JS 串只给渲染在页面树之外的自定义 tabbar 用。validate 第 11 项比对两处逐字一致。
 */
function buildSkinVars(id) {
  const skin = getThemeDefinition(id).skin || {};
  return Object.keys(skin).map((name) => `${name}:${skin[name]}`).join(";");
}

function buildCssVars(id, blurSupported) {
  const theme = getThemeDefinition(id);
  return tokens.buildCssVars(resolveTokens(id, blurSupported), theme.id);
}

module.exports = { THEMES, DEFAULT_THEME_ID, isValidThemeId, getThemeDefinition, listThemes, resolveTokens, buildCssVars, buildSkinVars, buildConstantVars: tokens.buildConstantVars, TOKEN_KEYS: tokens.TOKEN_KEYS };
