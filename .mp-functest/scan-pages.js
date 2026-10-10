/**
 * 小程序全页面功能巡检。
 * 连接开发者工具自动化端口，注入会话，逐页打开并收集控制台错误 / 异常 / 页面状态。
 */
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const WS = process.env.MP_WS || "ws://127.0.0.1:9420";
const SESSION = process.env.MP_SESSION || "";
const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(__dirname, "out");
const REPORT = path.join(OUT, "page-scan.json");

const appJson = JSON.parse(fs.readFileSync(path.join(ROOT, "app.json"), "utf8"));
const TAB_PAGES = new Set((appJson.tabBar.list || []).map((t) => t.pagePath));

function allPages() {
  const pages = [...(appJson.pages || [])];
  const subs = appJson.subPackages || appJson.subpackages || [];
  subs.forEach((s) => (s.pages || []).forEach((p) => pages.push(`${s.root}/${p}`)));
  return pages;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });

  const events = [];
  mp.on("console", (msg) => {
    events.push({ kind: "console", type: msg.type, text: (msg.args || []).join(" ") });
  });
  mp.on("exception", (err) => {
    events.push({ kind: "exception", text: err.message || JSON.stringify(err) });
  });

  // 注入会话，避免走登录页
  if (SESSION) {
    await mp.callWxMethod("setStorageSync", "petbaby_session", SESSION);
    await mp.callWxMethod("setStorageSync", "petbaby_session_source", "password");
  }

  const results = [];
  for (const p of allPages()) {
    const before = events.length;
    const rec = { page: p, ok: false, errors: [], warnings: [], dataKeys: [], notes: [] };
    try {
      if (TAB_PAGES.has(p)) {
        await mp.reLaunch(`/${p}`);
      } else {
        await mp.reLaunch("/pages/index/index");
        await sleep(400);
        await mp.navigateTo(`/${p}`);
      }
      await sleep(1600);
      const page = await mp.currentPage();
      rec.actualPath = page.path;
      if (page.path !== p.replace(/^\//, "")) rec.notes.push(`期望 ${p} 实际 ${page.path}`);
      try {
        const d = await page.data();
        rec.dataKeys = Object.keys(d).filter((k) => k !== "__webviewId__");
        const errorish = ["error", "message", "recordError", "notice", "empty"];
        errorish.forEach((k) => {
          if (typeof d[k] === "string" && d[k]) rec.notes.push(`${k}=${String(d[k]).slice(0, 120)}`);
        });
      } catch (e) {
        rec.notes.push("data() 失败: " + e.message);
      }
      rec.ok = true;
    } catch (e) {
      rec.notes.push("打开失败: " + e.message);
    }
    const slice = events.slice(before);
    slice.forEach((ev) => {
      const line = `${ev.kind}/${ev.type || ""} ${ev.text}`;
      if (ev.kind === "exception") rec.errors.push(line);
      else if (/error|fail|uncaught/i.test(ev.type || "") || /error|fail/i.test(ev.text)) rec.errors.push(line);
      else rec.warnings.push(line);
    });
    results.push(rec);
    process.stdout.write(`${rec.ok ? "·" : "x"} ${p}${rec.errors.length ? " [" + rec.errors.length + " err]" : ""}\n`);
  }

  fs.writeFileSync(REPORT, JSON.stringify({ pages: results, eventCount: events.length }, null, 2));
  console.log("\n=== 汇总 ===");
  const bad = results.filter((r) => r.errors.length || !r.ok);
  console.log(`页面 ${results.length}，有问题 ${bad.length}`);
  bad.forEach((r) => {
    console.log(`\n--- ${r.page} ---`);
    r.notes.forEach((n) => console.log("  note:", n));
    r.errors.slice(0, 6).forEach((e) => console.log("  err :", e.slice(0, 300)));
  });
  // 不主动关闭：close 会同时关掉自动化端口
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
