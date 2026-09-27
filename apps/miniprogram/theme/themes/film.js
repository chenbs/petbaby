/**
 * 暖调胶片主题。
 * 暖白纸面、深墨正文与珊瑚强调色；照片本身保留原色。
 * `degrade` 描述 backdrop-filter 不生效时的替代取值，由 ThemeManager 在初始化探测后一次性应用。
 */
module.exports = {
  id: "film",
  name: "暖调胶片",
  description: "温暖记录",
  preview: ["#F9F7F3", "#B43B4F", "#6B7A55"],
  degrade: { cardBackground: "#FFFDFC", surface: "#F1ECE4", cardBlur: "0", glassBlur: "0", glassBackground: "rgba(249,247,243,.94)" },
  tokens: {
    primary: "#B43B4F",
    secondary: "#6B7A55",
    background: "#F9F7F3",
    surface: "#F1ECE4",
    cardBackground: "#FFFDFC",
    textPrimary: "#242021",
    textSecondary: "#685D5B",
    border: "#DED4C9",
    divider: "#E9E1D8",

    success: "#286847",
    warning: "#975700",
    error: "#B2383C",
    disabled: "#CEC4BC",
    successSurface: "#E7F3EA",
    errorSurface: "#FAEBE9",

    aiGradientStart: "#B43B4F",
    aiGradientEnd: "#76533D",
    aiGlow: "rgba(180,59,79,.18)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#B43B4F",
    buttonSecondary: "#F2E6DD",
    buttonDisabled: "#E6DDD5",
    buttonPrimaryText: "#FFF8F4",
    buttonSecondaryText: "#242021",
    buttonRadius: "24rpx",

    cardRadius: "24rpx",
    cardShadow: "0 4rpx 20rpx rgba(70,45,35,.1)",
    cardBlur: "0",
    cardBorder: "2rpx solid #DED4C9",
    cardRadiusVariant: "24rpx",
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#F9F7F3",
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

    // 旧面板交互继续使用，表面换成暖白纸面。
    glassBackground: "rgba(249,247,243,.92)",
    glassBackgroundSolid: "#F9F7F3",
    glassBorder: "2rpx solid rgba(180,59,79,.18)",
    glassBlur: "24px",
    glassRadius: "40rpx 40rpx 0 0",
    glassShadow: "0 -12rpx 48rpx rgba(90,50,40,.18)",
    glassScrim: "#242021",
    glassScrimMax: 0.30,
    glassTextPrimary: "#242021",
    glassTextSecondary: "#685D5B",
    glassHandle: "rgba(36,32,33,.25)"
  }
};
