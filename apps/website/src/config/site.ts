export const BRAND_NAME = "麻麻抱我";

export const SITE_URL = (import.meta.env.SITE_URL || "https://www.babykitty.cn").replace(/\/+$/, "");

export const SITE_TAGLINE = "把我留在每一段回忆里。";

export const SITE_DESCRIPTION =
  "把我留在每一段回忆里，让我的陪伴，不止今天。从手机里的照片开始，在麻麻抱我创作宠物肖像、海报、画册与陪伴短片，把我最可爱的样子留下。";

export const NAV_ITEMS: ReadonlyArray<{ label: string; href: string }> = [
  { label: "首页", href: "/#home" },
  { label: "日常成册", href: "/#plays" },
  { label: "创作方式", href: "/#services" },
  { label: "AI 肖像", href: "/#portrait" },
  { label: "作品展示", href: "/#works" },
  { label: "星尘纪念", href: "/#memorial" },
  { label: "联系我们", href: "/#contact" },
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
