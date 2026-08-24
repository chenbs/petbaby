/*
 * 文章 collection 的 schema（方案第 5 章）。位置是 src/content.config.ts ——
 * Astro 7 的约定，不是旧版的 src/content/config.ts。
 *
 * 三个导入路径都别记错：defineCollection 来自虚拟模块 astro:content，
 * z 来自 astro/zod（Astro 6 起从 astro:content 挪走了），glob 来自 astro/loaders。
 *
 * 字段缺失或类型不对会在构建时报错而非静默出错 —— 这是这个 schema 的主要价值：
 * frontmatter 写错在构建期就挂，不会等上线后才发现 <title> 是空的。
 */
import { defineCollection, reference } from "astro:content";
import { glob } from "astro/loaders";
import { z } from "astro/zod";

import { BRAND_NAME } from "./config/site";

const posts = defineCollection({
  loader: glob({ base: "./src/content/posts", pattern: "**/*.md" }),
  schema: ({ image }) =>
    z.object({
      /*
       * 长度上限是刻意的：title 与 description 直接进 <title> 与 meta description，
       * 超长会被搜索结果截断。schema 挡住比上线后发现更省事。
       */
      title: z.string().max(60),
      description: z.string().min(50).max(160),
      publishedAt: z.coerce.date(),
      updatedAt: z.coerce.date().optional(),
      /*
       * cover 用 image() 而非 z.string()：Astro 会校验文件存在、并在构建时生成
       * 多档尺寸与 width/height（防 CLS，与原型同一个考虑）。
       * 注意 image().refine() 不支持 —— 要校验封面尺寸得在别处做。
       */
      cover: image().optional(),
      coverAlt: z.string().optional(),
      tags: z.array(z.string()).default([]),
      author: z.string().default(BRAND_NAME),
      /** true 时不进构建，也不进 sitemap / RSS / llms.txt。 */
      draft: z.boolean().default(false),
      /*
       * 相关文章。用 reference('posts') 而非裸字符串：引用了不存在的 slug 会在
       * 构建时报错，不会留死链（方案 7.6 第 3 条）。
       */
      related: z.array(reference("posts")).default([]),
    }),
});

export const collections = { posts };
