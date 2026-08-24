/**
 * 极简高级亮色。
 * 关键词：高级、专业、品牌感；参照 Apple / Linear / Notion。
 * 不出现贴纸、印章、双线描边；靠留白与细边框划分层级。
 */
const palette = {
  ink900: "#111111",
  white: "#FFFFFF",
  grey50: "#FAFAFA",
  grey100: "#F3F4F6",
  grey200: "#E5E7EB",
  grey300: "#D1D5DB",
  // grey500(#6B7280) 在 grey50 页底上是 4.63:1，只够 3:1 的次级门槛而已。
  // 次级文字承担 .muted / .small / .stat-label 共 40 余处，是本皮肤信息量最大的
  // 一层，压到 5.4:1 才与「专业克制」的清晰度相称。
  grey600: "#5F6875",
  blue600: "#2563EB",
  violet600: "#7C3AED",
  green700: "#10804F",
  amber700: "#B45309",
  red700: "#B42318",
  green50: "#F0FDF4",
  red50: "#FEF2F2"
};

module.exports = {
  id: "light",
  name: "极简亮色",
  description: "专业克制",
  preview: [palette.white, palette.ink900, palette.blue600],
  degrade: { glassBlur: "0", glassBackground: "rgba(255,255,255,.94)" },
  tokens: {
    primary: palette.ink900,
    secondary: palette.blue600,
    // 页底取浅灰、卡片留纯白：删掉卡片描边后（UI 重构方案 3.1）纯白底 + 纯白卡会让
    // 卡片彻底消失，低透明度阴影在纯白上也撑不起分离。灰底白卡是 Apple/Linear 的
    // 标准做法，与本皮肤「专业克制」的人格一致。
    background: palette.grey50,
    surface: palette.grey100,
    cardBackground: palette.white,
    textPrimary: palette.ink900,
    textSecondary: palette.grey600,
    border: palette.grey200,
    divider: palette.grey100,

    success: palette.green700,
    warning: palette.amber700,
    error: palette.red700,
    disabled: palette.grey300,
    successSurface: palette.green50,
    errorSurface: palette.red50,

    aiGradientStart: palette.blue600,
    aiGradientEnd: palette.violet600,
    aiGlow: "rgba(37,99,235,.18)",
    aiGradientAngle: "120deg",

    buttonPrimary: palette.ink900,
    buttonSecondary: palette.white,
    buttonDisabled: palette.grey100,
    buttonPrimaryText: palette.white,
    buttonSecondaryText: palette.ink900,
    buttonRadius: "14rpx",

    // 16rpx 是本皮肤的身份值（见 CLAUDE.md 的 light 16 / cute 24 / glass 28），
    // 同时正好是 --radius-sm。四套里最小，克制感的来源之一，不动。
    cardRadius: "16rpx",
    // 与 cute 同理换成暖褐双层：--card-shadow 仍有三页直接引用，
    // 纯黑单层在灰底白卡上几乎看不见，卡片会重新「消失」。
    cardShadow: "0 2rpx 8rpx -2rpx rgba(60,35,20,.08),0 20rpx 40rpx -28rpx rgba(60,35,20,.2)",
    cardBlur: "0",
    cardBorder: "2rpx solid #E5E7EB",
    cardRadiusVariant: "16rpx",
    // 页底改灰、卡片留白后，分离由 --shadow-card 承担，不再需要描边
    borderHighlight: "0 solid transparent",

    pagePadding: "40rpx",
    sectionSpacing: "64rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: palette.white,
    navBarTextStyle: "black",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    // 本皮肤参照 Apple / Linear，负字距是那套排版最显著的特征，
    // 且 ink900 在 44rpx 上收紧不会粘连。取阶梯里的 --ls-tight。
    titleLetterSpacing: "-0.02em",

    transitionDuration: "180ms",
    animationType: "fade",
    transitionEasing: "ease",
    glowAnimation: false,

    // 沉浸式玻璃面板：白色磨砂 + 克制圆角
    glassBackground: "rgba(255,255,255,.78)",
    glassBackgroundSolid: palette.white,
    glassBorder: "2rpx solid rgba(255,255,255,.6)",
    glassBlur: "28px",
    glassRadius: "40rpx 40rpx 0 0",
    glassShadow: "0 -12rpx 48rpx rgba(20,20,24,.18)",
    glassScrim: "#101014",
    glassScrimMax: 0.30,
    glassTextPrimary: "#1A1A1A",
    glassTextSecondary: "#5A5A60",
    glassHandle: "rgba(26,26,26,.24)"
  }
};
