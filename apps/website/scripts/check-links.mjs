/*
 * 站内链接与 sitemap 的 URL 必须都能命中产物文件（方案第 8 章的 CI 关卡）。
 *
 * 为什么值得做：静态站的死链**不会有任何运行时报错**。文章多了以后互相引用，
 * 改一个 slug 就留下一个 404，而构建照样通过、页面照样能打开 —— 只有真去点
 * 那个链接才会发现。这个脚本把「点一遍」变成构建期的一次断言。
 *
 * 查五件事：
 *   ① 站内 <a href> 都能命中 dist 下的文件
 *   ② <img src> / <video src> / <link href> / <script src> 同上
 *   ③ sitemap 里的 URL 都能命中，且与页面 canonical 逐字一致
 *   ④ canonical 与 sitemap 双向无遗漏（noindex 页面除外）
 *   ⑤ trailingSlash 一致：目录式 URL 必须以 / 结尾
 *
 * 只读 dist/，不起浏览器 —— CI 里跑得起。
 */
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.resolve(HERE, "../dist");

const problems = [];
const fail = (message) => problems.push(message);

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(full));
    else out.push(full);
  }
  return out;
}

async function exists(target) {
  try { await stat(target); return true; } catch { return false; }
}

/** 把站内绝对路径解析成产物文件路径。目录式 URL 落到 index.html。 */
async function resolveTarget(pathname) {
  const decoded = decodeURIComponent(pathname);
  const direct = path.join(DIST, decoded);
  if (decoded.endsWith("/")) return exists(path.join(direct, "index.html"));
  if (await exists(direct)) return true;
  // 无扩展名且不带斜杠的路径，退一步看有没有对应目录 —— 这种写法本身要报（见 ⑤）
  return exists(path.join(direct, "index.html"));
}

const files = await walk(DIST);
const htmlFiles = files.filter((file) => file.endsWith(".html"));

if (htmlFiles.length === 0) fail("dist/ 下没有 HTML，先执行 pnpm build");

const canonicals = new Map();   // canonical URL → 产物文件
const noindexPages = new Set();

for (const file of htmlFiles) {
  const rel = path.relative(DIST, file).replace(/\\/g, "/");
  const html = await readFile(file, "utf8");

  const canonical = html.match(/<link rel="canonical" href="([^"]+)"/);
  if (canonical) canonicals.set(canonical[1], rel);
  if (/name="robots" content="noindex/.test(html)) noindexPages.add(rel);
  else if (!canonical) fail(`${rel}: 缺少 canonical`);

  // ① 站内链接
  for (const match of html.matchAll(/<a\b[^>]*?\bhref="([^"]+)"/g)) {
    const href = match[1];
    if (/^(https?:|mailto:|tel:|#|data:)/.test(href)) continue;
    if (!href.startsWith("/")) { fail(`${rel}: 相对链接 ${href}（站内一律用绝对路径）`); continue; }
    const url = new URL(href, "http://x");
    // ⑤ trailingSlash: 'always' —— 目录式 URL 必须带斜杠，否则与 canonical 分叉
    const last = url.pathname.split("/").filter(Boolean).pop() || "";
    if (!url.pathname.endsWith("/") && !last.includes(".")) {
      fail(`${rel}: 链接 ${href} 缺末尾斜杠（trailingSlash: 'always'）`);
    }
    if (!await resolveTarget(url.pathname)) fail(`${rel}: 死链 ${href}`);
  }

  // ② 资源引用
  const assetPatterns = [
    /<img\b[^>]*?\bsrc="([^"]+)"/g,
    /<video\b[^>]*?\bsrc="([^"]+)"/g,
    /<script\b[^>]*?\bsrc="([^"]+)"/g,
    /<link\b[^>]*?\bhref="([^"]+)"[^>]*?rel="stylesheet"/g,
    /<link\b[^>]*?rel="stylesheet"[^>]*?\bhref="([^"]+)"/g,
    /<link\b[^>]*?rel="preload"[^>]*?\bhref="([^"]+)"/g,
    /<video\b[^>]*?\bposter="([^"]+)"/g,
  ];
  for (const pattern of assetPatterns) {
    for (const match of html.matchAll(pattern)) {
      const src = match[1];
      if (/^(https?:|data:)/.test(src)) continue;
      if (!src.startsWith("/")) { fail(`${rel}: 相对资源 ${src}`); continue; }
      if (!await exists(path.join(DIST, decodeURIComponent(src)))) fail(`${rel}: 资源缺失 ${src}`);
    }
  }
}

// ③④ sitemap 与 canonical 双向核对
const sitemapIndex = path.join(DIST, "sitemap-index.xml");
if (!await exists(sitemapIndex)) {
  fail("缺少 sitemap-index.xml（astro.config.mjs 的 site 没给？不给则 sitemap 不输出）");
} else {
  const indexXml = await readFile(sitemapIndex, "utf8");
  const shards = [...indexXml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
  const locs = [];
  for (const shard of shards) {
    const name = shard.split("/").pop();
    const shardPath = path.join(DIST, name);
    if (!await exists(shardPath)) { fail(`sitemap 分片缺失：${name}`); continue; }
    const xml = await readFile(shardPath, "utf8");
    locs.push(...[...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]));
  }

  for (const loc of locs) {
    const url = new URL(loc);
    if (!await resolveTarget(url.pathname)) fail(`sitemap 指向不存在的页面：${loc}`);
    const last = url.pathname.split("/").filter(Boolean).pop() || "";
    if (!url.pathname.endsWith("/") && !last.includes(".")) {
      fail(`sitemap 的 URL 缺末尾斜杠：${loc}（与 canonical 必须逐字一致）`);
    }
    if (!canonicals.has(loc)) fail(`sitemap 有 ${loc}，但没有页面的 canonical 等于它`);
  }
  for (const [canonical, rel] of canonicals) {
    if (!locs.includes(canonical)) fail(`${rel} 的 canonical ${canonical} 不在 sitemap 里`);
  }
}

// robots.txt 的 Sitemap 行必须与 sitemap 实际域名一致
const robots = path.join(DIST, "robots.txt");
if (!await exists(robots)) fail("缺少 robots.txt");
else {
  const text = await readFile(robots, "utf8");
  const line = text.match(/^Sitemap:\s*(\S+)/m);
  if (!line) fail("robots.txt 缺少 Sitemap: 行");
  else {
    const indexXml = await exists(sitemapIndex) ? await readFile(sitemapIndex, "utf8") : "";
    const shard = indexXml.match(/<loc>([^<]+)<\/loc>/);
    if (shard) {
      const expected = new URL(shard[1]).origin;
      if (new URL(line[1]).origin !== expected) {
        fail(`robots.txt 的 Sitemap 域名 ${line[1]} 与 sitemap 的 ${expected} 不一致`);
      }
    }
  }
}

console.log(`检查 ${htmlFiles.length} 个页面、${canonicals.size} 个 canonical。`);
if (problems.length) {
  console.log(`\n${problems.length} 个问题：`);
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  process.exit(1);
}
console.log("站内链接与 sitemap 全部命中产物。");
