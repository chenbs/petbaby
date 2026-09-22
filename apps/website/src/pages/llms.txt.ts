/*
 * llms.txt：给自主 agent 的一张站点地图（agent readiness），**不是 SEO 手段**。
 *
 * 实测数据（2026 年，方案 7.4）：Ahrefs 统计 13.7 万域名的服务器日志，97% 的
 * llms.txt 在 2026 年 5 月收到零请求；AI 检索爬虫只占这些文件请求量的 1.1%
 * （GPTBot 4.51%、ClaudeBot 0.80%）。EZY 的 12 周日志研究里，OpenAI 读
 * robots.txt 3990 次、读 llms.txt 7 次。Google 明确说它「不会正面也不会负面
 * 影响你的可见度或排名」。
 *
 * 结论：写一份，成本几乎为零。**任何把 llms.txt 说成能提升 AI 引用的说法都
 * 超出了当前证据。**
 *
 * 内容原则：写事实与站点结构，不写营销话术。它的读者是自主 agent，需要的是
 * 准确的页面清单与产品要点。文章逐篇列出的维护成本不划算 —— sitemap 已经承担
 * 了完整清单的职责，这里只给主干。
 *
 * 与 robots.txt 同理走端点：域名从 SITE_URL 渲染，不可能与 canonical 分叉。
 */
import type { APIRoute } from "astro";
import { getCollection } from "astro:content";
import { BRAND_NAME, SITE_DESCRIPTION, SITE_URL } from "../config/site";

export const GET: APIRoute = async () => {
  // 只列草稿之外的文章，且最多 10 篇 —— 主干而非完整清单
  const posts = (await getCollection("posts", ({ data }) => data.draft !== true))
    .sort((a, b) => b.data.publishedAt.getTime() - a.data.publishedAt.getTime())
    .slice(0, 10);

  const body = `# ${BRAND_NAME}

> ${SITE_DESCRIPTION}

## 主要页面
- [首页](${SITE_URL}/): 玩法介绍与 AI 创意示例
- [文章](${SITE_URL}/blog/): 玩法教程、拍照技巧、产品设计取舍
- [用户协议](${SITE_URL}/legal/terms/)
- [隐私政策](${SITE_URL}/legal/privacy/)

## 产品事实
- 麻麻抱我是面向宠物家庭的照片创作与陪伴记录微信小程序，官网用于介绍功能和作品示例，不直接售卖。
- 用户可以先建立宠物档案，再从手机照片开始制作、保存和分享作品；具体开放能力以小程序内展示为准。

## 玩法
- 宠物档案与照片库: 建立宠物资料、管理照片、查看默认宠物与陪伴记录
- 宠物身份证: 正脸照 1 张生成证件卡
- 宠物电影海报: 日常照 1–3 张排成主视觉海报
- 宠物时光画册: 照片 6–20 张装订成长图与 PDF
- AI 宠物肖像: 从已上线模板中选择效果，候选数量与重试规则以玩法为准
- 如果我是人: 根据宠物照片生成两张人类角色候选，具体模板以小程序内展示为准
- 互动页面与陪伴短片: 互动场景支持轻点收集星尘；短片提供 10/20/30 秒时长、字幕和音乐选项
- 成长记录: 按年份整理照片、里程碑与年度短片入口
- 健康助手: 记录症状、体重、免疫与驱虫并提供提醒，健康内容仅用于辅助记录与分流
- 星尘纪念: 纪念册、纪念视频、纪念页、成长对比图
- 会员与实体纪念品: 会员权益、年度报告、高清作品与实体纪念品，具体开放能力以小程序内展示为准
${posts.length ? `
## 最近文章
${posts.map((post) => `- [${post.data.title}](${SITE_URL}/blog/${post.id}/): ${post.data.description}`).join("\n")}
` : ""}
## 说明
- 照片用于用户选择的档案、创作与分享服务，个人信息处理详见隐私政策
- 纪念空间的陪伴天数是过去式且不递增（「陪伴了 N 天」）
- 官网不直接售卖，价格在微信小程序内
`;

  return new Response(body, { headers: { "content-type": "text/plain; charset=utf-8" } });
};
