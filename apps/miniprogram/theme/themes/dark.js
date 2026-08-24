/**
 * 极简高级暗色。
 * 关键词：高级、沉浸、夜间创作；参照 Apple Dark Mode / 摄影类应用。
 * 图片卡取消内边距、贴边展示；AI 控件加霓虹描边与外发光。
 */
const palette = {
  violet400: "#8B7BFF",
  // 选中态 tab、.accent、.tag-accent 都把 primary 当文字压在 ink700 卡面上。
  // violet400 在那里是 5.23:1，够用但偏闷；提一档让霓虹人格更立得住，
  // 同时 ink900 压在它上面仍有 6.88:1，.btn-primary 不受影响。
  violet300: "#9B8DFF",
  blue400: "#5B8CFF",
  ink900: "#0F1115",
  ink800: "#14171E",
  ink700: "#181B22",
  ink600: "#1E222A",
  ink500: "#262A33",
  ink400: "#3A3F4A",
  fog50: "#F5F6F8",
  fog400: "#9BA3AF",
  green400: "#3DD68C",
  amber400: "#F5B547",
  red400: "#FF6A5E"
};

module.exports = {
  id: "dark",
  name: "极简暗色",
  description: "夜间沉浸",
  preview: [palette.ink900, palette.violet400, palette.blue400],
  degrade: { glassBlur: "0", glassBackground: "rgba(16,16,20,.94)" },
  tokens: {
    primary: palette.violet300,
    secondary: palette.blue400,
    background: palette.ink900,
    surface: palette.ink800,
    cardBackground: palette.ink700,
    textPrimary: palette.fog50,
    textSecondary: palette.fog400,
    border: palette.ink500,
    divider: palette.ink600,

    success: palette.green400,
    warning: palette.amber400,
    error: palette.red400,
    disabled: palette.ink400,
    successSurface: "rgba(61,214,140,.14)",
    errorSurface: "rgba(255,106,94,.16)",

    aiGradientStart: palette.violet400,
    aiGradientEnd: palette.blue400,
    aiGlow: "rgba(139,123,255,.5)",
    aiGradientAngle: "135deg",

    buttonPrimary: palette.violet400,
    buttonSecondary: palette.ink600,
    buttonDisabled: palette.ink500,
    buttonPrimaryText: palette.ink900,
    buttonSecondaryText: palette.fog50,
    buttonRadius: "16rpx",

    // 卡片圆角是主题身份值、刻意不进 --radius-* 阶梯（见 CLAUDE.md）。
    // 四套形成 16 / 18 / 24 / 28 的递进，dark 紧挨 light 表达同族的克制，
    // 改成 24 会与 cute 撞值、丢掉这一档辨识度，故保持 18。
    cardRadius: "18rpx",
    // 暗底上唯一真正可见的阴影是「更黑」，故保留纯黑基色（暖褐在这里等于没有），
    // 但拆成双层：贴身一层收边界，扩散一层托出浮起感。
    cardShadow: "0 4rpx 12rpx -2rpx rgba(0,0,0,.5),0 24rpx 48rpx -24rpx rgba(0,0,0,.72)",
    cardBlur: "0",
    cardBorder: "2rpx solid #262A33",
    cardRadiusVariant: "18rpx",
    // 暗底上暖褐阴影几乎不可见，层级靠顶部高光边建立（方案 2.4）
    borderHighlight: "2rpx solid rgba(255,255,255,.08)",

    // 36 / 56 都不在阶梯上。页边距取 32（与 cute / glass 齐），区块间距取 48。
    // 「沉浸」由 pageBottomSafe 与暗色本身表达，不靠零碎的间距差异。
    pagePadding: "32rpx",
    sectionSpacing: "48rpx",
    pageBottomSafe: "186rpx",
    navBarBackground: palette.ink900,
    navBarTextStyle: "white",

    titleSize: "44rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "20rpx",
    titleWeight: 700,
    // 与 light 同为「极简」一族，共用 --ls-tight；差异留给配色与霓虹动效。
    titleLetterSpacing: "-0.02em",

    transitionDuration: "200ms",
    animationType: "neon",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: true,

    // 沉浸式玻璃面板：近黑玻璃 + 高遮罩，适配 OLED
    glassBackground: "rgba(12,12,18,.72)",
    glassBackgroundSolid: "#101014",
    glassBorder: "2rpx solid rgba(255,255,255,.14)",
    glassBlur: "30px",
    glassRadius: "36rpx 36rpx 0 0",
    glassShadow: "0 -16rpx 56rpx rgba(0,0,0,.6)",
    glassScrim: "#000000",
    glassScrimMax: 0.45,
    glassTextPrimary: palette.fog50,
    glassTextSecondary: "rgba(245,245,247,.72)",
    glassHandle: "rgba(245,245,247,.3)"
  }
};
