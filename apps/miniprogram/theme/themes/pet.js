/**
 * 宠物主场主题（默认）。
 * 白色影像底、珊瑚主操作与薄荷辅助色。
 * L1 调色板仅在本文件内部使用，页面只能引用 L2 语义 token。
 */
module.exports = {
  id: "pet",
  name: "宠物主场",
  description: "珊瑚与薄荷",
  preview: ["#FFFFFF", "#C52D53", "#14776B"],
  // backdrop-filter 不可用时玻璃面板退化为高不透明抽屉（需求 theme-2.md 5.3）
  degrade: { glassBlur: "0", glassBackground: "rgba(24,39,36,.97)" },
  tokens: {
    primary: "#C52D53",
    secondary: "#14776B",
    background: "#FFFFFF",
    surface: "#F1F8F5",
    cardBackground: "#FFFFFF",
    textPrimary: "#23312D",
    textSecondary: "#566B64",
    border: "#D3E4DC",
    divider: "#E4EEE9",

    success: "#26794E",
    warning: "#A85708",
    error: "#B8382A",
    disabled: "#CBDAD3",
    successSurface: "#E8F7EE",
    errorSurface: "#FDEBE7",

    aiGradientStart: "#C52D53",
    aiGradientEnd: "#14776B",
    aiGlow: "rgba(197,45,83,.18)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#C52D53",
    buttonSecondary: "#F1F8F5",
    buttonDisabled: "#E6EEEA",
    buttonPrimaryText: "#FFFFFF",
    buttonSecondaryText: "#23312D",
    buttonRadius: "999rpx",

    cardRadius: "16rpx",
    cardShadow: "0 4rpx 16rpx rgba(28,65,52,.08)",
    cardBlur: "0",
    cardBorder: "2rpx solid #D3E4DC",
    cardRadiusVariant: "16rpx",
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#FFFFFF",
    navBarTextStyle: "black",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    titleLetterSpacing: "0",

    transitionDuration: "240ms",
    animationType: "fade",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: false,

    // 作品确认抽屉使用深色实底，和白色影像流形成清晰层次。
    glassBackground: "rgba(24,39,36,.97)",
    glassBackgroundSolid: "#182724",
    glassBorder: "2rpx solid rgba(255,255,255,.14)",
    glassBlur: "0",
    glassRadius: "24rpx 24rpx 0 0",
    glassShadow: "0 -8rpx 28rpx rgba(24,39,36,.22)",
    glassScrim: "#23312D",
    glassScrimMax: 0.32,
    glassTextPrimary: "#FFFFFF",
    glassTextSecondary: "#DAE5DE",
    glassHandle: "rgba(255,255,255,.4)"
  }
};
