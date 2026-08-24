/**
 * Token 键名清单（唯一真源）。
 * 新增 token 必须先登记在此，四套皮肤缺键或类型不符时 `pnpm validate` 直接失败。
 *
 * 类型说明：
 *   color 纯色（hex / rgb / rgba）   paint 纯色或渐变
 *   length 单一长度                  radius 1-4 个长度（支持不对称圆角）
 *   shadow box-shadow 值             border 描边简写
 *   duration 时长                    easing 缓动函数
 *   number 无单位数字                angle 角度
 *   boolean 布尔                     animation 动效枚举
 *   navText 导航栏字色枚举
 */
const TOKEN_SPEC = {
  // 基础颜色（9）
  primary: "color",
  secondary: "color",
  background: "paint",
  surface: "paint",
  cardBackground: "paint",
  textPrimary: "color",
  textSecondary: "color",
  border: "color",
  divider: "color",
  // 状态颜色（4 + 2）
  success: "color",
  warning: "color",
  error: "color",
  disabled: "color",
  successSurface: "paint",
  errorSurface: "paint",
  // AI 相关（3 + 1）
  aiGradientStart: "color",
  aiGradientEnd: "color",
  aiGlow: "color",
  aiGradientAngle: "angle",
  // 按钮（3 + 3）
  buttonPrimary: "paint",
  buttonSecondary: "paint",
  buttonDisabled: "paint",
  buttonPrimaryText: "color",
  buttonSecondaryText: "color",
  buttonRadius: "length",
  // 卡片（3 + 2）
  cardRadius: "length",
  cardShadow: "shadow",
  cardBlur: "length",
  cardBorder: "border",
  cardRadiusVariant: "radius",
  // 顶部高光描边：方案 2.4 指出暗底上阴影几乎不可见，层级要靠高光边而非投影建立。
  // 亮色皮肤取 0 宽度（层级交给 --shadow-card），暗色与玻璃皮肤才真正用它。
  borderHighlight: "border",
  // 页面（2 + 2）
  pagePadding: "length",
  sectionSpacing: "length",
  pageBottomSafe: "length",
  navBarBackground: "color",
  navBarTextStyle: "navText",
  // 字体（3 + 3）
  titleSize: "length",
  bodySize: "length",
  smallSize: "length",
  eyebrowSize: "length",
  titleWeight: "number",
  titleLetterSpacing: "length",
  // 动效（2 + 2）
  transitionDuration: "duration",
  animationType: "animation",
  transitionEasing: "easing",
  glowAnimation: "boolean",
  // 沉浸式玻璃面板（11，见 docs/demand/theme-2.md 5.1）
  glassBackground: "paint",
  glassBackgroundSolid: "color",
  glassBorder: "border",
  glassBlur: "length",
  glassRadius: "radius",
  glassShadow: "shadow",
  glassScrim: "color",
  glassScrimMax: "number",
  glassTextPrimary: "color",
  glassTextSecondary: "color",
  glassHandle: "color"
};

const TOKEN_KEYS = Object.keys(TOKEN_SPEC);
const ANIMATION_TYPES = ["bounce", "glow", "fade", "neon"];
const NAV_TEXT_STYLES = ["black", "white"];

/**
 * 只被逻辑层消费、CSS 从不引用的 token：不进注入串。
 *
 * 注入串有 2048 字节硬门禁（需求 theme-2.md 11.3），glass 主题曾贴到 2045。这几个 token
 * 的消费方都在 JS 里 —— animationType/glowAnimation 转成 anim-* 类名，navBarTextStyle 给
 * wx.setNavigationBarColor，aiGradientEnd/Angle 由 deriveScale 合成 --ai-gradient，
 * glassBackgroundSolid 只作降级兜底 —— 下发它们纯属浪费预算。
 *
 * 剔除后 scripts/validate.js 的「var() 必须有来源」会按实际注入集判定，
 * 因此若将来有 .wxss 误引用这里的变量，门禁会直接报错而不是静默失效。
 */
const JS_ONLY_TOKENS = ["animationType", "glowAnimation", "navBarTextStyle", "aiGradientEnd", "aiGradientAngle", "glassBackgroundSolid"];

/** 面板吸附缓动：四套皮肤统一，禁止复用带过冲的 transitionEasing（需求 theme-2.md 6.2.5）。 */
const GLASS_EASING = "cubic-bezier(.22,.61,.36,1)";

/**
 * 与主题无关的常量变量：不进 setData 注入串，只在 app.wxss 的 `page{}` 里声明一次。
 * page-style 是内联样式，注入串只需承载「随主题变化」的量；常量下发纯属重复开销，
 * 会把 glass 主题的注入串顶到 2KB 门禁之上（需求 theme-2.md 11.3 要求优先合并而非放宽阈值）。
 */
const CONSTANT_VARS = {
  "--radius-pill": "999rpx",
  "--glass-easing": GLASS_EASING,
  "--glass-blur-degraded": "0",

  // ── 间距（UI 重构方案 2.1）────────────────────────────────────────────────
  // 绝对阶梯，不再由 pagePadding 按比例派生：派生会让 light(40rpx) 与 glass(32rpx)
  // 得到 20/16 这种错位取值，跨主题对不齐。页面外边距仍走 --page-padding。
  // 标签与其副标题之间的贴合间距，比 --space-1 更紧，用于「一组不可分的文字」
  "--space-0": "4rpx",
  "--space-1": "8rpx",
  "--space-2": "16rpx",
  "--space-3": "24rpx",
  "--space-4": "32rpx",
  "--space-5": "48rpx",
  "--space-6": "64rpx",
  "--space-7": "96rpx",
  "--space-8": "128rpx",
  "--page-x-wide": "48rpx",
  "--gap-item": "24rpx",
  "--gap-group": "48rpx",
  "--gap-section": "96rpx",

  // ── 圆角（方案 2.2）──────────────────────────────────────────────────────
  // 阶梯是绝对值；--card-radius 仍是主题身份（light 16 / cute 24 / glass 28），
  // 卡片用它，其余元件按尺寸取阶梯档 —— 方案指出「所有卡片同一圆角」是粗糙感来源。
  "--radius-xs": "8rpx",
  "--radius-sm": "16rpx",
  "--radius-md": "24rpx",
  "--radius-lg": "32rpx",
  "--radius-xl": "48rpx",
  "--radius-clay": "56rpx",
  "--radius-none": "0",
  // t-empty 的线条插画形状常量：门禁只豁免单值 50%，非对称的有机形状须登记为 token
  "--radius-pad": "50% 50% 46% 46%",
  "--radius-head": "46% 46% 50% 50%",

  // ── 行高与字重字距（方案 2.3，F 排版方法论）──────────────────────────────
  "--lh-display": "1.06",
  "--lh-h1": "1.3",
  "--lh-h2": "1.35",
  "--lh-h3": "1.4",
  "--lh-body": "1.62",
  "--lh-sm": "1.6",
  "--lh-xs": "1.5",
  "--fw-light": "300",
  "--fw-normal": "400",
  "--fw-medium": "500",
  "--fw-bold": "700",
  "--fw-black": "800",
  "--ls-tight": "-0.02em",
  "--ls-tighter": "-0.04em",
  "--ls-kicker": "0.24em",
  "--ls-cover": "0.3em",

  // ── 图片比例（方案 2.5）──────────────────────────────────────────────────
  "--ratio-hero": "16 / 10",
  "--ratio-card": "3 / 4",
  "--ratio-cover": "4 / 3",
  "--ratio-square": "1 / 1",

  // ── 动效（方案 2.6）──────────────────────────────────────────────────────
  "--dur-fast": "120ms",
  "--dur-base": "240ms",
  "--dur-slow": "400ms",
  "--dur-reveal": "900ms",
  "--stagger": "40ms",
  "--ease-out": "cubic-bezier(.22,1,.36,1)",
  "--ease-in-out": "cubic-bezier(.4,0,.2,1)"
};

/**
 * 阴影与压图遮罩（方案 2.4 / 2.5）。
 *
 * 两条硬约束决定了这些值只能是「成品串」：
 *   ① .wxss 里不许出现 rgba(，所以方案里 `rgba(var(--shadow-hue), .10)` 那种色相拆分
 *      写法过不了门禁，组合只能在 JS 侧完成；
 *   ② 注入串预算紧张，而这些几何形状与主题无关，故进常量、不进注入串。
 *
 * 基色取暖褐而非纯黑 —— 方案称这是「廉价与高级最快的分水岭」。
 */
const SHADOW_HUE = "60,35,20";
const OVERLAY_HUE = "20,10,4";

function shadowVars() {
  const s = (alpha) => `rgba(${SHADOW_HUE},${alpha})`;
  const o = (alpha) => `rgba(${OVERLAY_HUE},${alpha})`;
  return {
    "--shadow-card": `0 4rpx 16rpx -4rpx ${s(".1")},0 32rpx 64rpx -36rpx ${s(".28")}`,
    "--shadow-image": `0 8rpx 24rpx -8rpx ${s(".16")},0 56rpx 96rpx -48rpx ${s(".42")}`,
    "--shadow-float": `0 16rpx 40rpx -12rpx ${s(".18")},0 64rpx 120rpx -40rpx ${s(".38")}`,
    "--shadow-press": `0 2rpx 8rpx -2rpx ${s(".14")}`,
    "--shadow-none": "none",
    /*
     * 黏土（方案 J）的后三层：内上阴影造厚度 + 双层外投影造悬浮。
     * 这三层与卡面明暗无关（外投影落在页面底色上），故留在常量里。
     *
     * 第一层内高光必须相对卡片底色成立 —— 白底受得住 .95，而暗色主题
     * #181B22 的卡面会被同一个值烧出一道近乎纯白的亮边。因此高光单独按主题下发
     * （--clay-highlight，见 deriveScale），由 .wxss 侧两段拼成完整四层。
     * 拆开而非整串下发是为了注入串预算：整串约 210 字节，glass 主题本就贴着 2048 上限。
     */
    "--shadow-clay-body": "inset 0 10rpx 24rpx rgba(190,140,120,.13),0 16rpx 32rpx -12rpx rgba(190,140,120,.34),0 36rpx 68rpx -36rpx rgba(190,140,120,.5)",
    // 压图文字的三段遮罩：两段会在中间留出可见断层
    "--veil-image": `linear-gradient(to top,${o(".82")} 0%,${o(".28")} 45%,transparent 72%)`,
    // 所有图片的轻微暗角，压住 AI 出图偏亮的边缘
    "--veil-vignette": `radial-gradient(120% 90% at 50% 15%,transparent 35%,${s(".34")})`
  };
}

Object.assign(CONSTANT_VARS, shadowVars());

const COLOR_PATTERN = /^(#[0-9a-fA-F]{3,8}|rgba?\([^()]*\)|transparent)$/;
const LENGTH_PATTERN = /^-?\d+(\.\d+)?(rpx|px|%|em|vh|vw)?$/;

function isColor(value) { return typeof value === "string" && COLOR_PATTERN.test(value.trim()); }
function isPaint(value) { return typeof value === "string" && (isColor(value) || /gradient\(/.test(value)); }
function isLength(value) { return typeof value === "string" && LENGTH_PATTERN.test(value.trim()); }
function isRadius(value) { return typeof value === "string" && value.trim().split(/\s+/).length <= 4 && value.trim().split(/\s+/).every(isLength); }

/** 逐 token 校验取值类型。返回错误说明数组，空数组表示通过。 */
function validateTokens(themeId, tokens) {
  const problems = [];
  const source = tokens || {};
  for (const key of TOKEN_KEYS) {
    if (!(key in source)) { problems.push(`${themeId}: 缺少 token \`${key}\``); continue; }
    const value = source[key];
    const type = TOKEN_SPEC[key];
    let ok = true;
    if (type === "color") ok = isColor(value);
    else if (type === "paint") ok = isPaint(value);
    else if (type === "length") ok = isLength(value);
    else if (type === "radius") ok = isRadius(value);
    else if (type === "shadow" || type === "border" || type === "easing") ok = typeof value === "string" && value.length > 0;
    else if (type === "duration") ok = typeof value === "string" && /^\d+(\.\d+)?m?s$/.test(value);
    else if (type === "number") ok = typeof value === "number" && Number.isFinite(value);
    else if (type === "angle") ok = typeof value === "string" && /^-?\d+(\.\d+)?deg$/.test(value);
    else if (type === "boolean") ok = typeof value === "boolean";
    else if (type === "animation") ok = ANIMATION_TYPES.indexOf(value) >= 0;
    else if (type === "navText") ok = NAV_TEXT_STYLES.indexOf(value) >= 0;
    if (!ok) problems.push(`${themeId}: token \`${key}\` 取值不符合类型 ${type}（当前 ${JSON.stringify(value)}）`);
  }
  for (const key of Object.keys(source)) {
    if (!(key in TOKEN_SPEC)) problems.push(`${themeId}: 多余 token \`${key}\`（未登记在 tokens.js）`);
  }
  return problems;
}

/** camelCase → --kebab-case，L2 → L3 的唯一转换入口。 */
function toCssVarName(key) { return "--" + key.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase(); }

/** 把颜色 token 转成指定透明度的 rgba，用于派生遮罩色。 */
function withAlpha(value, alpha) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.split("").map((char) => char + char).join("");
    return `rgba(${parseInt(digits.slice(0, 2), 16)},${parseInt(digits.slice(2, 4), 16)},${parseInt(digits.slice(4, 6), 16)},${alpha})`;
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = rgb[1].split(",").map((part) => part.trim());
    return `rgba(${parts[0]},${parts[1]},${parts[2]},${alpha})`;
  }
  return `rgba(0,0,0,${alpha})`;
}

/**
 * 把 paint（纯色或渐变）折算成一个代表色 {r,g,b}。
 * 渐变取各色标的算术平均 —— 只用于「整体偏亮还是偏暗」的判断，
 * 不必还原真实的插值分布。取不到任何色标时返回 null。
 */
function flattenPaint(value) {
  const direct = parseRgba(value);
  if (direct) return direct;
  const stops = String(value).match(/#[0-9a-fA-F]{3,8}|rgba?\([^()]*\)/g);
  if (!stops || !stops.length) return null;
  const parsed = stops.map(parseRgba).filter(Boolean);
  if (!parsed.length) return null;
  return {
    r: parsed.reduce((sum, item) => sum + item.r, 0) / parsed.length,
    g: parsed.reduce((sum, item) => sum + item.g, 0) / parsed.length,
    b: parsed.reduce((sum, item) => sum + item.b, 0) / parsed.length,
    a: 1
  };
}

/** 解析 hex / rgb / rgba 为 {r,g,b,a}；渐变等无法解析时返回 null。 */
function parseRgba(value) {
  const text = String(value).trim();
  const hex = text.match(/^#([0-9a-fA-F]{3,8})$/);
  if (hex) {
    let digits = hex[1];
    if (digits.length === 3 || digits.length === 4) digits = digits.split("").map((char) => char + char).join("");
    const alpha = digits.length === 8 ? parseInt(digits.slice(6, 8), 16) / 255 : 1;
    return { r: parseInt(digits.slice(0, 2), 16), g: parseInt(digits.slice(2, 4), 16), b: parseInt(digits.slice(4, 6), 16), a: alpha };
  }
  const rgb = text.match(/^rgba?\(([^)]+)\)$/);
  if (!rgb) return null;
  const parts = rgb[1].split(",").map((part) => Number(part.trim()));
  if (parts.slice(0, 3).some((part) => !Number.isFinite(part))) return null;
  return { r: parts[0], g: parts[1], b: parts[2], a: parts.length > 3 && Number.isFinite(parts[3]) ? parts[3] : 1 };
}

/**
 * 取「这块面积实际看起来的明度」（0 暗 → 1 亮）。无法解析时按中间值 0.5 处理。
 *
 * 半透明前景必须先与背景合成再测 —— glass 主题的 cardBackground 是
 * rgba(255,255,255,.15)，直接测会当成纯白，但它压在深色底上，实际观感是暗的。
 * 少了这步合成，glass 会和暗色主题一样被内高光烧出一道白边。
 *
 * 只服务于「偏亮还是偏暗」的判断，不做色彩管理，故用 sRGB 加权和，不转线性空间。
 */
function lightness(value, backdrop) {
  const front = flattenPaint(value);
  if (!front) return 0.5;
  let { r, g, b } = front;
  if (front.a < 1) {
    // 底色取不到时按中性灰兜底，而非纯白 —— 猜白会让暗色系的半透明卡面被判成亮面，
    // 正是内高光烧白的成因。
    const base = flattenPaint(backdrop) || { r: 128, g: 128, b: 128 };
    r = front.r * front.a + base.r * (1 - front.a);
    g = front.g * front.a + base.g * (1 - front.a);
    b = front.b * front.a + base.b * (1 - front.a);
  }
  return (r * 0.299 + g * 0.587 + b * 0.114) / 255;
}

function rpx(value, ratio) {
  const amount = parseFloat(value);
  if (!Number.isFinite(amount)) return value;
  return Math.round(amount * ratio) + "rpx";
}

/**
 * 派生标尺：组件与页面需要的中间量（间距、次级圆角、次级字号）全部由 L2 token 按比例算出，
 * 而不是各处写字面量。派生结果同样以 CSS 变量下发，页面只能引用变量。
 */
/**
 * 黏土内高光色。强度随卡面实际明度线性插值：
 * 白底（明度 1）得 .95 的饱满凸起，纯黑底得 .10 只留一丝转折。
 * 卡面半透明时按页面底色合成后再测，见 lightness()。
 */
function clayHighlight(cardBackground, background) {
  return `rgba(255,255,255,${(0.1 + 0.85 * lightness(cardBackground, background)).toFixed(2)})`;
}

function deriveScale(tokens, themeId) {
  const pad = tokens.pagePadding;
  const radius = tokens.cardRadius;
  const title = tokens.titleSize;
  return {
    // 间距与圆角阶梯已改为 CONSTANT_VARS 的绝对值（方案 2.1/2.2），此处不再派生。
    // --card-radius 保留为主题身份值，卡片专用；--radius-* 阶梯供其余元件按尺寸取档。
    //
    // 比例锚在方案 2.3 的字阶上：h1 44 / h2 36 / h3 30，即 h2=0.82、h3=0.68。
    // 旧取值（0.72 / 0.58）会让 h3 落到 26rpx —— 比 bodySize 的 28rpx 还小，
    // 于是 .sub-title / .pet-name / .hero-stat-value 反而比正文更细弱，层级倒挂。
    // 四套皮肤里有三套都倒挂，故改在这里而不是逐个主题堆 titleSize。
    "--font-h2": rpx(title, 0.82),
    "--font-h3": rpx(title, 0.68),
    // 空状态插画等超大字形；eyebrow 的字间距也走派生值，避免逐页写字面量。
    // 1.28 对应方案 2.3 的 display 56rpx（相对 h1 44rpx）；旧的 1.6 会把 light
    // 顶到 70rpx、cute 顶到 77rpx，login 的四字标题在 375pt 屏上要折行。
    "--font-display": rpx(title, 1.28),
    "--eyebrow-tracking": rpx(tokens.eyebrowSize, 0.2),
    "--ai-gradient": `linear-gradient(${tokens.aiGradientAngle},${tokens.aiGradientStart},${tokens.aiGradientEnd})`,
    // 弹层遮罩：由文字主色降透明度得到，亮色主题自然得到深遮罩、暗色主题得到浅遮罩
    "--mask": withAlpha(tokens.textPrimary, 0.45),
    // 骨架屏与柔性分割线（方案 2.7）：必须跟随主题明暗，常量化会让暗色主题的骨架屏
    // 变成一块比底色更亮的白斑。故由文字主色降透明度派生。
    "--skeleton-base": withAlpha(tokens.textPrimary, 0.06),
    "--skeleton-shine": withAlpha(tokens.cardBackground, 0.55),
    "--divider-soft": withAlpha(tokens.textPrimary, 0.06),
    // 黏土内高光（方案 J 四层里的第一层）。按 cardBackground 明度插值：
    // 白底取 .95 得到饱满凸起，深底降到 .10 只留一丝转折。其余三层是常量，
    // 见 shadowVars() 的 --shadow-clay-body。与 --skeleton-base 是同一类问题。
    "--clay-highlight": clayHighlight(tokens.cardBackground, tokens.background),
    // 让写实照片「嵌进」黏土表面，缓解卡通容器与真实照片的割裂
    "--shadow-clay-inset": `inset 0 6rpx 18rpx ${withAlpha(tokens.textPrimary, 0.28)}`,
    // 玻璃面板把手宽度（需求 theme-2.md 5.1）
    "--glass-handle-width": rpx(pad, 2),
    // 档位切换时长：cute 稍慢，其余统一 320ms。缓动是常量，见 CONSTANT_VARS
    "--glass-duration": themeId === "cute" ? "360ms" : "320ms"
  };
}

/**
 * 常量变量串。
 *
 * 自定义 tabbar 渲染在页面视图树之外，继承不到 app.wxss 的 `page{}` 声明，
 * 因此它必须自行注入这批常量 —— 页面则由 app.wxss 提供，无需重复下发。
 */
function buildConstantVars() {
  return Object.keys(CONSTANT_VARS).map((name) => `${name}:${CONSTANT_VARS[name]}`).join(";");
}

/** 组装 `page-style` 用的 CSS 变量串。 */
function buildCssVars(tokens, themeId) {
  const parts = [];
  for (const key of TOKEN_KEYS) {
    if (JS_ONLY_TOKENS.indexOf(key) >= 0) continue;
    parts.push(`${toCssVarName(key)}:${tokens[key]}`);
  }
  const derived = deriveScale(tokens, themeId);
  for (const name of Object.keys(derived)) parts.push(`${name}:${derived[name]}`);
  return parts.join(";");
}

module.exports = { TOKEN_SPEC, TOKEN_KEYS, ANIMATION_TYPES, NAV_TEXT_STYLES, JS_ONLY_TOKENS, GLASS_EASING, CONSTANT_VARS, validateTokens, toCssVarName, deriveScale, buildCssVars, buildConstantVars, withAlpha };
