/**
 * 透明玻璃科技风。
 * 关键词：AI、未来、科技、高级；观感目标像未来 AI 创作工具。
 * `degrade` 描述 backdrop-filter 不生效时的替代取值，由 ThemeManager 在初始化探测后一次性应用。
 */
const palette = {
  // violet300 供「当文字用」的场合：--primary 压在半透明卡面上（.tag-accent /
  // .accent / 选中态）时，violet400 只有 2.60:1。violet400 保留给渐变与发光，
  // 那两处是大面积色域，不承担字形可读性。
  violet300: "#ADA2FF",
  violet400: "#7C6BFF",
  cyan400: "#37D8F0",
  navy900: "#0B0B24",
  navy800: "#101034",
  navy700: "#1B1B4F",
  navy600: "#221E68",
  navy500: "#2A2760",
  ink50: "#F4F5FF",
  mint400: "#4BE3A2",
  amber400: "#FFC24B",
  // rose400 在半透明卡面上只有 3.69:1，而 t-tag 把 error 当文字用
  rose300: "#FF8E9F"
};

module.exports = {
  id: "glass",
  name: "玻璃科技",
  description: "AI 未来感",
  preview: [palette.navy700, palette.violet400, palette.cyan400],
  degrade: { cardBackground: palette.navy500, surface: "#211E4F", cardBlur: "0", glassBlur: "0", glassBackground: "rgba(33,30,79,.94)" },
  tokens: {
    primary: palette.violet300,
    secondary: palette.cyan400,
    background: `linear-gradient(160deg,${palette.navy700} 0%,${palette.navy600} 45%,${palette.navy800} 100%)`,
    surface: "rgba(255,255,255,.10)",
    cardBackground: "rgba(255,255,255,.15)",
    textPrimary: palette.ink50,
    textSecondary: "rgba(244,245,255,.72)",
    border: "rgba(255,255,255,.22)",
    divider: "rgba(255,255,255,.14)",

    success: palette.mint400,
    warning: palette.amber400,
    error: palette.rose300,
    disabled: "rgba(255,255,255,.28)",
    successSurface: "rgba(75,227,162,.16)",
    errorSurface: "rgba(255,142,159,.18)",

    aiGradientStart: palette.violet400,
    aiGradientEnd: palette.cyan400,
    aiGlow: "rgba(124,107,255,.55)",
    aiGradientAngle: "120deg",

    buttonPrimary: `linear-gradient(120deg,${palette.violet400},${palette.cyan400})`,
    buttonSecondary: "rgba(255,255,255,.12)",
    buttonDisabled: "rgba(255,255,255,.14)",
    buttonPrimaryText: palette.navy900,
    buttonSecondaryText: palette.ink50,
    buttonRadius: "28rpx",

    cardRadius: "28rpx",
    cardShadow: "0 16rpx 48rpx rgba(8,8,40,.45)",
    cardBlur: "20px",
    cardBorder: "2rpx solid rgba(255,255,255,.22)",
    cardRadiusVariant: "28rpx",
    // 玻璃面必须保留描边，否则半透明卡片在深底渐变上失去边界
    borderHighlight: "2rpx solid rgba(255,255,255,.22)",

    pagePadding: "32rpx",
    // 44 不在 --space-* 阶梯上（方案 2.1 的档位是 32 / 48 / 64）。区块间距与
    // .section 的 margin-top 直接绑定，错位会让 glass 与其余主题的纵向节奏对不齐。
    sectionSpacing: "48rpx",
    pageBottomSafe: "180rpx",
    navBarBackground: palette.navy700,
    navBarTextStyle: "white",

    titleSize: "46rpx",
    bodySize: "28rpx",
    smallSize: "24rpx",
    eyebrowSize: "22rpx",
    titleWeight: 800,
    // 正字距是「科技感」的常见写法，但方案 2.3 要求大标题一律负字距 ——
    // 撑开字距会把 46rpx 标题推向松散。科技感改由 --ls-kicker 的英文小标承担
    // （eyebrow 已是四套里最大的 22rpx，那里才是拉字距的位置）。
    titleLetterSpacing: "-0.01em",

    transitionDuration: "280ms",
    animationType: "glow",
    transitionEasing: "cubic-bezier(.22,.61,.36,1)",
    glowAnimation: true,

    // 沉浸式玻璃面板：深色强模糊 + 紫色发光描边
    glassBackground: "rgba(27,27,79,.72)",
    glassBackgroundSolid: "#211E4F",
    glassBorder: "2rpx solid rgba(124,107,255,.45)",
    glassBlur: "36px",
    glassRadius: "40rpx 40rpx 0 0",
    glassShadow: "0 -16rpx 64rpx rgba(8,8,40,.55)",
    glassScrim: "#05051A",
    glassScrimMax: 0.42,
    glassTextPrimary: palette.ink50,
    glassTextSecondary: "rgba(244,245,255,.75)",
    glassHandle: "rgba(244,245,255,.35)"
  }
};
