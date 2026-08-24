// @ts-check
import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

/*
 * 独立官网（docs/website/02-独立官网实施方案.md）。纯静态输出，无 Node 运行时。
 *
 * site 是 {{SITE_URL}} 占位（收口清单第 9 项）。**不给则 sitemap 完全不输出**，
 * 所以不能真写成 "{{SITE_URL}}" —— 那不是合法 URL，canonical 与 sitemap 会一起坏。
 * 取值与 src/config/site.ts 的 SITE_URL 同源：环境变量 SITE_URL 优先，
 * 否则用 example 占位域名。收口时改环境变量或改那一处默认值。
 */
const SITE_URL = process.env.SITE_URL || "https://petbaby.example.com";

export default defineConfig({
  site: SITE_URL,
  output: "static",
  /*
   * URL 末尾统一带斜杠。静态托管下 /blog/foo 与 /blog/foo/ 会被搜索引擎当成
   * 两个 URL，统一一种再配 canonical。build.format: "directory" 是默认值，
   * 显式写出来是因为它与 trailingSlash 必须配套 —— 目录式产物才有 /blog/foo/index.html。
   */
  trailingSlash: "always",
  build: { format: "directory" },
  /*
   * compressHTML 默认 'jsx'，按 JSX 规则剥掉行内元素之间的空白。
   * hero 标题是逐词 <span class="word">，词间距靠 CSS gap 而非空格，本不受影响；
   * 但正文 Markdown 里 <strong>/<a> 前后的空格是有意义的，故整体关掉压缩 ——
   * 静态站的 gzip 收益远大于剥空白，不值得为它冒改变渲染的风险。
   */
  compressHTML: false,
  integrations: [
    sitemap({
      // 草稿文章不进构建（详情页根本不生成），这里只需排掉 404。
      filter: (page) => !page.includes("/404"),
      /*
       * 实测这一版 @astrojs/sitemap 会读 trailingSlash，输出已带斜杠。
       * 仍显式收口一遍：canonical 与 sitemap 逐字一致是硬要求，
       * 而集成的这个行为没有写进它的文档，不能指望它跨版本稳定。
       * 带扩展名的端点（/rss.xml）不能加斜杠，按最后一段是否含 "." 判断。
       */
      serialize(item) {
        const url = new URL(item.url);
        const last = url.pathname.split("/").filter(Boolean).pop() || "";
        if (!last.includes(".") && !url.pathname.endsWith("/")) {
          url.pathname += "/";
          item.url = url.href;
        }
        return item;
      },
    }),
  ],
});
