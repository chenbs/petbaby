/*
 * RSS 2.0。@astrojs/rss 是普通包不是 integration，在 endpoint 文件里 import
 * （方案第 4 章）。
 *
 * 排序走 lib/posts 的 listPosts()：getCollection 的顺序不确定，RSS 里顺序错乱
 * 会让订阅端反复推送旧条目。
 */
import rss from "@astrojs/rss";
import type { APIRoute } from "astro";
import { BRAND_NAME, SITE_DESCRIPTION, SITE_URL } from "../config/site";
import { listPosts } from "../lib/posts";

export const GET: APIRoute = async (context) => {
  const posts = await listPosts();
  return rss({
    title: `${BRAND_NAME} · 文章`,
    description: SITE_DESCRIPTION,
    // context.site 来自 astro.config 的 site；缺省时回落到常量，两者同源
    site: context.site ?? SITE_URL,
    trailingSlash: true,
    customData: "<language>zh-CN</language>",
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.publishedAt,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
    })),
  });
};
