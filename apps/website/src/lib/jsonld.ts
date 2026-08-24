/*
 * JSON-LD 构造。与页面上的面包屑/文章元信息从同一份数据出，不各写一份。
 *
 * 只给常规搜索的富结果用（方案 7.2）。Google 说生成式 AI 不需要特殊 schema，
 * 所以不为 AI 另加标记。两条禁令：
 *   · 不加 Product / Offer —— 官网不直接售卖，价格在小程序内，虚标是搜索作弊
 *   · FAQPage 视情况 —— Google 已大幅收窄 FAQ 富结果的展示范围，别硬造问答
 */
import { SITE_URL } from "../config/site";

export function breadcrumbLd(items: Array<{ label: string; href?: string }>) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((item, index) => ({
      "@type": "ListItem",
      position: index + 1,
      name: item.label,
      ...(item.href ? { item: new URL(item.href, SITE_URL).href } : {}),
    })),
  };
}

export function articleLd(input: {
  title: string;
  description: string;
  path: string;
  publishedAt: Date;
  updatedAt?: Date;
  author: string;
  image?: string;
}) {
  return {
    "@context": "https://schema.org",
    "@type": "Article",
    headline: input.title,
    description: input.description,
    url: new URL(input.path, SITE_URL).href,
    datePublished: input.publishedAt.toISOString(),
    // dateModified 缺省时用发布时间：留空字段会被判为无效标记
    dateModified: (input.updatedAt ?? input.publishedAt).toISOString(),
    author: { "@type": "Organization", name: input.author },
    inLanguage: "zh-CN",
    ...(input.image ? { image: new URL(input.image, SITE_URL).href } : {}),
  };
}
