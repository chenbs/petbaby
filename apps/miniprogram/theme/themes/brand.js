/**
 * 赛博街机（2026-09 重做，原「内容品牌」；替代评审稿里被否决的「潮玩派对」）。
 *
 * 空间隐喻：深夜霓虹街区里的一台街机，宠物是主角。克制赛博：
 * 冷黑底、**只用一种荧光主色**（柠檬 #D4FF3A），青只做 1px 分色与状态；
 * 不用紫蓝渐变、不用大面积辉光、不堆英文 HUD —— 那是生成式设计最常见的赛博套路。
 * 识别度来自切角、网格底、等宽数字和线框，灰度下也能认出来。
 */
module.exports = {
  id: "brand",
  name: "赛博街机",
  description: "深夜的霓虹街区，宠物是这台街机的主角",
  preview: ["#0E1016", "#D4FF3A", "#3DE8FF"],
  degrade: { glassBlur: "0", glassBackground: "rgba(14,16,22,.97)" },
  skin: {
    "--skin-texture": "linear-gradient(rgba(61,232,255,.045) 1px, transparent 1px), linear-gradient(90deg, rgba(61,232,255,.045) 1px, transparent 1px)",
    "--skin-texture-size": "48rpx 48rpx",
    "--skin-title-font": "inherit",
    "--skin-num-font": "\"SF Mono\", \"Menlo\", \"Roboto Mono\", monospace",
    "--skin-mark": "#D4FF3A",
    "--skin-mark-w": "6rpx",
    "--skin-mark-h": "34rpx",
    "--skin-mark-radius": "0",
    "--skin-photo-frame": "0",
    "--skin-tilt": "0deg",
    "--skin-sticker-tilt": "0deg",
    "--skin-press": "none",
    "--skin-chip-on-bg": "#D4FF3A",
    "--skin-chip-on-text": "#0E1016",
    "--skin-chip-on-border": "#D4FF3A",
    "--skin-sticker-bg": "#D4FF3A",
    "--skin-sticker-text": "#0E1016",
    "--skin-clip": "polygon(0 0, calc(100% - 28rpx) 0, 100% 28rpx, 100% 100%, 28rpx 100%, 0 calc(100% - 28rpx))",
    // 首页模块的主题呈现（2026-10，themes.html 3.3）：转生卡底、按钮投影、胶带、警示色、光晕、头像环、第二贴纸色
    "--skin-hm-bg": "#151922",
    "--skin-hm-sub": "#93A1AD",
    "--skin-btn-shadow": "none",
    "--skin-tape": "transparent",
    "--skin-tape-alt": "transparent",
    "--skin-alert": "#FF4F9A",
    "--skin-glow": "transparent",
    "--skin-avatar-ring": "#3DE8FF",
    "--skin-sticker-alt": "#3DE8FF",
    // 冻干充值面板（2026-10-08）：「多送」角标、加送进度条、首充横幅、选中档位
    "--skin-deal": "#FF4F9A",
    "--skin-deal-2": "#FF7AB4",
    "--skin-deal-text": "#0E1016",
    "--skin-deal-ink": "#FF6FAE",
    "--skin-deal-base": "#3A4354",
    "--skin-fc-bg": "linear-gradient(90deg, rgba(212,255,58,.12), rgba(212,255,58,.02))",
    "--skin-fc-text": "#EAF2F5",
    "--skin-fc-sub": "#93A1AD",
    "--skin-fc-ink": "#FF6FAE",
    "--skin-tier-on-bg": "rgba(212,255,58,.07)",
    "--skin-tier-on-border": "#D4FF3A",
    // 以下覆盖同名常量（圆角 / 阴影），只在本皮肤的页面子树内生效
    "--skin-press-shadow": "-4rpx 0 0 #FF4F9A, 4rpx 0 0 #3DE8FF",
    "--skin-btn-clip": "polygon(0 0, calc(100% - 18rpx) 0, 100% 18rpx, 100% 100%, 18rpx 100%, 0 calc(100% - 18rpx))",
    "--radius-image-thumb": "0",
    "--radius-image-hero": "0",
    "--radius-pill": "4rpx",
    "--radius-sm": "2rpx",
    "--radius-md": "4rpx",
    "--radius-lg": "4rpx",
    "--shadow-card": "0 0 0 2rpx #2A3140",
    "--shadow-image": "none",
    "--shadow-float": "0 0 0 2rpx #D4FF3A",
    "--shadow-press": "0 0 0 2rpx #3DE8FF"
  },
  tokens: {
    primary: "#D4FF3A",
    secondary: "#3DE8FF",
    background: "#0E1016",
    surface: "#151922",
    cardBackground: "#1B2029",
    textPrimary: "#EAF2F5",
    textSecondary: "#93A1AD",
    border: "#2A3140",
    divider: "#222834",

    success: "#4FE3A1",
    warning: "#FFD23F",
    error: "#FF5C7A",
    disabled: "#3A4252",
    successSurface: "rgba(79,227,161,.14)",
    errorSurface: "rgba(255,92,122,.16)",

    aiGradientStart: "#D4FF3A",
    aiGradientEnd: "#3DE8FF",
    aiGlow: "rgba(212,255,58,.22)",
    aiGradientAngle: "120deg",

    buttonPrimary: "#D4FF3A",
    buttonSecondary: "#151922",
    buttonDisabled: "#2A3140",
    buttonPrimaryText: "#0E1016",
    buttonSecondaryText: "#EAF2F5",
    buttonRadius: "4rpx",

    cardRadius: "4rpx",
    // 暗底上投影不可见，层次靠 1px 线框与明度差建立，不发光
    cardShadow: "none",
    cardBlur: "0",
    cardBorder: "2rpx solid #2A3140",
    cardRadiusVariant: "4rpx",
    borderHighlight: "0 solid transparent",

    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "190rpx",
    navBarBackground: "#0E1016",
    navBarTextStyle: "white",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 800,
    titleLetterSpacing: "0",

    transitionDuration: "160ms",
    animationType: "fade",
    transitionEasing: "cubic-bezier(.2,0,0,1)",
    glowAnimation: false,

    // 抽屉：冷黑磨砂，顶边一道荧光细线
    glassBackground: "rgba(14,16,22,.94)",
    glassBackgroundSolid: "#0E1016",
    glassBorder: "2rpx solid rgba(212,255,58,.22)",
    glassBlur: "20px",
    glassRadius: "8rpx 8rpx 0 0",
    glassShadow: "0 -12rpx 40rpx rgba(0,0,0,.6)",
    glassScrim: "#0E1016",
    glassScrimMax: 0.45,
    glassTextPrimary: "#EAF2F5",
    glassTextSecondary: "#93A1AD",
    glassHandle: "rgba(234,242,245,.3)"
  }
};
