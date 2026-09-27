/**
 * 内容品牌主题。
 * 官网参考的白、墨色、玫红，靠清楚的内容层级与图片建立识别。
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
  id: "brand",
  name: "内容品牌",
  description: "官网参考",
  preview: ["#FAFAFA", "#1C1C1C", "#B12863"],
  degrade: { glassBlur: "0", glassBackground: "rgba(255,255,255,.94)" },
  tokens: {
    primary: "#B12863",
    secondary: "#1C1C1C",
    // 页底取浅灰、卡片留纯白：删掉卡片描边后（UI 重构方案 3.1）纯白底 + 纯白卡会让
    // 卡片彻底消失，低透明度阴影在纯白上也撑不起分离。灰底白卡是 Apple/Linear 的
    // 标准做法，与本皮肤「专业克制」的人格一致。
    background: palette.grey50,
    surface: palette.grey100,
    cardBackground: palette.white,
    textPrimary: "#1C1C1C",
    textSecondary: palette.grey600,
    border: palette.grey200,
    divider: palette.grey100,

    success: palette.green700,
    warning: palette.amber700,
    error: palette.red700,
    disabled: palette.grey300,
    successSurface: palette.green50,
    errorSurface: palette.red50,

    aiGradientStart: "#B12863",
    aiGradientEnd: "#673955",
    aiGlow: "rgba(177,40,99,.18)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#B12863",
    buttonSecondary: palette.white,
    buttonDisabled: palette.grey100,
    buttonPrimaryText: "#FFF7FA",
    buttonSecondaryText: "#1C1C1C",
    buttonRadius: "14rpx",

    // 16rpx 是内容品牌主题的克制圆角，展示图片仍单独用共享图片圆角。
    cardRadius: "16rpx",
    // --card-shadow 仍有三页直接引用，
    // 纯黑单层在灰底白卡上几乎看不见，卡片会重新「消失」。
    cardShadow: "0 2rpx 8rpx -2rpx rgba(60,35,20,.08),0 20rpx 40rpx -28rpx rgba(60,35,20,.2)",
    cardBlur: "0",
    cardBorder: "2rpx solid #E5E7EB",
    cardRadiusVariant: "16rpx",
    // 页底改灰、卡片留白后，分离由 --shadow-card 承担，不再需要描边
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#FAFAFA",
    navBarTextStyle: "black",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    // 标题字距与其余主题一致，切换时保持排版尺寸稳定。
    titleLetterSpacing: "0",

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
    glassScrim: "#1C1C1C",
    glassScrimMax: 0.30,
    glassTextPrimary: "#1A1A1A",
    glassTextSecondary: "#5A5A60",
    glassHandle: "rgba(26,26,26,.24)"
  }
};
