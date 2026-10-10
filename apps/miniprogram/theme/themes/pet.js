/**
 * 橘子汽水（默认，2026-09 重做，原「宠物主场」）。
 *
 * 空间隐喻：阳光很好的客厅。软糖 Pop：大圆角、暖色柔影、浅橘按钮配墨蓝字。
 * 浅橘 #FF9A52 只做按钮底、大色块；文字强调、选中描边、数字统一用焦橘 #B7401A
 * （#FF9A52 在白底上只有 2.10:1，不能当文字色）。
 * 方案见 docs/ui-refactor/2026-09-29-产品UIUX评审/主题系统重设计方案.md。
 * L1 调色板仅在本文件内部使用，页面只能引用 L2 语义 token。
 */
module.exports = {
  id: "pet",
  name: "橘子汽水",
  description: "阳光很好的客厅，软糖一样圆",
  preview: ["#FFFAF3", "#FF9A52", "#1F2540"],
  degrade: { glassBlur: "0", glassBackground: "rgba(255,250,243,.98)" },
  /*
   * 皮肤层（结构差异，不进注入串）：由 app.wxss 的 `.skin-pet{}` 逐字声明，validate 第 11 项比对。
   * 页面根节点带 `skin-pet` 类后，组件读 `var(--skin-*)` 得到这套材质与装饰。
   */
  skin: {
    "--skin-texture": "none",
    "--skin-texture-size": "auto",
    "--skin-title-font": "inherit",
    "--skin-num-font": "inherit",
    "--skin-mark": "#FF9A52",
    "--skin-mark-w": "16rpx",
    "--skin-mark-h": "16rpx",
    "--skin-mark-radius": "999rpx",
    "--skin-photo-frame": "0",
    "--skin-tilt": "0deg",
    "--skin-sticker-tilt": "-4deg",
    "--skin-press": "scale(.96)",
    "--skin-chip-on-bg": "#1F2540",
    "--skin-chip-on-text": "#FFFFFF",
    "--skin-chip-on-border": "#1F2540",
    "--skin-sticker-bg": "#FFD45C",
    "--skin-sticker-text": "#1F2540",
    "--skin-clip": "none",
    // 首页模块的主题呈现（2026-10，themes.html 3.3）：转生卡底、按钮投影、胶带、警示色、光晕、头像环、第二贴纸色
    "--skin-hm-bg": "linear-gradient(150deg, #FFB273 0%, #FFD0A1 50%, #FFE8D2 100%)",
    "--skin-hm-sub": "#3B3F57",
    "--skin-btn-shadow": "0 16rpx 32rpx -16rpx rgba(255,154,82,.75)",
    "--skin-tape": "transparent",
    "--skin-tape-alt": "transparent",
    "--skin-alert": "#B7401A",
    "--skin-glow": "transparent",
    "--skin-avatar-ring": "#FFD0A1",
    "--skin-sticker-alt": "#CFE6FF",
    // 冻干充值面板（2026-10-08）：「多送」角标、加送进度条、首充横幅、选中档位
    "--skin-deal": "#D23A1E",
    "--skin-deal-2": "#E8573A",
    "--skin-deal-text": "#FFFFFF",
    "--skin-deal-ink": "#B7401A",
    "--skin-deal-base": "#E6D3C0",
    "--skin-fc-bg": "linear-gradient(150deg, #FFB273 0%, #FFD0A1 55%, #FFE8D2 100%)",
    "--skin-fc-text": "#1F2540",
    "--skin-fc-sub": "#3B3F57",
    "--skin-fc-ink": "#9A3212",
    "--skin-tier-on-bg": "#FFF6EC",
    "--skin-tier-on-border": "#FF9A52",
    // 以下覆盖同名常量（圆角 / 阴影），只在本皮肤的页面子树内生效
    "--skin-press-shadow": "none",
    "--skin-btn-clip": "none",
    "--radius-image-thumb": "32rpx",
    "--radius-image-hero": "40rpx"
  },
  tokens: {
    primary: "#B7401A",
    secondary: "#2A5FE8",
    background: "#FFFAF3",
    surface: "#FFF1E0",
    cardBackground: "#FFFFFF",
    textPrimary: "#1F2540",
    textSecondary: "#5B6178",
    border: "#F3E3D2",
    divider: "#F6ECE0",

    success: "#23794A",
    warning: "#A15A00",
    error: "#C0352B",
    disabled: "#D9CFC4",
    successSurface: "#E3F4EA",
    errorSurface: "#FDECE8",

    aiGradientStart: "#FF9A52",
    aiGradientEnd: "#FFB273",
    aiGlow: "rgba(255,154,82,.25)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#FF9A52",
    buttonSecondary: "#FFF1E0",
    buttonDisabled: "#F1E6DA",
    buttonPrimaryText: "#1F2540",
    buttonSecondaryText: "#1F2540",
    buttonRadius: "999rpx",

    cardRadius: "40rpx",
    cardShadow: "0 4rpx 16rpx -4rpx rgba(60,35,20,.1),0 32rpx 64rpx -36rpx rgba(60,35,20,.28)",
    cardBlur: "0",
    cardBorder: "0 solid transparent",
    cardRadiusVariant: "32rpx",
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#FFFAF3",
    navBarTextStyle: "black",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 800,
    titleLetterSpacing: "0",

    transitionDuration: "240ms",
    animationType: "bounce",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: false,

    // 作品确认抽屉：奶油实底 + 大圆角，与客厅的暖调一致
    glassBackground: "rgba(255,250,243,.97)",
    glassBackgroundSolid: "#FFFAF3",
    glassBorder: "2rpx solid rgba(255,255,255,.6)",
    glassBlur: "0",
    glassRadius: "48rpx 48rpx 0 0",
    glassShadow: "0 -8rpx 28rpx rgba(60,35,20,.18)",
    glassScrim: "#1F2540",
    glassScrimMax: 0.32,
    glassTextPrimary: "#1F2540",
    glassTextSecondary: "#5B6178",
    glassHandle: "rgba(31,37,64,.24)"
  }
};
