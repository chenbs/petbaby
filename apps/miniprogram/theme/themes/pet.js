/**
 * 宠物主场主题（默认）。
 * 薄荷与淡紫辅助宠物身份展示，操作信息保持清楚。
 * L1 调色板仅在本文件内部使用，页面只能引用 L2 语义 token。
 */
module.exports = {
  id: "pet",
  name: "宠物主场",
  description: "轻盈陪伴",
  preview: ["#F5F9F7", "#197262", "#C7B8E8"],
  // backdrop-filter 不可用时玻璃面板退化为高不透明抽屉（需求 theme-2.md 5.3）
  degrade: { glassBlur: "0", glassBackground: "rgba(245,249,247,.96)" },
  tokens: {
    primary: "#197262",
    secondary: "#C7B8E8",
    background: "#F5F9F7",
    surface: "#EAF3F0",
    cardBackground: "#FFFFFF",
    textPrimary: "#20322D",
    textSecondary: "#4F6861",
    border: "#CFE2DC",
    divider: "#DDEBE6",

    success: "#26794E",
    warning: "#A85708",
    error: "#B8382A",
    disabled: "#CBD8D3",
    successSurface: "#E8F7EE",
    errorSurface: "#FDEBE7",

    aiGradientStart: "#197262",
    aiGradientEnd: "#684888",
    aiGlow: "rgba(25,114,98,.2)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#197262",
    buttonSecondary: "#E3F0EC",
    buttonDisabled: "#E4EEEA",
    buttonPrimaryText: "#F5FFFC",
    buttonSecondaryText: "#20322D",
    buttonRadius: "999rpx",

    cardRadius: "24rpx",
    cardShadow: "0 4rpx 20rpx rgba(40,80,70,.1)",
    cardBlur: "0",
    cardBorder: "2rpx solid #CFE2DC",
    cardRadiusVariant: "24rpx",
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#F5F9F7",
    navBarTextStyle: "black",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 800,
    titleLetterSpacing: "0",

    transitionDuration: "240ms",
    animationType: "fade",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: false,

    // 旧面板交互继续使用，表面换成薄荷白。
    glassBackground: "rgba(245,249,247,.9)",
    glassBackgroundSolid: "#F5F9F7",
    glassBorder: "2rpx solid rgba(25,114,98,.18)",
    glassBlur: "24px",
    glassRadius: "48rpx 48rpx 0 0",
    glassShadow: "0 -12rpx 48rpx rgba(40,80,70,.18)",
    glassScrim: "#20322D",
    glassScrimMax: 0.32,
    glassTextPrimary: "#20322D",
    glassTextSecondary: "#4F6861",
    glassHandle: "rgba(32,50,45,.28)"
  }
};
