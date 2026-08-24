/*
 * 全站可变文案与常量的单一来源（方案第 3 章末）。
 *
 * 原型里这些散在 HTML 各处：品牌名出现 4 次、导航项在桌面下拉与移动面板各写一份。
 * 集中后收口只改这个文件，且两个菜单从同一个数组渲染 —— 原型里它们是手写的两份，
 * 改一个忘一个不会报错。
 *
 * **占位口径与方案第 10 章的一处偏离**：方案表格写的是把 `{{BRAND_NAME}}` /
 * `{{SITE_URL}}` 字面量放进这里。字面量渲染到页面上会显示成「{{BRAND_NAME}}」，
 * 首屏当场破相，也过不了第 13 章第 1 步的逐像素比对。因此这里放**可渲染的占位值**
 * （品牌名沿用原型的「宠物星尘」，域名沿用 example 占位域），收口靠三件事定位：
 *   ① 本文件的 PLACEHOLDERS 清单，② 页面上的 data-placeholder 属性（可 grep），
 *   ③ SITE_URL 支持用环境变量覆盖，不必改代码。
 */

/** 品牌名。收口项 1–8，页面上标 data-placeholder="brand-name"。 */
export const BRAND_NAME = "宠物星尘";

/**
 * 站点根 URL，无末尾斜杠。收口项 9–12。
 *
 * astro.config.mjs 的 `site` 读同一个环境变量 —— 两处必须一致，
 * 否则 canonical 与 sitemap 会分叉（方案 7.1：逐字一致是硬要求）。
 * 构建时用 `SITE_URL=https://真实域名 pnpm build` 即可，无需改代码。
 */
export const SITE_URL = (import.meta.env.SITE_URL || "https://petbaby.example.com").replace(/\/+$/, "");

/** 一句话产品说明。用在首页 meta description、RSS、llms.txt。 */
export const SITE_TAGLINE = "把每一张宠物照片，变成值得留住的作品。";

export const SITE_DESCRIPTION =
  "上传一张宠物日常照片，几分钟拿到身份证、电影海报、时光画册与 AI 肖像。图文、AI、视频与纪念共 10 种玩法，在微信小程序内完成。";

/**
 * 顶栏菜单与移动面板共用的导航项。
 *
 * 前 7 项是原型的锚点（顺序不动）。第 8 项「文章」是方案 7.6 要求的站内入口 ——
 * 没有它文章模块是孤岛，搜索引擎抓得到但站内权重传不过去。
 *
 * **加项时要同步移动面板的逐项入场 delay**：原型的 `.mobile-menu-nav a:nth-child(n)`
 * 只写到 7，第 8 条在 src/styles/site-additions.css 里补（不改 site.css）。
 */
export const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "首页", href: "/#home" },
  { label: "核心玩法", href: "/#plays" },
  { label: "三类玩法", href: "/#services" },
  { label: "AI 肖像", href: "/#portrait" },
  { label: "作品展示", href: "/#works" },
  { label: "星尘纪念", href: "/#memorial" },
  { label: "联系我们", href: "/#contact" },
  { label: "文章", href: "/blog/" },
];

/** 页脚四栏。第一栏是品牌块，其余三栏是链接列表。 */
export const FOOTER_COLUMNS: ReadonlyArray<{
  id: string;
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    id: "footer-plays",
    title: "玩法",
    links: [
      { label: "宠物身份证", href: "/#plays" },
      { label: "宠物电影海报", href: "/#plays" },
      { label: "宠物时光画册", href: "/#plays" },
      { label: "AI 宠物肖像", href: "/#portrait" },
      { label: "宠物记忆短片", href: "/#services" },
    ],
  },
  {
    id: "footer-memorial",
    title: "纪念",
    links: [
      { label: "纪念册", href: "/#memorial" },
      { label: "纪念视频", href: "/#memorial" },
      { label: "星尘纪念页", href: "/#memorial" },
      { label: "成长对比图", href: "/#memorial" },
    ],
  },
  {
    id: "footer-about",
    title: "关于",
    links: [
      { label: "产品介绍", href: "/#home" },
      { label: "作品展示", href: "/#works" },
      { label: "文章", href: "/blog/" },
      { label: "联系我们", href: "/#contact" },
      // 原型里这两条指向 #home（死链），现在指向真页面（方案 4 章 / 11.1 章）
      { label: "用户协议", href: "/legal/terms/" },
      { label: "隐私政策", href: "/legal/privacy/" },
    ],
  },
];

/** 页脚底部的法务小链接。 */
export const FOOTER_LEGAL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "隐私", href: "/legal/privacy/" },
  { label: "条款", href: "/legal/terms/" },
];

/**
 * ICP 备案号。收口时替换成真实号码，并按要求链到 https://beian.miit.gov.cn/。
 * 备案是国内服务器托管的前置条件，没有备案域名解析不了（方案 11.1）。
 */
export const ICP_RECORD: { text: string; href: string | null } = {
  text: "ICP 备案号待补充",
  href: null,
};

/**
 * 小程序码：全站唯一的转化出口，三个触点共用这一个文件（方案 6.5）。
 *
 * `src` 指向的文件不存在时三处都渲染虚线占位框 —— 规格 7.4：缺图只留文字排版，
 * 不放占位色块。`available` 是手工开关：静态构建没法探测 public/ 下的文件，
 * 放进去后把它改成 true。
 *
 * 真实图要求：PNG ≥430×430、无额外白边、不做有损压缩（二维码压过度会扫不出）。
 */
export const MINIPROGRAM_QR = {
  src: "/assets/miniprogram-qr.png",
  alt: `${BRAND_NAME} 微信小程序码`,
  size: 168,
  available: false,
} as const;

/** og:image（1200×630 品牌图，收口项）。缺图时不输出 og:image 标签，不放占位。 */
export const OG_IMAGE: { src: string; available: boolean } = {
  src: "/assets/og-default.png",
  available: false,
};

/**
 * 收口清单（方案第 10 章）。写在代码里而不是只留在文档里，
 * 是为了改这些值时一眼看到还差什么。
 */
export const PLACEHOLDERS = [
  "brand-name：品牌名与 logo SVG（顶栏 26/36/40px、页脚 32/40/44px）",
  "site-url：正式域名，构建时用 SITE_URL 环境变量传入",
  "miniprogram-qr：public/assets/miniprogram-qr.png，PNG ≥430×430，上线硬阻塞",
  "og-image：public/assets/og-default.png，1200×630 品牌图",
  "headline：hero 主标语，现为「留住 / 每一个 / 值得的 / 瞬间」",
  "subhead：hero 副标语",
  "testimonials：第 8 区块用户评价，现为我们自己的设计取舍，署名「示意 · 非用户评价」",
  "trust-timing：信任条「三分钟出片」需确认是否成立",
  "icp-record：ICP 备案号，页脚版权行右侧",
  "legal-terms / legal-privacy：法务两页正文，现为章节骨架 + 未定稿提示条",
] as const;
