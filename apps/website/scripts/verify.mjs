/*
 * 官网的浏览器端验收断言（方案第 13 章的验收标准）。逐像素比对另在 pixel-diff.mjs。
 *
 * 查五组，都是「只有真在浏览器里跑才能验」的东西：
 *   ① 首屏性能：CLS、图片固有尺寸与 lazy 比例、h1 唯一、页脚不再有死链
 *   ② 小程序码三触点：hover/click 双轨、键盘可达、IO 显隐规则、reduced-motion
 *   ③ 文章正文：列表符号、行内链接下划线、表格/引用样式、标题层级
 *   ④ solid 顶栏在浅底上的实测对比度
 *   ⑤ 法务页的未定稿提示条与章节骨架
 *
 * 用法（先 pnpm build）：
 *   node scripts/verify.mjs
 *
 * Chromium 与 sharp 从 apps/platform 借 —— 官网自己不装 Playwright
 * （方案第 8 章：本仓库不是 workspace，各应用各自 install）。
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE = path.resolve(HERE, "..");
const DIST = path.join(WEBSITE, "dist");
const require = createRequire(path.resolve(WEBSITE, "../platform/package.json"));
const { chromium, devices } = require("@playwright/test");
const sharp = require("sharp");

const PORT = 4488;
const BASE = `http://localhost:${PORT}`;

const MIME = {
  ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png",
  ".webp": "image/webp", ".mp4": "video/mp4", ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    let file = path.join(DIST, decodeURIComponent(url.pathname));
    if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
    const body = await readFile(file);
    res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("not found");
  }
});
await new Promise((resolve) => server.listen(PORT, resolve));

let failures = 0;
const ok = (label, pass, detail = "") => {
  if (!pass) failures += 1;
  console.log(`  ${pass ? "✓" : "✗"} ${label}${detail ? ` — ${detail}` : ""}`);
};
const group = (name) => console.log(`\n${name}`);

const browser = await chromium.launch();

/* 锚点跳转用 instant：html 上有 scroll-behavior:smooth，平滑滚动到位要等，等不够会误判 */
const jump = (page, id) => page.evaluate((target) => {
  document.getElementById(target).scrollIntoView({ behavior: "instant" });
}, id);
const fabVisible = (page) => page.evaluate(() =>
  document.querySelector("[data-qr-fab]").classList.contains("is-visible"));

// ── ① 首屏性能与结构 ────────────────────────────────────────────────────────
group("首屏性能与结构（方案 7.7 / 第 13 章第 1 步）");
for (const viewport of [{ width: 390, height: 844 }, { width: 1440, height: 900 }]) {
  const page = await browser.newPage({ viewport });
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) if (!entry.hadRecentInput) window.__cls += entry.value;
    }).observe({ type: "layout-shift", buffered: true });
  });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.evaluate(async () => {
    const step = window.innerHeight;
    for (let y = 0; y < document.body.scrollHeight; y += step) {
      window.scrollTo(0, y);
      await new Promise((r) => setTimeout(r, 120));
    }
  });
  await page.waitForTimeout(1000);
  const info = await page.evaluate(() => ({
    cls: window.__cls,
    h1: document.querySelectorAll("h1").length,
    noDim: Array.from(document.querySelectorAll("img"))
      .filter((img) => !img.getAttribute("width") || !img.getAttribute("height")).length,
    total: document.querySelectorAll("img").length,
    lazy: document.querySelectorAll('img[loading="lazy"]').length,
    deadLinks: document.querySelectorAll('a[href="#home"]').length,
    nav: document.querySelectorAll(".desktop-menu a").length,
    mobileNav: document.querySelectorAll(".mobile-menu-nav a").length,
  }));
  const tag = `${viewport.width}px`;
  ok(`${tag} CLS 为 0`, info.cls === 0, `实测 ${info.cls}`);
  ok(`${tag} 全部图片带固有尺寸`, info.noDim === 0, `${info.total} 张，缺尺寸 ${info.noDim} 张`);
  ok(`${tag} 首屏外的图 lazy`, info.lazy === info.total - 3, `${info.lazy}/${info.total} lazy（hero 三头像 eager）`);
  ok(`${tag} h1 唯一`, info.h1 === 1);
  ok(`${tag} 页脚不再有 #home 死链`, info.deadLinks === 0);
  ok(`${tag} 两个菜单从同一数组渲染`, info.nav === info.mobileNav && info.nav === 8, `各 ${info.nav} 项`);
  await page.close();
}

// ── ② 小程序码三触点 ────────────────────────────────────────────────────────
group("小程序码三触点（方案第 6 章 / 第 13 章第 2 步）");
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  page.on("pageerror", (error) => ok(`页面无脚本报错`, false, error.message));
  await page.goto(`${BASE}/`, { waitUntil: "load" });

  await page.hover(".topbar .qr-trigger");
  await page.waitForTimeout(400);
  ok("桌面 mouseenter 打开",
    await page.getAttribute(".topbar .qr-trigger", "aria-expanded") === "true"
    && await page.isVisible("#qr-pop-topbar"));
  await page.mouse.move(700, 700);
  await page.waitForTimeout(500);
  ok("桌面 mouseleave 关闭", await page.getAttribute(".topbar .qr-trigger", "aria-expanded") === "false");

  /*
   * Tab 顺序必须重新导航后再走：Chromium 的顺序聚焦起点由上一次交互决定，
   * 前面 hover 过之后从 body 起步会从顶栏中间开始数。
   */
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  const order = [];
  for (let i = 0; i < 4; i += 1) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => document.activeElement.className || document.activeElement.tagName));
  }
  ok("Tab 能聚焦扫码按钮", order.some((cls) => cls.includes("qr-trigger")), order.join(" → "));

  await page.focus(".topbar .qr-trigger");
  await page.waitForTimeout(300);
  ok("聚焦即打开（focusin 而非 focus，能冒泡）", await page.isVisible("#qr-pop-topbar"));
  await page.keyboard.press("Enter");
  await page.waitForTimeout(300);
  ok("Enter 点开后保持打开（pinned）",
    await page.getAttribute(".topbar .qr-trigger", "aria-expanded") === "true");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  ok("Esc 关闭", await page.getAttribute(".topbar .qr-trigger", "aria-expanded") === "false");
  ok("Esc 后焦点还回按钮",
    String(await page.evaluate(() => document.activeElement.className)).includes("qr-trigger"));

  ok("hero 内不显示悬浮按钮", !await fabVisible(page));
  await jump(page, "plays");
  await page.waitForTimeout(500);
  ok("滚过 hero 后淡入", await fabVisible(page));
  await jump(page, "contact");
  await page.waitForTimeout(500);
  ok("滚到 CTA 区淡出（那里已有更大的码）", !await fabVisible(page));
  await jump(page, "works");
  await page.waitForTimeout(500);
  ok("离开 CTA 区又显示", await fabVisible(page));
  await page.close();
}
{
  const context = await browser.newContext({ ...devices["iPhone 13"] });
  const page = await context.newPage();
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  ok("移动端隐藏顶栏扫码按钮（顶栏放不下第三个元素）", !await page.isVisible(".topbar .qr-trigger"));
  await jump(page, "plays");
  await page.waitForTimeout(600);
  await page.tap(".qr-fab-btn");
  await page.waitForTimeout(400);
  ok("触屏 tap 打开",
    await page.getAttribute(".qr-fab-btn", "aria-expanded") === "true" && await page.isVisible("#qr-pop-fab"));
  await page.tap(".qr-fab-btn");
  await page.waitForTimeout(400);
  ok("触屏再次 tap 关闭", await page.getAttribute(".qr-fab-btn", "aria-expanded") === "false");
  await page.tap(".qr-fab-btn");
  await page.waitForTimeout(400);
  await page.tap("body", { position: { x: 30, y: 300 } });
  await page.waitForTimeout(400);
  ok("点弹框外关闭", await page.getAttribute(".qr-fab-btn", "aria-expanded") === "false");
  await context.close();
}
{
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, reducedMotion: "reduce" });
  await page.goto(`${BASE}/`, { waitUntil: "load" });
  await page.hover(".topbar .qr-trigger");
  await page.waitForTimeout(200);
  const opacity = await page.evaluate(() => getComputedStyle(document.getElementById("qr-pop-topbar")).opacity);
  ok("reduced-motion 下直接显示、无入场动画", opacity === "1", `opacity ${opacity}`);
  await page.close();
}

// ── ③ 文章正文 ──────────────────────────────────────────────────────────────
group("文章正文（方案第 5 章 / 第 13 章第 4 步）");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/blog/pet-portrait-style-comparison/`, { waitUntil: "load" });
  const prose = await page.evaluate(() => {
    const list = document.querySelector(".prose ul");
    const link = document.querySelector(".prose a");
    const table = document.querySelector(".prose table");
    const quote = document.querySelector(".prose blockquote");
    const g = (el) => (el ? getComputedStyle(el) : null);
    return {
      listStyle: g(list)?.listStyleType,
      listPad: g(list)?.paddingLeft,
      linkDecoration: link ? g(link).textDecorationLine : null,
      tableCollapse: g(table)?.borderCollapse,
      thWeight: table ? g(table.querySelector("th")).fontWeight : null,
      quoteBorder: g(quote)?.borderLeftColor,
      headings: Array.from(document.querySelectorAll(".prose h2,.prose h3,.prose h4")).map((n) => +n.tagName[1]),
      h1: document.querySelectorAll("h1").length,
      solidTopbar: document.querySelector(".topbar").classList.contains("topbar-solid"),
      topbarPosition: g(document.querySelector(".topbar")).position,
      brandColor: g(document.querySelector(".topbar .brand-name")).color,
    };
  });
  ok("正文列表有符号（全局重置在 .prose 内被还原）",
    prose.listStyle === "disc" && parseFloat(prose.listPad) > 0,
    `${prose.listStyle} / padding ${prose.listPad}`);
  ok("正文行内链接有下划线（不只靠颜色区分）",
    !prose.linkDecoration || prose.linkDecoration.includes("underline"), prose.linkDecoration ?? "本篇无行内链接");
  ok("表格有样式（原型完全没有）", prose.tableCollapse === "collapse");
  ok("th 用 semibold 而非 bold（700 在中文黑体上发糊）", prose.thWeight === "600");
  ok("引用有主色左边线", prose.quoteBorder === "rgb(196, 51, 92)");
  ok("正文标题无跳级", prose.headings.every((level, i) => i === 0 || level <= prose.headings[i - 1] + 1),
    `h${prose.headings.join(" h")}`);
  ok("h1 唯一（文章标题）", prose.h1 === 1);
  ok("solid 顶栏：sticky + 深字（不是浅底白字）",
    prose.solidTopbar && prose.topbarPosition === "sticky" && prose.brandColor !== "rgb(255, 255, 255)",
    prose.brandColor);
  ok("文章底部有 CTA 面板（搜索流量的变现路径）", await page.isVisible(".cta-panel"));
  ok("相关文章链接存在（reference 构建期校验，不会留死链）",
    await page.isVisible('.article-foot a[href^="/blog/"]'));
  await page.close();
}

// ── ④ solid 顶栏对比度 ──────────────────────────────────────────────────────
group("solid 顶栏对比度（方案第 3 章的实算值复核）");
{
  const luminance = (r, g, b) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => {
    const [hi, lo] = [luminance(...a), luminance(...b)].sort((x, y) => y - x);
    return (hi + 0.05) / (lo + 0.05);
  };
  const rgb = (value) => value.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number);
  const hex = (value) => [1, 3, 5].map((i) => parseInt(value.slice(i, i + 2), 16));

  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.goto(`${BASE}/blog/`, { waitUntil: "load" });
  // 滚到正文中段：顶栏此时压在页面内容上，是半透明 + blur 的最坏情况
  await page.evaluate(() => window.scrollTo(0, 900));
  await page.waitForTimeout(400);
  const shot = await page.screenshot({ clip: { x: 0, y: 0, width: 1280, height: 90 } });
  const { data, info } = await sharp(shot).raw().ensureAlpha().toBuffer({ resolveWithObject: true });
  const pixel = (x, y) => { const i = (y * info.width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const colors = await page.evaluate(() => {
    const topbar = document.querySelector(".topbar");
    const g = (el) => getComputedStyle(el).color;
    return {
      brand: g(topbar.querySelector(".brand-name")),
      menu: g(topbar.querySelector(".menu-btn")),
      qr: g(topbar.querySelector(".qr-trigger")),
    };
  });
  let worst = Infinity;
  for (const [x, y] of [[500, 30], [700, 45], [900, 20], [600, 60]]) {
    const bg = pixel(x, y);
    for (const value of Object.values(colors)) worst = Math.min(worst, contrast(rgb(value), bg));
  }
  ok("顶栏文字在实际渲染底色上 ≥4.5:1", worst >= 4.5, `最坏 ${worst.toFixed(2)}:1`);

  const vars = await page.evaluate(() => {
    const s = getComputedStyle(document.documentElement);
    return {
      primary: s.getPropertyValue("--text-primary").trim(),
      secondary: s.getPropertyValue("--text-secondary").trim(),
      brand: s.getPropertyValue("--primary").trim(),
      surface: s.getPropertyValue("--surface").trim(),
    };
  });
  const expected = [["--text-primary", vars.primary, 13.12], ["--text-secondary", vars.secondary, 5.54], ["--primary", vars.brand, 5.20]];
  for (const [name, value, claim] of expected) {
    const actual = contrast(hex(value), hex(vars.surface));
    ok(`${name} on --surface 与方案算值一致`, Math.abs(actual - claim) < 0.02,
      `实测 ${actual.toFixed(2)}:1，方案称 ${claim}`);
  }
  await page.close();
}

// ── ⑤ 法务页与 404 ──────────────────────────────────────────────────────────
group("法务页与 404（方案 11.1 / 第 13 章第 5 步）");
{
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  for (const [route, placeholder, count] of [["/legal/terms/", "legal-terms", 7], ["/legal/privacy/", "legal-privacy", 8]]) {
    await page.goto(`${BASE}${route}`, { waitUntil: "load" });
    const notice = await page.evaluate(() => {
      const el = document.querySelector(".notice-draft");
      return el ? { text: el.textContent.replace(/\s+/g, " ").trim(), border: getComputedStyle(el).borderTopColor } : null;
    });
    ok(`${route} 未定稿提示条醒目`, /尚未定稿/.test(notice?.text ?? "") && notice?.border === "rgb(196, 51, 92)");
    ok(`${route} 章节骨架 ${count} 节`,
      await page.evaluate(() => document.querySelectorAll(".legal-section").length) === count);
    ok(`${route} 有 data-placeholder 便于 grep`,
      await page.evaluate((name) => Boolean(document.querySelector(`[data-placeholder="${name}"]`)), placeholder));
  }
  await page.goto(`${BASE}/404.html`, { waitUntil: "load" });
  ok("404 给回首页与文章的出口",
    await page.isVisible('.notfound-actions a[href="/"]') && await page.isVisible('.notfound-actions a[href="/blog/"]'));
  ok("404 是 noindex 且不给 canonical（不指向不存在的 /404/）",
    await page.evaluate(() => Boolean(document.querySelector('meta[name="robots"]'))
      && !document.querySelector('link[rel="canonical"]')));
  await page.close();
}

// ── 产物断言 ────────────────────────────────────────────────────────────────
group("产物断言");
{
  const home = await readFile(path.join(DIST, "index.html"), "utf8");
  ok("小程序码缺图时三处都是虚线占位框",
    (home.match(/data-placeholder="miniprogram-qr"/g) || []).length === 3);
  ok("两个弹框实例（顶栏 + 悬浮；CTA 面板的码常显，不需要弹框）",
    (home.match(/class="qr-pop" id="/g) || []).length === 2);

  const rss = await readFile(path.join(DIST, "rss.xml"), "utf8");
  ok("RSS 有条目且链接带末尾斜杠",
    (rss.match(/<item>/g) || []).length >= 2 && /<link>https:\/\/[^<]+\/blog\/[a-z-]+\/<\/link>/.test(rss));

  const llms = await readFile(path.join(DIST, "llms.txt"), "utf8");
  ok("llms.txt 给出站点结构与产品要点", /## 主要页面/.test(llms) && /## 玩法/.test(llms));
  ok("llms.txt 记了纪念天数不递增的口径", /不递增/.test(llms));

  for (const [file, label, types] of [
    ["index.html", "首页", ["Organization", "WebSite"]],
    ["blog/index.html", "文章列表", ["Organization", "BreadcrumbList"]],
    ["blog/pet-id-card-photo-guide/index.html", "文章详情", ["Organization", "BreadcrumbList", "Article"]],
  ]) {
    const html = await readFile(path.join(DIST, file), "utf8");
    const found = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)]
      .map((m) => JSON.parse(m[1])["@type"]);
    ok(`${label} 结构化数据 ${types.join(" + ")}`, types.every((t) => found.includes(t)), found.join(" + "));
    ok(`${label} 无 Product / Offer / FAQPage（官网不直接售卖，虚标是作弊）`,
      !/"@type":"(Product|Offer|FAQPage)"/.test(html));
  }
}

await browser.close();
server.close();

console.log(failures ? `\n${failures} 项未通过` : "\n全部通过");
process.exit(failures ? 1 : 0);
