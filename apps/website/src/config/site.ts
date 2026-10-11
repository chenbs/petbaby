export const BRAND_NAME = "麻麻抱我";

export const SITE_URL = (import.meta.env.SITE_URL || "https://www.babykitty.cn").replace(/\/+$/, "");

export const SITE_TAGLINE = "宠物照片创作、宠物人化与陪伴记录小程序";

export const SITE_DESCRIPTION =
  "麻麻抱我是宠物照片创作与陪伴记录微信小程序，支持宠物写真、人宠写真、「如果我是人」宠物人化，以及身份证、海报和画册，还可制作陪伴短片、记录日常与成长、创建纪念空间。具体开放功能与费用以小程序内展示为准。";

export const SITE_KEYWORDS = [
  BRAND_NAME,
  "宠物照片创作",
  "宠物艺术写真",
  "人宠写真",
  "宠物人化",
  "如果我是人",
  "宠物身份证",
  "宠物成长记录",
  "宠物纪念空间",
] as const;

export const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "首页", href: "/#home" },
  { label: "小程序功能", href: "/#features" },
  { label: "作品样片", href: "/#works" },
  { label: "怎么用", href: "/#how" },
  { label: "隐私与安心", href: "/#trust" },
  { label: "常见问题", href: "/#faq" },
  { label: "扫码使用", href: "/#contact" },
  { label: "文章", href: "/blog/" },
];

export const FOOTER_COLUMNS: ReadonlyArray<{
  id: string;
  title: string;
  links: ReadonlyArray<{ label: string; href: string }>;
}> = [
  {
    id: "footer-plays",
    title: "玩法",
    links: [
      { label: "宠物写真", href: "/#works" },
      { label: "人宠写真", href: "/#works" },
      { label: "如果我是人", href: "/#works" },
      { label: "身份证、海报与画册", href: "/#features" },
      { label: "陪伴短片", href: "/#features" },
    ],
  },
  {
    id: "footer-memorial",
    title: "记录与纪念",
    links: [
      { label: "日常记录与健康", href: "/#features" },
      { label: "成长时间线", href: "/#features" },
      { label: "年度报告", href: "/#features" },
      { label: "纪念空间", href: "/#features" },
    ],
  },
  {
    id: "footer-about",
    title: "关于",
    links: [
      { label: "常见问题", href: "/#faq" },
      { label: "文章", href: "/blog/" },
      { label: "联系我们", href: "/#contact" },
      { label: "用户协议", href: "/legal/terms/" },
      { label: "隐私政策", href: "/legal/privacy/" },
    ],
  },
];

export const FOOTER_LEGAL_LINKS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "隐私", href: "/legal/privacy/" },
  { label: "条款", href: "/legal/terms/" },
];

export const ICP_RECORD: { text: string; href: string | null } = {
  text: import.meta.env.ICP_RECORD || "备案办理中",
  href: import.meta.env.ICP_RECORD ? "https://beian.miit.gov.cn/" : null,
};

export const MINIPROGRAM_QR = {
  src: "/assets/miniprogram-qr.png",
  alt: `${BRAND_NAME} 微信小程序码`,
  size: 168,
  available: import.meta.env.MINIPROGRAM_QR_AVAILABLE === "true",
} as const;

export const OG_IMAGE: { src: string; available: boolean } = {
  src: "/assets/og-default.png",
  available: true,
};

export const PLACEHOLDERS = ["miniprogram-qr", "icp-record", "legal-operator", "legal-approval"] as const;

export const LEGAL_OPERATOR = import.meta.env.LEGAL_OPERATOR || "";
export const LEGAL_CONTACT = import.meta.env.LEGAL_CONTACT || "";
export const LEGAL_ADDRESS = import.meta.env.LEGAL_ADDRESS || "";
export const LEGAL_APPROVED = import.meta.env.LEGAL_APPROVED === "true";
export const LEGAL_PROCESSOR_DETAILS = import.meta.env.LEGAL_PROCESSOR_DETAILS || "";
export const LEGAL_STORAGE_REGION = import.meta.env.LEGAL_STORAGE_REGION || "";
