/**
 * 温馨可爱风（默认主题）。
 * 关键词：宠物、陪伴、治愈、温暖；观感目标像宠物朋友圈。
 * L1 调色板仅在本文件内部使用，页面只能引用 L2 语义 token。
 */
const palette = {
  // 强调色。--primary 既当文字用（.accent / .tag-accent / .companion / 选中态 tab
  // / .seal），又当底色用（.badge / .chip-on / .notice-info / .preview-check，
  // 其上压 --button-primary-text）。两个角色对同一个色号提出相反要求：
  // 原来的糖果粉 #FF9FB5 只满足后者，当文字时在白卡上仅 1.93:1 —— 「陪伴了 N 天」
  // 这种 24rpx 小字实际读不出来。故强调色下沉到玫红 + 近白字，两个角色同时成立。
  // 温馨感改由大面积的奶油底（cream/peach）与 blush 描边承担，那才是观感的主体。
  rose600: "#C4335C",
  rose50: "#FFF5F7",
  cream50: "#FFF8F2",
  cream100: "#FFFDFA",
  peach100: "#FFF1E6",
  white: "#FFFFFF",
  cocoa900: "#3A2C2C",
  cocoa400: "#7A625E",
  blush200: "#F3DCD5",
  blush100: "#F7E7E1",
  amber300: "#FFD166",
  green600: "#26794E",
  // 同时充当 warning 与 AI 渐变终点的焦糖端
  amber700: "#A85708",
  red600: "#B8382A",
  stone300: "#D8CCC8",
  stone200: "#EFE4E0",
  mint50: "#E8F7EE",
  blush50: "#FDEBE7"
};

module.exports = {
  id: "cute",
  name: "温馨可爱",
  description: "陪伴治愈",
  preview: [palette.cream50, palette.rose600, palette.amber300],
  // backdrop-filter 不可用时玻璃面板退化为高不透明抽屉（需求 theme-2.md 5.3）
  degrade: { glassBlur: "0", glassBackground: "rgba(255,248,242,.94)" },
  tokens: {
    primary: palette.rose600,
    secondary: palette.amber300,
    background: palette.cream50,
    surface: palette.cream100,
    cardBackground: palette.white,
    textPrimary: palette.cocoa900,
    textSecondary: palette.cocoa400,
    border: palette.blush200,
    divider: palette.blush100,

    // 语义色统一压到「白卡与自身 surface 上都 ≥4.5:1」。原取值里 success 在 mint50
    // 上只有 3.77:1，而 t-tag 正是把 success 当文字压在 successSurface 上。
    success: palette.green600,
    warning: palette.amber700,
    error: palette.red600,
    disabled: palette.stone300,
    successSurface: palette.mint50,
    errorSurface: palette.blush50,

    // AI 渐变随强调色一同下沉：.btn-ai 的文字取 --button-primary-text（近白），
    // 原先的 pink300→amber200 糖果渐变配近白字只有 1.3:1，必须同步加深。
    // 玫红→焦糖仍是暖色对，未离开「治愈」的色域。
    aiGradientStart: palette.rose600,
    aiGradientEnd: palette.amber700,
    aiGlow: "rgba(196,51,92,.32)",
    aiGradientAngle: "120deg",

    buttonPrimary: palette.rose600,
    buttonSecondary: palette.peach100,
    buttonDisabled: palette.stone200,
    buttonPrimaryText: palette.rose50,
    buttonSecondaryText: palette.cocoa900,
    buttonRadius: "999rpx",

    cardRadius: "24rpx",
    // 旧值是单层粉调阴影，与方案 2.4 的暖褐多层语言不是一套。--card-shadow 仍被
    // interactive / photos / theme 三页直接引用，故改成同色系的双层，
    // 免得这三页与走 --shadow-card 的其余页面明显不同调。
    cardShadow: "0 4rpx 16rpx -4rpx rgba(60,35,20,.1),0 28rpx 56rpx -32rpx rgba(60,35,20,.26)",
    cardBlur: "0",
    cardBorder: "2rpx solid rgba(243,220,213,.9)",
    cardRadiusVariant: "24rpx 24rpx 48rpx 24rpx",
    // 暖底上阴影足够建立层级，不需要高光边
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "180rpx",
    navBarBackground: palette.cream50,
    navBarTextStyle: "black",

    titleSize: "48rpx",
    bodySize: "28rpx",
    // 方案 2.3 的 --fs-sm 是 24rpx。22rpx 是重构前的旧值，压在 1.6 行高下偏挤，
    // 而 .small 承担说明文案与图注共 33 处。
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    // 900 超出方案 2.3 的字重阶梯上限（--fw-black 800），且中文字体多半只有
    // 400/700 两档，900 与 800 渲染同形。回落到阶梯内的最重一档。
    titleWeight: 800,
    // 大字负字距是「精致」基调的主要抓手（方案 2.3）。cute 的字面更圆，
    // 只收 -0.01em，不取 --ls-tight 的 -0.02em，避免圆体粘连。
    titleLetterSpacing: "-0.01em",

    transitionDuration: "240ms",
    animationType: "bounce",
    transitionEasing: "cubic-bezier(.34,1.56,.64,1)",
    glowAnimation: false,

    // 沉浸式玻璃面板：暖白玻璃 + 大不对称圆角 + 柔光投影
    glassBackground: "rgba(255,248,242,.84)",
    glassBackgroundSolid: palette.cream50,
    glassBorder: "2rpx solid rgba(255,255,255,.55)",
    glassBlur: "24px",
    glassRadius: "48rpx 48rpx 0 0",
    glassShadow: "0 -12rpx 48rpx rgba(214,150,150,.28)",
    glassScrim: "#2A1F1F",
    glassScrimMax: 0.32,
    glassTextPrimary: palette.cocoa900,
    glassTextSecondary: palette.cocoa400,
    glassHandle: "rgba(58,44,44,.28)"
  }
};
