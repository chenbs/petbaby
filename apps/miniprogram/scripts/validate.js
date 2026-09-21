const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const failures = [];

function collectPages(config) {
  const pages = [...(config.pages || [])];
  for (const group of config.subPackages || config.subpackages || []) {
    const groupRoot = String(group.root || "").replace(/^\/+|\/+$/g, "");
    for (const page of group.pages || []) pages.push(groupRoot ? `${groupRoot}/${page}` : page);
  }
  return pages;
}
const allPages = collectPages(app);

// 1. 每页 4 个文件齐备
for (const page of allPages) {
  for (const extension of ["js", "json", "wxml", "wxss"]) {
    const target = path.join(root, `${page}.${extension}`);
    if (!fs.existsSync(target)) failures.push(`Missing ${path.relative(root, target)}`);
  }
}

// 2. 全部 JSON 可解析
for (const file of fs.readdirSync(root, { recursive: true }).filter((name) => String(name).endsWith(".json"))) {
  const target = path.join(root, String(file));
  if (target.includes(`${path.sep}node_modules${path.sep}`)) continue;
  try { JSON.parse(fs.readFileSync(target, "utf8")); } catch (error) { failures.push(`Invalid JSON ${path.relative(root, target)}: ${error.message}`); }
}

// 3. 颜色与字面量硬编码扫描（app.wxss 是唯一豁免文件，用于 var() 兜底）
const COLOR_KEYWORDS = ["white", "black", "red", "green", "blue", "yellow", "orange", "pink", "purple", "gray", "grey", "silver", "gold", "brown", "cyan", "magenta", "violet", "navy", "teal", "olive", "maroon", "lime", "aqua", "fuchsia", "beige", "ivory", "coral", "salmon", "khaki", "indigo", "tan", "azure", "crimson", "plum", "orchid", "wheat", "linen", "snow", "thistle", "tomato", "turquoise"];
const HARDCODE_RULES = [
  { name: "十六进制颜色", pattern: /#[0-9a-fA-F]{3,8}\b/ },
  { name: "rgb()/rgba() 字面量", pattern: /\brgba?\s*\(/ },
  { name: "颜色关键字", pattern: new RegExp(`(?::|\\s)(?:${COLOR_KEYWORDS.join("|")})\\s*(?:;|$|!)`, "i") }
];
// 纯结构值：0、百分比、完全胶囊、视口单位、inherit 等不受 token 约束
const STRUCTURAL_VALUE = /^(0|0rpx|0px|100%|50%|999rpx|inherit|auto|none|transparent|unset|initial|env\(safe-area-inset-bottom\))$/;
const TOKEN_PROPERTIES = ["border-radius", "box-shadow", "font-size", "padding", "margin", "gap", "letter-spacing", "row-gap", "column-gap"];


function scanWxss(file) {
  const relative = path.relative(root, file).split(path.sep).join("/");
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const code = line.replace(/\/\*.*?\*\//g, "");
    for (const rule of HARDCODE_RULES) {
      const match = code.match(rule.pattern);
      if (match) failures.push(`硬编码颜色 ${relative}:${index + 1}: ${rule.name} → ${match[0].trim()}`);
    }
    // 字面量圆角/阴影/间距/字号：属性值里既无 var() 也非纯结构值即报错
    for (const declaration of code.split(";")) {
      const parts = declaration.split(":");
      if (parts.length < 2) continue;
      const property = parts[0].trim().replace(/^.*\{/, "").trim();
      const value = parts.slice(1).join(":").trim().replace(/\}.*$/, "").trim();
      if (!value || TOKEN_PROPERTIES.indexOf(property) < 0) continue;
      if (value.indexOf("var(") >= 0 || value.indexOf("calc(") >= 0) continue;
      if (value.split(/\s+/).every((part) => STRUCTURAL_VALUE.test(part))) continue;
      failures.push(`字面量样式值 ${relative}:${index + 1}: ${property}: ${value}（必须走 token）`);
    }
  });
}

function collectWxss(directory) {
  const entries = fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : [];
  for (const entry of entries) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") collectWxss(target); }
    else if (entry.name.endsWith(".wxss") && target !== path.join(root, "app.wxss")) scanWxss(target);
  }
}
collectWxss(root);

// 4. Token 完整性：逐主题比对 tokens.js 的键名清单
const tokens = require("../theme/tokens");
const themeIndex = require("../theme/index");
for (const theme of themeIndex.THEMES) {
  for (const problem of tokens.validateTokens(theme.id, theme.tokens)) failures.push(`Token 校验 ${problem}`);
}

// 5. 对比度校验：半透明色按其在对应背景上的合成结果计算
function parseColor(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.split("").map((char) => char + char).join("");
    const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: alpha };
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    return { r: parseFloat(parts[0]), g: parseFloat(parts[1]), b: parseFloat(parts[2]), a: parts.length > 3 ? parseFloat(parts[3]) : 1 };
  }
  // 渐变：取第一个色标作为对比度基准（页面底渐变的极值端）
  const stop = text.match(/#[0-9a-fA-F]{3,8}|rgba?\([^)]*\)/);
  return stop ? parseColor(stop[0]) : null;
}

function composite(foreground, background) {
  if (!foreground || !background) return foreground;
  if (foreground.a >= 1) return foreground;
  const base = background.a >= 1 ? background : { r: background.r, g: background.g, b: background.b, a: 1 };
  return {
    r: foreground.r * foreground.a + base.r * (1 - foreground.a),
    g: foreground.g * foreground.a + base.g * (1 - foreground.a),
    b: foreground.b * foreground.a + base.b * (1 - foreground.a),
    a: 1
  };
}

function luminance(color) {
  const channel = (value) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : Math.pow((ratio + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
}

function contrast(foreground, background, page) {
  const backdrop = composite(parseColor(background), parseColor(page));
  const front = composite(parseColor(foreground), backdrop);
  if (!front || !backdrop) return 0;
  const first = luminance(front);
  const second = luminance(backdrop);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

const CONTRAST_CHECKS = [
  { label: "textPrimary / background", foreground: "textPrimary", background: "background", min: 4.5 },
  { label: "textPrimary / cardBackground", foreground: "textPrimary", background: "cardBackground", min: 4.5 },
  { label: "buttonPrimaryText / buttonPrimary", foreground: "buttonPrimaryText", background: "buttonPrimary", min: 4.5 },
  { label: "textSecondary / background", foreground: "textSecondary", background: "background", min: 3 }
];

for (const theme of themeIndex.THEMES) {
  const variants = [{ suffix: "", values: theme.tokens }];
  if (theme.degrade) variants.push({ suffix: "降级", values: Object.assign({}, theme.tokens, theme.degrade) });
  for (const variant of variants) {
    for (const check of CONTRAST_CHECKS) {
      const ratio = contrast(variant.values[check.foreground], variant.values[check.background], variant.values.background);
      if (ratio < check.min) failures.push(`对比度不足 ${theme.id}${variant.suffix ? "(" + variant.suffix + ")" : ""}: ${check.label} = ${ratio.toFixed(2)}:1，要求 ≥ ${check.min}:1`);
    }
  }
}

// 6. 玻璃面板文字对比度：作品底图内容不可预知，故取纯白与纯黑两种极端逐档校验（需求 theme-2.md 11.2）
const GLASS_LEVELS = [
  { id: "half", scrim: (max) => max, panelOpacity: 1 },
  { id: "collapsed", scrim: () => 0, panelOpacity: 0.92 }
];
const BASE_IMAGES = ["#FFFFFF", "#000000"];

/** 把 rgba/hex 颜色的 alpha 再乘一个系数，用于表达收起档面板整体降透明。 */
function scaleAlpha(color, factor) {
  const parsed = parseColor(color);
  if (!parsed) return parsed;
  return { r: parsed.r, g: parsed.g, b: parsed.b, a: parsed.a * factor };
}

function ratioOf(foreground, backdrop) {
  const front = composite(parseColor(foreground), backdrop);
  if (!front || !backdrop) return 0;
  const first = luminance(front);
  const second = luminance(backdrop);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

for (const theme of themeIndex.THEMES) {
  const variants = [{ suffix: "", values: theme.tokens }];
  if (theme.degrade) variants.push({ suffix: "降级", values: Object.assign({}, theme.tokens, theme.degrade) });
  for (const variant of variants) {
    for (const level of GLASS_LEVELS) {
      for (const base of BASE_IMAGES) {
        // 合成1：遮罩层压在底图上；合成2：面板压在合成1上
        const scrim = scaleAlpha(variant.values.glassScrim, level.scrim(variant.values.glassScrimMax));
        const step1 = composite(scrim, parseColor(base));
        const step2 = composite(scaleAlpha(variant.values.glassBackground, level.panelOpacity), step1);
        const label = `${theme.id}${variant.suffix ? "(" + variant.suffix + ")" : ""} / ${level.id} / 底图 ${base}`;
        const primary = ratioOf(variant.values.glassTextPrimary, step2);
        if (primary < 4.5) failures.push(`玻璃面板对比度不足 ${label}: glassTextPrimary = ${primary.toFixed(2)}:1，要求 ≥ 4.5:1`);
        const secondary = ratioOf(variant.values.glassTextSecondary, step2);
        if (secondary < 3) failures.push(`玻璃面板对比度不足 ${label}: glassTextSecondary = ${secondary.toFixed(2)}:1，要求 ≥ 3:1`);
      }
    }
  }
}

// 7. 注入串体积：每次 setData 的 CSS 变量串需控制在 2KB 内（需求 8.6）
for (const theme of themeIndex.THEMES) {
  for (const supported of [true, false]) {
    const size = Buffer.byteLength(themeIndex.buildCssVars(theme.id, supported), "utf8");
    if (size > 2048) failures.push(`CSS 变量串超限 ${theme.id}${supported ? "" : "(降级)"}: ${size} 字节 > 2048`);
  }
}

// 7b. 黏土内高光必须跟随卡面明暗（UI 重构方案 J）。
//     这层是 inset 白色高光，一旦被常量化，暗色与玻璃主题的卡片底部会出现一道
//     近乎纯白的亮边。曾经真的这么写过，所以在此钉死：深卡面不许拿到高 alpha。
for (const theme of themeIndex.THEMES) {
  const derived = tokens.deriveScale(theme.tokens, theme.id);
  const highlight = derived["--clay-highlight"];
  const alpha = highlight && Number((String(highlight).match(/,\s*([\d.]+)\s*\)$/) || [])[1]);
  if (!Number.isFinite(alpha)) {
    failures.push(`黏土内高光缺失或不可解析 ${theme.id}: --clay-highlight = ${highlight}`);
    continue;
  }
  // 卡面实际明度（半透明卡面按页面底色合成，与 tokens.js 内同一套口径）
  const face = composite(parseColor(theme.tokens.cardBackground), parseColor(theme.tokens.background) || { r: 128, g: 128, b: 128, a: 1 });
  const level = face ? (face.r * 0.299 + face.g * 0.587 + face.b * 0.114) / 255 : 0.5;
  if (level < 0.5 && alpha > 0.5) {
    failures.push(`黏土内高光过强 ${theme.id}: 卡面明度 ${level.toFixed(2)} 偏暗，但 alpha = ${alpha}（会烧出白边，须随明度插值）`);
  }
  if (level > 0.9 && alpha < 0.5) {
    failures.push(`黏土内高光过弱 ${theme.id}: 卡面明度 ${level.toFixed(2)} 接近白，alpha = ${alpha} 撑不起凸起感`);
  }
}

// 8. CSS 变量来源完整性：.wxss 里 var(--x) 引用的变量必须确有来源，
//    否则样式会静默失效（无来源的 var() 不报错，只是不生效）。
const availableVars = new Set();
for (const key of tokens.TOKEN_KEYS) availableVars.add(tokens.toCssVarName(key));
for (const name of Object.keys(tokens.deriveScale(themeIndex.THEMES[0].tokens, themeIndex.THEMES[0].id))) availableVars.add(name);
for (const name of Object.keys(tokens.CONSTANT_VARS)) availableVars.add(name);
// 场景配色是内容属性，由 scene-presets 以内联 style 注入，不进 token 体系
for (const declaration of require("../theme/scene-presets").getSceneStyle().split(";")) {
  const name = declaration.split(":")[0].trim();
  if (name.indexOf("--") === 0) availableVars.add(name);
}

// 常量变量不进注入串，必须由 app.wxss 声明，且取值与 tokens.js 一致
const appWxss = fs.readFileSync(path.join(root, "app.wxss"), "utf8");
for (const name of Object.keys(tokens.CONSTANT_VARS)) {
  const declared = appWxss.match(new RegExp(`${name}\\s*:\\s*([^;]+);`));
  if (!declared) failures.push(`常量变量缺声明 app.wxss 未声明 ${name}（tokens.js 的 CONSTANT_VARS 不进注入串，只能由 app.wxss 提供）`);
  else if (declared[1].replace(/\s/g, "") !== String(tokens.CONSTANT_VARS[name]).replace(/\s/g, "")) {
    failures.push(`常量变量取值不一致 ${name}: app.wxss = ${declared[1].trim()}，tokens.js = ${tokens.CONSTANT_VARS[name]}`);
  }
}

function scanVarUsage(directory) {
  for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") scanVarUsage(target); continue; }
    if (!entry.name.endsWith(".wxss")) continue;
    const relative = path.relative(root, target).split(path.sep).join("/");
    fs.readFileSync(target, "utf8").split(/\r?\n/).forEach((line, index) => {
      for (const match of line.matchAll(/var\(\s*(--[a-z0-9-]+)/g)) {
        if (!availableVars.has(match[1])) failures.push(`未知 CSS 变量 ${relative}:${index + 1}: ${match[1]} 没有任何来源`);
      }
    });
  }
}
scanVarUsage(root);

// 9. 自定义组件必须在同页 json 的 usingComponents 里注册。
//    漏注册不报错、不渲染 —— 标签被当作未知节点静默丢掉，页面只是「少了一块」，
//    比样式错更难查。t-glass-sheet 就这样在 create 页上少注册过一次。
const componentPattern = /<(t-[a-z0-9-]+)[\s/>]/g;
for (const page of allPages) {
  const wxmlPath = path.join(root, `${page}.wxml`);
  const jsonPath = path.join(root, `${page}.json`);
  if (!fs.existsSync(wxmlPath) || !fs.existsSync(jsonPath)) continue;
  let registered = {};
  try { registered = JSON.parse(fs.readFileSync(jsonPath, "utf8")).usingComponents || {}; } catch { continue; }
  const used = new Set();
  for (const match of fs.readFileSync(wxmlPath, "utf8").matchAll(componentPattern)) used.add(match[1]);
  for (const tag of used) {
    if (!registered[tag]) failures.push(`组件未注册 ${page}.wxml 用了 <${tag}>，但同名 json 的 usingComponents 里没有它（会静默不渲染）`);
  }
  // 反向：注册了却没用到属于无用依赖，会拖慢启动
  for (const tag of Object.keys(registered)) {
    if (!used.has(tag)) failures.push(`组件注册冗余 ${page}.json 注册了 ${tag} 但 wxml 未使用`);
  }
}

// 10. WXML 标签闭合。CI 里 `pnpm validate` 是小程序侧唯一的自动化关卡
//     （见 .github/workflows/ci.yml），标签写错要等开发者工具打开才报，
//     而那已经是本地手动环节了。这条在改动嵌套结构时兜底。
//     WXML 没有 HTML 那种 void 元素：<image> 既可写成自闭合，也可写成 <image></image>，
//     两种本仓库都在用。所以只按自闭合斜杠判断，不能预设某些标签「不需要闭合」——
//     那样遇到显式闭合的写法会把栈顶算错，报出一串假失衡。
function checkTagBalance(file) {
  const source = fs.readFileSync(file, "utf8").replace(/<!--[\s\S]*?-->/g, "");
  const relative = path.relative(root, file).split(path.sep).join("/");
  const stack = [];
  for (const match of source.matchAll(/<(\/?)([a-zA-Z][\w-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g)) {
    const [, closing, name, , selfClosing] = match;
    if (selfClosing) continue;
    const line = source.slice(0, match.index).split("\n").length;
    if (closing) {
      const open = stack.pop();
      if (!open) failures.push(`WXML 标签失衡 ${relative}:${line} 多余的 </${name}>`);
      else if (open.name !== name) failures.push(`WXML 标签失衡 ${relative}:${line} </${name}> 与 ${relative}:${open.line} 的 <${open.name}> 不匹配`);
    } else stack.push({ name, line });
  }
  for (const open of stack) failures.push(`WXML 标签失衡 ${relative}:${open.line} <${open.name}> 未闭合`);
}

function scanWxml(directory) {
  for (const entry of fs.existsSync(directory) ? fs.readdirSync(directory, { withFileTypes: true }) : []) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) { if (entry.name !== "node_modules") scanWxml(target); continue; }
    if (entry.name.endsWith(".wxml")) checkTagBalance(target);
  }
}
scanWxml(root);

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
const subPackagePages = allPages.length - (app.pages || []).length;
console.log(`Mini Program structure is valid (${allPages.length} pages${subPackagePages ? `，含分包 ${subPackagePages}` : ""}, ${themeIndex.THEMES.length} themes, ${tokens.TOKEN_KEYS.length} tokens).`);
