/**
 * 真实点击巡检：登录态下逐个点开首页与底栏入口，校验跳转和落地页渲染。
 * 关键页面截图存 out/。
 */
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const WS = process.env.MP_WS || "ws://127.0.0.1:9461";
const OUT = path.join(__dirname, "out");

const errors = [];
const steps = [];
const shots = [];

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function pageInfo(mp) {
  const page = await mp.currentPage();
  const info = { path: page.path, query: page.query, texts: [], notes: [], empty: false };
  try {
    const d = await page.data();
    ["error", "message", "recordError", "notice"].forEach((k) => {
      if (typeof d[k] === "string" && d[k]) info.notes.push(`${k}=${d[k]}`);
    });
  } catch (e) {
    info.notes.push("data失败:" + e.message);
  }
  for (const tag of ["view", "text"]) {
    const els = await page.$$(tag);
    for (const el of els.slice(0, 250)) {
      try {
        const t = (await el.text()) || "";
        if (t.trim()) info.texts.push(t.trim());
      } catch (e) {}
    }
  }
  info.texts = [...new Set(info.texts)];
  return info;
}

/** 用可见文案点击。tag 限定可提高准确度。 */
async function tapText(mp, text, opts) {
  const o = opts || {};
  const page = await mp.currentPage();
  const tags = o.tags || ["view", "text", "button", "t-button"];
  const hit = [];
  for (const tag of tags) {
    const els = await page.$$(tag);
    for (const el of els) {
      let t = "";
      try {
        t = await el.text();
      } catch (e) {
        continue;
      }
      if (t && t.trim() === text) hit.push(el);
    }
  }
  if (!hit.length) return { ok: false, reason: "找不到「" + text + "」" };
  await hit[0].tap();
  await sleep(o.waitMs || 1800);
  return { ok: true, matches: hit.length };
}

async function shot(mp, name) {
  try {
    const p = path.join(OUT, name + ".png");
    const page = await mp.currentPage();
    await page.screenshot({ path: p });
    shots.push(p);
    return p;
  } catch (e) {
    return null;
  }
}

async function step(mp, name, fn) {
  const before = errors.length;
  const rec = { name, ok: false, detail: null };
  try {
    rec.detail = await fn();
    rec.ok = true;
  } catch (e) {
    rec.detail = "抛错: " + e.message;
  }
  rec.newErrors = errors.slice(before);
  if (!rec.ok || rec.newErrors.length) rec.failed = true;
  steps.push(rec);
  const line = JSON.stringify(rec.detail);
  process.stdout.write(`${rec.failed ? "x" : "·"} ${name} → ${line.slice(0, 220)}\n`);
  return rec;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on("console", (m) => {
    const t = (m.args || []).join(" ");
    if (m.type === "error" || /\berror\b|fail/i.test(t)) errors.push("console:" + t.slice(0, 200));
  });
  mp.on("exception", (e) => errors.push("exception:" + (e.message || "")));

  // 已登录态（前面脚本已登录）。先回首页。
  await mp.reLaunch("/pages/index/index");
  await sleep(3500);

  // ---------- 首页交互 ----------
  await step(mp, "首页：点分类 chip「职业反差」", async () => {
    const r = await tapText(mp, "职业反差", { waitMs: 1500 });
    if (!r.ok) return r.reason;
    const page = await mp.currentPage();
    const d = await page.data();
    return { chip: d.chip, feedLeft: (d.feedLeft || []).length, feedRight: (d.feedRight || []).length };
  });

  await step(mp, "首页：点回「全部」", async () => {
    const r = await tapText(mp, "全部", { tags: ["view"], waitMs: 1500 });
    if (!r.ok) return r.reason;
    const page = await mp.currentPage();
    const d = await page.data();
    return { chip: d.chip, left: (d.feedLeft || []).length, right: (d.feedRight || []).length };
  });

  await step(mp, "首页：点「如果我是人」去变身", async () => {
    const r = await tapText(mp, "如果我是人", { waitMs: 2500 });
    if (!r.ok) return r.reason;
    const info = await pageInfo(mp);
    await shot(mp, "01-human");
    return { path: info.path, notes: info.notes, textCount: info.texts.length };
  });

  await step(mp, "首页：从「写真馆」进宠物写真", async () => {
    await mp.reLaunch("/pages/index/index");
    await sleep(2500);
    const r = await tapText(mp, "宠物写真", { waitMs: 2500 });
    if (!r.ok) return r.reason;
    const info = await pageInfo(mp);
    await shot(mp, "02-art-photo");
    return { path: info.path, notes: info.notes, textCount: info.texts.length };
  });

  await step(mp, "首页：点「 ›」全部玩法", async () => {
    await mp.reLaunch("/pages/index/index");
    await sleep(2500);
    const r = await tapText(mp, "全部 ›", { waitMs: 2200 });
    if (!r.ok) return r.reason;
    const info = await pageInfo(mp);
    await shot(mp, "03-all-plays");
    return { path: info.path, textCount: info.texts.length, notes: info.notes };
  });

  // ---------- 底栏 tab ----------
  await step(mp, "底栏：创作", async () => {
    await mp.switchTab("/pages/art-photo/art-photo");
    await sleep(3000);
    const info = await pageInfo(mp);
    await shot(mp, "04-tab-art");
    return { path: info.path, textCount: info.texts.length, notes: info.notes };
  });

  await step(mp, "底栏：作品", async () => {
    await mp.switchTab("/pages/works/works");
    await sleep(3000);
    const info = await pageInfo(mp);
    await shot(mp, "05-tab-works");
    return { path: info.path, textCount: info.texts.length, notes: info.notes };
  });

  await step(mp, "底栏：我的", async () => {
    await mp.switchTab("/pages/me/me");
    await sleep(3000);
    const info = await pageInfo(mp);
    await shot(mp, "06-tab-me");
    return { path: info.path, textCount: info.texts.length, notes: info.notes };
  });

  await step(mp, "底栏：首页", async () => {
    await mp.switchTab("/pages/index/index");
    await sleep(2500);
    const info = await pageInfo(mp);
    return { path: info.path, textCount: info.texts.length };
  });

  fs.writeFileSync(path.join(OUT, "click-nav.json"), JSON.stringify({ steps, errors, shots }, null, 2));
  console.log("\n=== 汇总 ===");
  console.log("步骤", steps.length, "失败", steps.filter((s) => s.failed).length, "控制台错误", errors.length);
  steps.filter((s) => s.failed).forEach((s) => console.log("  FAIL", s.name, "|", JSON.stringify(s.detail).slice(0, 260), s.newErrors.slice(0, 2)));
  // 不主动关闭：close 会同时关掉自动化端口
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
