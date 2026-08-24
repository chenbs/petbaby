const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const app = JSON.parse(fs.readFileSync(path.join(root, "app.json"), "utf8"));
const failures = [];

/*
 * 门禁的页面清单 = 主包 `pages` ∪ 全部分包 `subPackages[].pages`（拼上各自 root）。
 *
 * 只遍历 `app.pages` 会让分包页面**完全不进门禁**：第 1 项（四文件齐备）、
 * 第 9 项（组件注册）都会静默跳过 —— 而这两项管的正是「不报错但页面少一块」
 * 类错误（漏注册的组件被当未知节点丢掉）。宠物小岛走分包（主包余量不足 700KB），
 * 若不先补这里，岛的全部页面等于没有关卡。
 *
 * 两种键名都要认：微信同时接受 `subPackages` 与 `subpackages`，
 * 只认一种的话另一种写法下门禁会静默失效 —— 与本项要修的问题同一性质。
 */
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

/** 实际被第 3 项扫过的文件清单。门禁 17 用它断言岛内样式没掉出覆盖范围 */
const scannedWxss = [];

function scanWxss(file) {
  scannedWxss.push(file);
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
// 岛的 HUD 底板同理：内容属性、内联注入、与主题 token 隔离（22 号文 2.2）。
// 前缀刻意与 --scene-* 分开 —— 两套都是内容变量但服务不同模块，共用前缀会让这里分不清谁该有谁。
for (const declaration of require("../island/hud-vars").getIslandStyle().split(";")) {
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

/*
 * ============================================================================
 * 宠物小岛专属门禁（22 号文 9.2）。编号接着既有十项往后排。
 *
 * **11–15 是一个扫描器跑五份词表，不是五个独立脚本**（9.2 末句）：
 *   11 健康评价词（生病/太胖/正常范围/BMI…）—— 4.1 #9
 *   12 诊疗措辞（诊断/确诊/治愈/问诊）—— 红线 1
 *   13 喂养建议（克数、毫升、每日建议、真实品牌）—— 4.1 #10
 *   14 游戏化词汇（等级/经验/体力/金币/关卡/排行榜/抽卡）—— 4.1 #1/#4/#5，兼类目自检
 *   15 日记模板全量穷举
 *
 * **两侧分工**（初版注释说「端上没有可扫的模板」，那句不准确，已订正）：
 * 日记模板的**穷举**在服务端（`server/island/diary-adversarial.test.ts`，遍历模板 ×
 * 变量后跑同一份词表），因为穷举要 import TS 模块；但端上有**自己写的静态文案** ——
 * 到达每日上限的措辞、点窝的一句话、素材未就绪的提示，都是在 `island/` 里拼的，
 * 服务端的穷举扫不到它们。所以这一侧扫岛目录的 WXML 文本节点与 JS 字符串字面量。
 *
 * **词表读 `apps/platform/src/domain/copy-guard.json`，不在这里抄一份**：
 * 9.2 #11 明确要求「复用已有的评价词清单，不新造一份（两份必然漂移）」，
 * 而漂移的表现是「一边拦住了、另一边放过去了」，且没人会发现哪边是对的。
 *
 * 16–17 管的是第 5 / 6 步的产出（Canvas 场景层与 HUD）。
 * ============================================================================
 */

const islandExists = fs.existsSync(path.join(root, "island"));

/*
 * 词表。**文件读不到必须报失败而不是跳过** —— 静默跳过的门禁等于没有门禁，
 * 而这一条正是「静默失效」类错误（既有第 8/9/10 项管的都是这一类）。
 */
const COPY_GUARD_PATH = path.resolve(root, "../platform/src/domain/copy-guard.json");
let copyGuard = null;
if (islandExists) {
  try {
    copyGuard = JSON.parse(fs.readFileSync(COPY_GUARD_PATH, "utf8"));
  } catch (error) {
    failures.push(`文案词表读不到 ${path.relative(root, COPY_GUARD_PATH).split(path.sep).join("/")}：${error.message}（词表是唯一事实来源，不能在小程序侧另抄一份）`);
  }
}

if (copyGuard) {
  const GUARD_CATEGORIES = [
    { key: "judgement", gate: 11, label: "健康评价词" },
    { key: "clinical", gate: 12, label: "诊疗措辞" },
    { key: "feeding", gate: 13, label: "喂养建议" },
    { key: "gamified", gate: 14, label: "游戏化词汇" }
  ];

  /**
   * 扫一段用户可见文案，返回全部命中。
   * 与 platform 侧 `findCopyViolations` 同一算法 —— 那边是 TS，这里 require 不了。
   */
  function scanCopy(text) {
    const hits = [];
    for (const category of GUARD_CATEGORIES) {
      const section = copyGuard[category.key] || {};
      for (const word of section.words || []) {
        if (String(text).indexOf(word) >= 0) hits.push({ gate: category.gate, label: category.label, term: word });
      }
      for (const pattern of section.patterns || []) {
        // 每次新建 RegExp：带 g 的共享实例会因 lastIndex 残留而在第二次调用时漏匹配
        if (new RegExp(pattern).test(String(text))) hits.push({ gate: category.gate, label: category.label, term: pattern });
      }
    }
    return hits;
  }

  /**
   * WXML 里的可见文本节点。
   *
   * 三样要先剥掉，否则全是误报：
   *   - **注释** —— 岛的注释大量引用红线原文（「不出现等级/经验/体力/金币」），
   *     扫它等于因为写了「不许说体力」而判违例；
   *   - **标签与属性** —— `class="plate"` 不是用户可见文案；
   *   - **`{{}}` 插值** —— 那是服务端下发的数据，由服务端出口的 `assertCopySafe` 管。
   */
  function visibleTextChunks(source) {
    return source
      .replace(/<!--[\s\S]*?-->/g, "\n")
      .replace(/<[^>]*>/g, "\n")
      .split("\n")
      .map((line) => line.replace(/\{\{[^}]*\}\}/g, " ").trim())
      .filter(Boolean);
  }

  /**
   * JS 里的字符串字面量。
   *
   * **只扫字面量，不扫整份文件**：源码里的注释与标识符会大量误命中 ——
   * `limitHintOf` 的注释正是在解释为什么不能说「体力耗尽」。
   */
  function literalChunks(source) {
    const stripped = source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
    return (stripped.match(/"[^"\n]*"|'[^'\n]*'/g) || []).map((literal) => literal.slice(1, -1)).filter(Boolean);
  }

  /*
   * **只扫岛的目录。** 既有 23 页里健康相关页面本来就要谈体重与分诊，
   * 拿这份词表扫全仓库会把 `pages/health/` 的正当文案全部判违例（那边有自己的门禁）。
   * 岛的判据是 1.4「岛上不能出现任何健康判断」—— 范围就是岛。
   */
  (function scanIslandCopy(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) { scanIslandCopy(target); continue; }
      if (!/\.(wxml|js)$/.test(entry.name)) continue;
      const relative = path.relative(root, target).split(path.sep).join("/");
      const source = fs.readFileSync(target, "utf8");
      const chunks = entry.name.endsWith(".wxml") ? visibleTextChunks(source) : literalChunks(source);
      for (const chunk of chunks) {
        for (const hit of scanCopy(chunk)) {
          failures.push(`门禁 ${hit.gate}（${hit.label}）${relative}: 「${hit.term}」出现在文案「${chunk.slice(0, 40)}」`);
        }
      }
    }
  })(path.join(root, "island"));

  /*
   * 门禁 15 的端上一半：**到达每日上限的措辞必须存在，且措辞不是体力值。**
   *
   * 措辞差异决定采集是不是 4.1 #4 的体力值 —— 「今天的草丛都看过了」是互动营销层，
   * 「体力耗尽」是游戏机制，后者会把整体推过类目线（1.1）。上面的词表扫描能拦住
   * 写成体力的情况，但拦不住**把这段措辞整个删掉**、改用服务端错误码原样展示 ——
   * 那时端上这条判据静默失效。所以正面断言它存在。
   */
  const islandIndexJs = path.join(root, "island", "index", "index.js");
  if (fs.existsSync(islandIndexJs)) {
    const source = fs.readFileSync(islandIndexJs, "utf8");
    if (source.indexOf("limitHintOf") < 0) {
      failures.push("门禁 15 island/index/index.js 缺 limitHintOf —— 到达上限的措辞不能删掉改用服务端错误码原样展示，那会让「不是体力值」这条判据静默失效");
    }
    /*
     * **在字面量里找，不在整份文件里找。** 那段措辞在 `limitHintOf` 的注释里也被
     * 引用了一次（注释在解释为什么要这么说），扫全文时把措辞真的改掉、注释留着，
     * 这条检查照样通过 —— 实测确实如此。判据必须落在会被用户看到的那一份上。
     */
    if (!literalChunks(source).some((chunk) => chunk.indexOf("草丛都看过了") >= 0)) {
      failures.push("门禁 15 island/index/index.js 的字符串字面量里缺「今天的草丛都看过了」这类措辞 —— 措辞差异决定采集是不是 4.1 #4 的体力值");
    }
  }
}

if (islandExists) {
  const islandAmbient = require("../island/scene/ambient");

  /*
   * 16. HUD 底板合成后的文字对比度 ≥4.5:1，**并断言底板本身存在**。
   *
   * 校验的是「底板合成后」而不是「文字与地表的直接对比度」：底板半透明，
   * 它自身的呈现色取决于身后的场景，必须逐组合算。
   *
   * 断言底板存在这一半同样重要 —— 22 号文 2.5.1 实算证明 16 种昼夜×天气组合下
   * **没有任何单一字色能全覆盖**（最暗的「雨+夜」深色字 3.23:1、白字 4.13:1 双双不达标），
   * 底板是唯一解。所以它不能被「优化」掉，而那种改动在白昼开发时完全看不出问题。
   */
  const PHASES = ["dawn", "day", "dusk", "night"];
  const WEATHERS = ["clear", "cloudy", "rain", "snow"];
  // 地表取全部调色板色：树丛深色 #5F7A4E 与深色文字只有 2.78:1，正是底板的直接成因
  const SURFACES = Object.keys(islandAmbient.ISLAND_PALETTE).map((key) => islandAmbient.ISLAND_PALETTE[key]);

  /**
   * 用本文件既有的 composite / luminance 复算，与主题对比度同一套口径。
   *
   * **两处都要合成，不只底板那一处**：底板半透明（呈现色取决于身后场景），
   * 而次级文字也是半透明的（`--island-ink-soft`）—— 半透明文字的实际颜色取决于
   * 它压在哪块底板上。漏掉后者会把 `rgba(58,44,44,0.75)` 当成实色 `#3A2C2C` 算，
   * 得出的比值虚高，那正是 `--island-ink-soft` 带着 4.23:1 混过门禁的原因。
   */
  function islandContrast(surface, overlays, plateColor, plateAlpha, textColor, textAlpha) {
    let scene = parseColor(surface);
    for (const layer of overlays) {
      scene = composite({ r: parseColor(layer.color).r, g: parseColor(layer.color).g, b: parseColor(layer.color).b, a: layer.opacity }, scene);
    }
    const plate = parseColor(plateColor);
    const shown = composite({ r: plate.r, g: plate.g, b: plate.b, a: plateAlpha }, scene);
    const ink = parseColor(textColor);
    const front = composite({ r: ink.r, g: ink.g, b: ink.b, a: textAlpha }, shown);
    const first = luminance(front);
    const second = luminance(shown);
    return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
  }

  /*
   * 遍历**每个字色 × 每档底板 × 16 种昼夜天气 × 全部地表色**。
   *
   * 组合表由 `island/hud-vars.js` 的 `ISLAND_TEXT_ON_PLATE` 给出，而不是在这里写死 ——
   * 门禁与实现读同一张表，加了变量却没进表会被下面的 `uncoveredVars()` 抓到。
   * 早先这里只算「主文字 @1.0 压在 0.82 底板」一种，于是 `.wxss` 里另外三种组合
   * 完全没被校验过（实测 `--island-ink-soft` 在夜+晴的树丛色上只有 4.23:1）。
   */
  const islandHudVars = require("../island/hud-vars");
  for (const pair of islandHudVars.ISLAND_TEXT_ON_PLATE) {
    const plateColor = islandHudVars.ISLAND_VARS[pair.plate];
    const textColor = islandHudVars.ISLAND_VARS[pair.text];
    if (!plateColor || !textColor) {
      failures.push(`门禁 16 组合表引用了不存在的变量：${pair.text} / ${pair.plate}（hud-vars.js 的 ISLAND_TEXT_ON_PLATE 与 ISLAND_VARS 对不上）`);
      continue;
    }
    for (const phase of PHASES) {
      for (const weather of WEATHERS) {
        /*
         * 图层按 PHASE_OVERLAYS → WEATHER_OVERLAYS 的顺序拼，与 `ambientAt` 内部一致：
         * **叠加顺序（先昼夜、再天气）也是口径的一部分**，alpha 叠加不满足交换律，
         * 反过来叠「雨+夜」得 0.435 而不是实算表的 0.485（11.2）。
         */
        const overlays = [];
        const phaseLayer = islandAmbient.PHASE_OVERLAYS[phase];
        if (phaseLayer) overlays.push(phaseLayer);
        const weatherLayer = islandAmbient.WEATHER_OVERLAYS[weather];
        if (weatherLayer) overlays.push(weatherLayer);
        for (const surface of SURFACES) {
          const ratio = islandContrast(surface, overlays, plateColor, pair.plateAlpha, textColor, pair.textAlpha);
          if (ratio < 4.5) {
            failures.push(`岛 HUD 对比度不足 ${pair.text} on ${pair.plate} / ${phase}+${weather} / 地表 ${surface}: 底板合成后 = ${ratio.toFixed(2)}:1，要求 ≥ 4.5:1`);
          }
        }
      }
    }
  }

  /*
   * 组合表必须覆盖全部注入变量。加一个 `--island-ink-*` 却忘了登记时，
   * 上面的循环会照样跑完并通过 —— 与「只校验一种组合」是同一个静默失效。
   */
  for (const name of islandHudVars.uncoveredVars()) {
    failures.push(`门禁 16 未覆盖注入变量 ${name}：新增的字色/底板必须登记进 hud-vars.js 的 ISLAND_TEXT_ON_PLATE，否则它的对比度从来没被算过`);
  }

  // 底板必须存在且真的是半透明底板：不透明度落在 (0,1) 之外就不再是「底板压场景」
  if (!islandAmbient.HUD_PLATE || !(islandAmbient.HUD_PLATE.opacity > 0 && islandAmbient.HUD_PLATE.opacity < 1)) {
    failures.push("岛 HUD 底板缺失或不透明度非法：16 种昼夜×天气组合下无任何单一字色能全域达标，底板是唯一解，不能去掉（22 号文 2.3 / 2.5.1）");
  }
  // 底板必须真的被 .wxss 用上 —— 常量在但没人引用等于没有底板
  const islandHudWxss = path.join(root, "island", "index", "index.wxss");
  if (fs.existsSync(islandHudWxss)) {
    const source = fs.readFileSync(islandHudWxss, "utf8");
    if (source.indexOf("--island-plate") < 0) {
      failures.push("岛 HUD 底板未被引用 island/index/index.wxss 里没有 var(--island-plate)（门禁 16 要求底板存在，不可被优化掉）");
    }
  }

  /*
   * 17. 岛内 `.wxss` 零硬编码。
   *
   * **规则与既有第 3 项完全相同，而第 3 项已经全目录递归**（`collectWxss(root)`），
   * 所以岛的样式表已经在扫了 —— 这里**不重复扫描**（重复会让同一个错误报两遍），
   * 只断言覆盖范围真的落到了 island/。
   *
   * 断言的必要性：万一将来有人给 `collectWxss` 加了目录白名单或跳过规则，
   * 岛会静默掉出门禁，而「Canvas 内像素不受 token 约束」这件事很容易被推广成
   * 「岛本来就不用管样式门禁」—— 但岛的 HUD 是 WXML，必须走 token。
   */
  const islandWxssFiles = [];
  (function walk(directory) {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(target);
      else if (entry.name.endsWith(".wxss")) islandWxssFiles.push(target);
    }
  })(path.join(root, "island"));
  if (!islandWxssFiles.length) {
    failures.push("岛内没有任何 .wxss：分包页面缺样式表（第 1 项应已报错，此处兜底）");
  }
  for (const file of islandWxssFiles) {
    if (scannedWxss.indexOf(file) < 0) {
      failures.push(`岛内样式未进硬编码门禁 ${path.relative(root, file).split(path.sep).join("/")}（第 3 项的遍历漏了它，门禁 17 要求岛内 .wxss 一律受扫）`);
    }
  }
}

if (failures.length) {
  console.error(failures.join("\n"));
  process.exit(1);
}
const subPackagePages = allPages.length - (app.pages || []).length;
console.log(`Mini Program structure is valid (${allPages.length} pages${subPackagePages ? `，含分包 ${subPackagePages}` : ""}, ${themeIndex.THEMES.length} themes, ${tokens.TOKEN_KEYS.length} tokens).`);
