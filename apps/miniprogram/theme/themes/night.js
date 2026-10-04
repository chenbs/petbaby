/**
 * 星夜影院（2026-09 重做，原「夜间观影」）。
 *
 * 空间隐喻：关灯后的家庭影院，只放你们的片子。暗场：深紫黑、金色主按钮、
 * 胶片齿孔与星尘、毛玻璃抽屉（唯一开 blur 的主题）。与赛博街机的区分：
 * 这里暖金、圆角、柔光、慢节奏；赛博是冷黑、直角切角、线框、快节奏。
 */
module.exports = {
  id: "night",
  name: "星夜影院",
  description: "关灯后的家庭影院，只放你们的片子",
  preview: ["#141218", "#FFC94A", "#F6F1E7"],
  degrade: { glassBlur: "0", glassBackground: "rgba(20,18,24,.96)" },
  skin: {
    "--skin-texture": "radial-gradient(2rpx 2rpx at 20% 12%, rgba(255,255,255,.4), transparent), radial-gradient(2rpx 2rpx at 70% 30%, rgba(255,255,255,.28), transparent), radial-gradient(3rpx 3rpx at 40% 62%, rgba(255,201,74,.3), transparent)",
    "--skin-texture-size": "440rpx 520rpx",
    "--skin-title-font": "inherit",
    "--skin-num-font": "inherit",
    "--skin-mark": "#FFC94A",
    "--skin-mark-w": "32rpx",
    "--skin-mark-h": "4rpx",
    "--skin-mark-radius": "999rpx",
    "--skin-photo-frame": "0",
    "--skin-tilt": "0deg",
    "--skin-sticker-tilt": "0deg",
    "--skin-press": "none",
    "--skin-chip-on-bg": "#262230",
    "--skin-chip-on-text": "#FFC94A",
    "--skin-chip-on-border": "#FFC94A",
    "--skin-sticker-bg": "#FFC94A",
    "--skin-sticker-text": "#1A1508",
    "--skin-clip": "none",
    // 首页模块的主题呈现（2026-10，themes.html 3.3）：转生卡底、按钮投影、胶带、警示色、光晕、头像环、第二贴纸色
    "--skin-hm-bg": "linear-gradient(180deg, #262230, #1A1720)",
    "--skin-hm-sub": "#B8AFA0",
    "--skin-btn-shadow": "0 0 36rpx rgba(255,201,74,.45)",
    "--skin-tape": "transparent",
    "--skin-tape-alt": "transparent",
    "--skin-alert": "#FFC94A",
    "--skin-glow": "rgba(255,201,74,.6)",
    "--skin-avatar-ring": "#FFC94A",
    "--skin-sticker-alt": "#7FE3C4",
    // 以下覆盖同名常量（圆角 / 阴影），只在本皮肤的页面子树内生效
    "--skin-press-shadow": "0 0 24rpx rgba(255,201,74,.4)",
    "--skin-btn-clip": "none",
    "--radius-image-thumb": "20rpx",
    "--radius-image-hero": "28rpx",
    "--shadow-card": "0 0 0 2rpx rgba(255,255,255,.06)",
    "--shadow-image": "0 24rpx 48rpx -24rpx rgba(0,0,0,.72)",
    "--shadow-float": "0 0 36rpx rgba(255,201,74,.25)",
    "--shadow-press": "0 0 0 2rpx rgba(255,201,74,.3)"
  },
  tokens: {
    primary: "#FFC94A",
    secondary: "#7FE3C4",
    background: "#141218",
    surface: "#1E1B24",
    cardBackground: "#262230",
    textPrimary: "#F6F1E7",
    textSecondary: "#B8AFA0",
    border: "#3A3446",
    divider: "#2F2A38",

    success: "#7FE3C4",
    warning: "#FFC94A",
    error: "#FF8A7A",
    disabled: "#3A3446",
    successSurface: "rgba(127,227,196,.14)",
    errorSurface: "rgba(255,138,122,.16)",

    aiGradientStart: "#FFC94A",
    aiGradientEnd: "#FF8A7A",
    aiGlow: "rgba(255,201,74,.35)",
    aiGradientAngle: "135deg",

    buttonPrimary: "#FFC94A",
    buttonSecondary: "#2F2A38",
    buttonDisabled: "#3A3446",
    buttonPrimaryText: "#1A1508",
    buttonSecondaryText: "#F6F1E7",
    buttonRadius: "999rpx",

    cardRadius: "28rpx",
    // 暗底上层级靠顶部高光边而非投影建立（方案 2.4）
    cardShadow: "none",
    cardBlur: "0",
    cardBorder: "2rpx solid #3A3446",
    cardRadiusVariant: "24rpx",
    borderHighlight: "2rpx solid rgba(255,255,255,.08)",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#141218",
    navBarTextStyle: "white",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    titleLetterSpacing: "0",

    transitionDuration: "280ms",
    animationType: "glow",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: false,

    // 抽屉：深紫黑毛玻璃 + 高遮罩，适配 OLED
    glassBackground: "rgba(20,18,24,.86)",
    glassBackgroundSolid: "#141218",
    glassBorder: "2rpx solid rgba(255,201,74,.22)",
    glassBlur: "28px",
    glassRadius: "36rpx 36rpx 0 0",
    glassShadow: "0 -16rpx 56rpx rgba(0,0,0,.6)",
    glassScrim: "#141218",
    glassScrimMax: 0.45,
    glassTextPrimary: "#F6F1E7",
    glassTextSecondary: "#B8AFA0",
    glassHandle: "rgba(246,241,231,.3)"
  }
};
