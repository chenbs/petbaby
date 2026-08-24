/*
 * 文章的取用与排序集中一处。
 *
 * **getCollection() 的返回顺序不确定**（官方说法：non-deterministic、依赖平台）。
 * 列表页、RSS、sitemap、llms.txt 都必须显式 sort()，否则换台机器构建就会得出
 * 不同顺序。把排序收在这里，就不会有某个页面漏排。
 */
import { getCollection, type CollectionEntry } from "astro:content";

export type Post = CollectionEntry<"posts">;

/** 已发布的文章，按 publishedAt 倒序。草稿不进构建产物。 */
export async function listPosts(): Promise<Post[]> {
  const posts = await getCollection("posts", ({ data }) => data.draft !== true);
  return posts.sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime());
}

/**
 * 标签的 URL 片段。
 *
 * 只把空格换成连字符，中文原样保留（浏览器与搜索引擎都能处理 percent-encode 的
 * 中文，且 URL 里保留中文对用户更可读）。**空格必须换掉** —— 「AI 肖像」直接
 * 编码成 `AI%20肖像` 虽然合法，但路径里带空格会在静态托管、日志分析、手工
 * curl 之间反复出问题，产物目录名里也会真的出现一个空格。
 */
export function tagSlug(tag: string): string {
  return tag.trim().replace(/\s+/g, "-");
}

/** 全部标签及其文章数，按文章数倒序、同数按标签名排（保证顺序稳定）。 */
export async function listTags(): Promise<Array<{ tag: string; slug: string; count: number }>> {
  const posts = await listPosts();
  const counts = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([tag, count]) => ({ tag, slug: tagSlug(tag), count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag, "zh-CN"));
}

/** 标签页地址。视觉与 sitemap 都走它，不各拼一次。 */
export function tagPath(tag: string): string {
  return `/blog/tag/${tagSlug(tag)}/`;
}

/** 日期按 zh-CN 格式化。用固定的 UTC 时区，避免构建机时区影响产物。 */
export function formatDate(date: Date): string {
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

/** 每页 12 篇（方案第 4 章）。 */
export const PAGE_SIZE = 12;
