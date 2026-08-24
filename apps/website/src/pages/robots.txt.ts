/*
 * robots.txt 走端点而不是 public/ 下的静态文件（与方案第 3 章的目录表有一处偏离）。
 *
 * 理由：Sitemap: 那一行必须与 canonical 逐字一致的域名，而域名来自 SITE_URL
 * 环境变量。静态文件里写死域名的话，收口时要记得改两个地方 —— 而漏改不会报错，
 * 只会让搜索引擎抓一个不存在的 sitemap。端点从同一个常量渲染，不可能分叉。
 *
 * 默认不屏蔽任何 AI 爬虫（方案 7.3）：Rutgers/Wharton 2026-04 的研究发现，用
 * robots.txt 屏蔽 AI 爬虫的新闻站在六周内损失约 7% 周流量，且这是真人浏览数据
 * 而非爬虫计数 —— 屏蔽 AI 抓取会连带损失可见度。若日后要屏蔽，在下面加
 * GPTBot / ClaudeBot / PerplexityBot 的 Disallow，但要清楚代价。
 */
import type { APIRoute } from "astro";
import { SITE_URL } from "../config/site";

export const GET: APIRoute = () =>
  new Response(
    `User-agent: *
Allow: /

Sitemap: ${SITE_URL}/sitemap-index.xml
`,
    { headers: { "content-type": "text/plain; charset=utf-8" } },
  );
