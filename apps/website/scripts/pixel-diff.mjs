/*
 * 首页与 docs/website/prototype/index.html 的逐像素比对（方案第 13 章第 1 步的验收标准）。
 *
 * 拆组件时漏一个 class 或改一层嵌套，肉眼未必看出来，diff 会。三档断点各截一张全页图。
 *
 * 不是常规 CI 关卡（要 Chromium + 两个 HTTP 服务），只在改首页结构时手动跑：
 *   node scripts/pixel-diff.mjs
 *
 * Playwright 从 apps/platform 借 —— 官网本身不需要它当依赖（方案第 8 章：
 * 本仓库不是 pnpm workspace，各应用各自 install）。
 */
import { createServer } from "node:http";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const WEBSITE = path.resolve(HERE, "..");
const REPO = path.resolve(WEBSITE, "../..");
const PROTOTYPE = path.join(REPO, "docs/website/prototype");
const DIST = path.join(WEBSITE, "dist");
const OUT = path.join(WEBSITE, ".pixel-diff");

const require = createRequire(path.join(REPO, "apps/platform/package.json"));
// @playwright/test 而非 playwright：platform 只装了前者（它自带 chromium 驱动）
const { chromium } = require("@playwright/test");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".mp4": "video/mp4",
  ".xml": "application/xml",
  ".txt": "text/plain; charset=utf-8",
};

function serve(root, port) {
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://localhost");
      let file = path.join(root, decodeURIComponent(url.pathname));
      if (url.pathname.endsWith("/")) file = path.join(file, "index.html");
      let body = await readFile(file);
      /*
       * 在 HTTP 层把 loading="lazy" 改成 eager，两边同样处理。
       *
       * 必须在解析前改：`loading` 属性是解析时读的，脚本里改晚了不生效；
       * 重设 src 触发加载会与截图抢时序（实测仍有整张图空着的假差异），
       * 滚一遍全页也不行 —— fullPage 截图会把视口移回顶部，Chromium 又把
       * 远处的图判成不需要。改响应体是唯一确定的做法，且不动源文件。
       */
      if (path.extname(file) === ".html") {
        body = Buffer.from(body.toString("utf8").replace(/loading="lazy"/g, 'loading="eager"'), "utf8");
      }
      res.writeHead(200, { "content-type": MIME[path.extname(file)] || "application/octet-stream" });
      res.end(body);
    } catch {
      res.writeHead(404).end("not found");
    }
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

/* 三档断点：手机 / 平板 / 桌面（规格 1 章）*/
const VIEWPORTS = [
  { name: "390", width: 390, height: 844 },
  { name: "768", width: 768, height: 1024 },
  { name: "1440", width: 1440, height: 900 },
];

async function shoot(page, url, viewport, file) {
  process.stdout.write(`    · ${viewport.name}px ${url} `);
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.goto(url, { waitUntil: "load", timeout: 30000 });

  /* 视频停掉并摘掉 src：3.5MB 且 autoplay，一直在流，两边不可能停在同一帧 */
  await page.evaluate(() => {
    const video = document.querySelector("video");
    if (video) { video.pause(); video.currentTime = 0; video.removeAttribute("src"); }
  });
  /* 关掉全部过渡与动画：不关就是在比动画中间态（hero 入场时间线最长到 3.4s）*/
  await page.addStyleTag({
    content: `*, *::before, *::after { animation: none !important; transition: none !important; }`,
  });
  await page.evaluate(async () => {
    /*
     * 顶栏「扫码」按钮与右下角悬浮按钮是第 2 步的新增，原型没有，摘掉再比 ——
     * 第 13 章说得很清楚：它们放在逐像素比对通过之后做，否则「首页多了两个按钮，
     * diff 会全红，看不出是哪里的偏差」。
     *
     * 页脚不在比对范围内（见下方 clip），所以那里的新增不用摘。
     */
    document.querySelectorAll("[data-qr-fab], .topbar .qr-anchor").forEach((n) => n.remove());
    document.querySelectorAll(".reveal").forEach((node) => node.classList.add("is-in"));
    document.querySelectorAll("[data-hero-topbar], [data-hero-title], [data-hero-sub], [data-hero-bar]")
      .forEach((node) => node.classList.add("is-in"));

    await new Promise((r) => setTimeout(r, 300));
  });

  /*
   * 截图前断言 29 张图全部解码完成。
   *
   * 只等一轮 load 事件不够：漏掉一张就会报出整块的假差异（实测 390px 下
   * detail-portrait.jpg 有一边没出来，diff 报 1.58%，看着像版式偏差，
   * 其实是加载竞态）。这里轮询到 naturalWidth 全部 > 0 为止，超时就直接失败 ——
   * 宁可报「截图没准备好」，也不要出一份不可信的 diff 结论。
   */
  const deadline = Date.now() + 30000;
  for (;;) {
    /*
     * img.decode() 而非 img.complete —— complete 只说明字节到了、元数据可读，
     * 不保证已解码到可绘制。实测只查 complete + naturalWidth 时 diff 会在
     * 三档之间来回飘（同一份产物一次 0.0066%、一次 1.95%），因为截图赶在解码前。
     * decode() 的 promise 落地才代表这一帧真的画得出来。
     */
    const pending = await page.evaluate(async () => {
      const imgs = Array.from(document.querySelectorAll("img"));
      const bad = [];
      for (const img of imgs) {
        try { await img.decode(); } catch { bad.push(img.getAttribute("src")); }
      }
      return bad;
    });
    if (pending.length === 0) break;
    if (Date.now() > deadline) throw new Error(`图未解码完，无法比对：${pending.join(", ")}`);
    await page.waitForTimeout(200);
  }
  await page.evaluate(() => document.fonts.ready);
  /*
   * 只比 1–11 区块（<footer> 之前的全部内容），页脚单独用结构断言核。
   *
   * 页脚是**刻意与原型不同**的：方案 7.6 要求加「文章」入口、11.1 要求加 ICP 备案位、
   * 第 4 章要求法务链接指向真页面而不是 #home 死链。这些都会改变页脚高度，
   * 在页脚里做 DOM 手术把它改回原型的样子，比对的就不是真实产物了。
   * 截到页脚为止，比对范围内的一切都必须逐像素一致。
   */
  const cut = await page.evaluate(() => {
    const footer = document.querySelector("footer.footer");
    return footer ? Math.round(footer.getBoundingClientRect().top + window.scrollY) : null;
  });
  const width = viewport.width;
  const buffer = await page.screenshot({
    fullPage: true,
    clip: cut ? { x: 0, y: 0, width, height: cut } : undefined,
  });
  await writeFile(file, buffer);
  process.stdout.write("ok\n");
  return buffer;
}

/* 逐像素比较两张同尺寸 PNG。用 sharp 解码（apps/platform 已有依赖）。 */
async function compare(a, b) {
  const sharp = require("sharp");
  const [ra, rb] = await Promise.all([
    sharp(a).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
    sharp(b).raw().ensureAlpha().toBuffer({ resolveWithObject: true }),
  ]);
  if (ra.info.width !== rb.info.width || ra.info.height !== rb.info.height) {
    return {
      sizeMismatch: `${ra.info.width}×${ra.info.height} vs ${rb.info.width}×${rb.info.height}`,
      diff: null,
    };
  }
  const { width, height } = ra.info;
  let diff = 0;
  const perRow = [];
  for (let y = 0; y < height; y += 1) {
    let rowDiff = 0;
    for (let x = 0; x < width; x += 1) {
      const i = (y * width + x) * 4;
      // 容差 8/255：JPEG 解码与合成在两个进程间会有 ±1–2 的舍入差
      if (
        Math.abs(ra.data[i] - rb.data[i]) > 8 ||
        Math.abs(ra.data[i + 1] - rb.data[i + 1]) > 8 ||
        Math.abs(ra.data[i + 2] - rb.data[i + 2]) > 8
      ) rowDiff += 1;
    }
    if (rowDiff > 0) perRow.push([y, rowDiff]);
    diff += rowDiff;
  }
  const total = width * height;
  return { sizeMismatch: null, diff, total, ratio: diff / total, bands: bandsOf(perRow) };
}

/* 把差异行合并成纵向区间，报告时能直接看出偏差落在页面的哪一块。 */
function bandsOf(rows) {
  const bands = [];
  let start = null, prev = null, sum = 0;
  for (const [y, d] of rows) {
    if (start === null) { start = y; sum = 0; }
    else if (y - prev > 4) { bands.push([start, prev, sum]); start = y; sum = 0; }
    prev = y; sum += d;
  }
  if (start !== null) bands.push([start, prev, sum]);
  return bands;
}

const protoServer = await serve(PROTOTYPE, 4321);
const distServer = await serve(DIST, 4322);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ deviceScaleFactor: 1 });

let failed = false;
for (const viewport of VIEWPORTS) {
  const protoFile = path.join(OUT, `proto-${viewport.name}.png`);
  const siteFile = path.join(OUT, `site-${viewport.name}.png`);
  await shoot(page, "http://localhost:4321/index.html", viewport, protoFile);
  await shoot(page, "http://localhost:4322/", viewport, siteFile);
  const result = await compare(protoFile, siteFile);
  if (result.sizeMismatch) {
    failed = true;
    console.log(`  ✗ ${viewport.name}px 全页尺寸不一致：${result.sizeMismatch}`);
  } else {
    const pct = (result.ratio * 100).toFixed(4);
    /*
     * 阈值 0.01%。实测同一份产物稳定在 0 / 0 / 8 像素 —— 那 8 个落在 hero 底部条
     * 头像的 1.5px 白描边上（抗锯齿边缘的舍入差，不是版式偏差）。
     * 留这点余量抗解码抖动，同时小到漏不掉「少一个 class」这类真实偏差：
     * 之前每次真偏差都在 1% 以上（整块图或整张卡的位移）。
     */
    const ok = result.ratio < 0.0001;
    if (!ok) failed = true;
    console.log(`  ${ok ? "✓" : "✗"} ${viewport.name}px 差异像素 ${result.diff}/${result.total}（${pct}%）`);
    if (!ok) {
      for (const [start, end, count] of result.bands.slice(0, 8)) {
        console.log(`      y ${start}–${end}（${end - start + 1} 行，${count} px）`);
      }
    }
  }
}

await browser.close();
protoServer.close();
distServer.close();

console.log(failed ? "\n逐像素比对未通过，截图在 .pixel-diff/" : "\n逐像素比对通过");
process.exit(failed ? 1 : 0);
