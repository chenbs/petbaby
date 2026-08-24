/**
 * 主题对外出口：主题清单、token 解析、CSS 变量串生成。
 * 新增主题只需在 THEMES 追加一项，页面与组件无需改动（见需求 9.7）。
 */
const tokens = require("./tokens");

const THEMES = [require("./themes/cute"), require("./themes/glass"), require("./themes/light"), require("./themes/dark")];
const DEFAULT_THEME_ID = "cute";
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

function buildCssVars(id, blurSupported) {
  const theme = getThemeDefinition(id);
  return tokens.buildCssVars(resolveTokens(id, blurSupported), theme.id);
}

module.exports = { THEMES, DEFAULT_THEME_ID, isValidThemeId, getThemeDefinition, listThemes, resolveTokens, buildCssVars, buildConstantVars: tokens.buildConstantVars, TOKEN_KEYS: tokens.TOKEN_KEYS };
