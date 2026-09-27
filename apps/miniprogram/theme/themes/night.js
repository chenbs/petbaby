/**
 * 夜间观影主题。
 * 中性深底与柔和珊瑚强调，保持照片内容完整而清晰。
 */
const palette = {
  ink400: "#3A3F4A",
  green400: "#3DD68C",
  amber400: "#F5B547",
  red400: "#FF6A5E"
};

module.exports = {
  id: "night",
  name: "夜间观影",
  description: "安静沉浸",
  preview: ["#171B1B", "#F3A1B6", "#F5F7F5"],
  degrade: { glassBlur: "0", glassBackground: "rgba(23,27,27,.96)" },
  tokens: {
    primary: "#F3A1B6",
    secondary: "#9AD1C4",
    background: "#171B1B",
    surface: "#202727",
    cardBackground: "#293131",
    textPrimary: "#F5F7F5",
    textSecondary: "#B6C4C0",
    border: "#3B4946",
    divider: "#35413E",

    success: palette.green400,
    warning: palette.amber400,
    error: palette.red400,
    disabled: palette.ink400,
    successSurface: "rgba(61,214,140,.14)",
    errorSurface: "rgba(255,106,94,.16)",

    aiGradientStart: "#F3A1B6",
    aiGradientEnd: "#9AD1C4",
    aiGlow: "rgba(243,161,182,.38)",
    aiGradientAngle: "135deg",

    buttonPrimary: "#F3A1B6",
    buttonSecondary: "#2F3A3A",
    buttonDisabled: "#3B4946",
    buttonPrimaryText: "#171B1B",
    buttonSecondaryText: "#F5F7F5",
    buttonRadius: "16rpx",

    cardRadius: "20rpx",
    // 暗底上唯一真正可见的阴影是「更黑」，故保留纯黑基色（暖褐在这里等于没有），
    // 但拆成双层：贴身一层收边界，扩散一层托出浮起感。
    cardShadow: "0 4rpx 12rpx -2rpx rgba(0,0,0,.5),0 24rpx 48rpx -24rpx rgba(0,0,0,.72)",
    cardBlur: "0",
    cardBorder: "2rpx solid #3B4946",
    cardRadiusVariant: "18rpx",
    // 暗底上暖褐阴影几乎不可见，层级靠顶部高光边建立（方案 2.4）
    borderHighlight: "2rpx solid rgba(255,255,255,.08)",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#171B1B",
    navBarTextStyle: "white",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    titleLetterSpacing: "0",

    transitionDuration: "200ms",
    animationType: "fade",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: false,

    // 沉浸式玻璃面板：近黑玻璃 + 高遮罩，适配 OLED
    glassBackground: "rgba(23,27,27,.9)",
    glassBackgroundSolid: "#171B1B",
    glassBorder: "2rpx solid rgba(255,255,255,.14)",
    glassBlur: "30px",
    glassRadius: "36rpx 36rpx 0 0",
    glassShadow: "0 -16rpx 56rpx rgba(0,0,0,.6)",
    glassScrim: "#171B1B",
    glassScrimMax: 0.45,
    glassTextPrimary: "#F5F7F5",
    glassTextSecondary: "#B6C4C0",
    glassHandle: "rgba(245,247,245,.3)"
  }
};
