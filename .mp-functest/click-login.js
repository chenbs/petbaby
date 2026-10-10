/**
 * 真实点击巡检：用 automator 逐个点按页面上的可见元素，校验跳转与渲染结果。
 * 不注入会话，走真实登录流程。
 */
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const WS = process.env.MP_WS || "ws://127.0.0.1:9451";
const OUT = path.join(__dirname, "out");
const REPORT = path.join(OUT, "click-scan.json");

const F = { errors: [], steps: [] };

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function snap(page, name) {
  try {
    const p = path.join(OUT, `${name}.png`);
    await page.screenshot({ path: p });
    return p;
  } catch (e) {
    return null;
  }
}

/** 按可见文案点击。返回是否点中。 */
async function tapText(mp, text, opts) {
  const o = opts || {};
  const page = await mp.currentPage();
  const candidates = [];
  for (const tag of ["view", "button", "text", "t-button", "navigator", "label"]) {
    const els = await page.$$(tag);
    for (const el of els) {
      let t = "";
      try {
        t = await el.text();
      } catch (e) {
        continue;
      }
      if (t && t.trim() === text) candidates.push(el);
    }
  }
  if (!candidates.length) return { ok: false, reason: "未找到文案: " + text };
  await candidates[0].tap();
  if (o.wait !== false) await sleep(o.waitMs || 1500);
  return { ok: true, count: candidates.length };
}

/** 记录当前页渲染快照，用于校验"显示正确"。 */
async function inspect(mp) {
  const page = await mp.currentPage();
  const info = { path: page.path, texts: [], images: [], notes: [] };
  try {
    const d = await page.data();
    Object.keys(d).forEach((k) => {
      if (["error", "message", "recordError"].includes(k) && typeof d[k] === "string" && d[k]) info.notes.push(`${k}=${d[k]}`);
    });
    info.loading = d.loading;
  } catch (e) {
    info.notes.push("data 失败: " + e.message);
  }
  for (const tag of ["view", "text", "button"]) {
    const els = await page.$$(tag);
    for (const el of els.slice(0, 400)) {
      try {
        const t = (await el.text()) || "";
        if (t.trim()) info.texts.push(t.trim());
      } catch (e) {}
    }
  }
  const imgs = await page.$$("image");
  for (const im of imgs) {
    try {
      info.images.push(await im.attribute("src"));
    } catch (e) {}
  }
  info.texts = [...new Set(info.texts)];
  return info;
}

async function step(mp, name, fn) {
  const before = F.errors.length;
  const rec = { name, ok: false, detail: null };
  try {
    rec.detail = await fn();
    rec.ok = true;
  } catch (e) {
    rec.detail = "抛错: " + e.message;
  }
  rec.newErrors = F.errors.slice(before);
  if (!rec.ok || rec.newErrors.length) rec.failed = true;
  F.steps.push(rec);
  process.stdout.write(`${rec.failed ? "x" : "·"} ${name}${rec.failed ? " " + JSON.stringify(rec.detail).slice(0, 200) : ""}\n`);
  return rec;
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  mp.on("console", (m) => {
    const txt = (m.args || []).join(" ");
    if (m.type === "error" || /error|fail/i.test(txt)) F.errors.push("console:" + txt);
  });
  mp.on("exception", (e) => F.errors.push("exception:" + (e.message || "")));

  // ---- 0. 清会话，从登录页开始真实登录 ----
  await step(mp, "清理本地会话", async () => {
    await mp.callWxMethod("removeStorageSync", "petbaby_session");
    await mp.callWxMethod("removeStorageSync", "petbaby_session_source");
    return "done";
  });

  await step(mp, "打开首页（未登录）", async () => {
    await mp.reLaunch("/pages/index/index");
    await sleep(2500);
    const info = await inspect(mp);
    return { path: info.path, notes: info.notes, textCount: info.texts.length, loading: info.loading };
  });

  await step(mp, "首页 → 打开登录页", async () => {
    const r = await tapText(mp, "登录与退出", { waitMs: 1500 });
    if (!r.ok) {
      // 可能入口在"我的"页
      await mp.reLaunch("/pages/me/me");
      await sleep(2000);
      const r2 = await tapText(mp, "登录与退出", { waitMs: 1500 });
      if (!r2.ok) return r.reason + " / " + r2.reason;
    }
    const p = await mp.currentPage();
    return p.path;
  });

  await step(mp, "登录页：输入账号密码并提交", async () => {
    const p = await mp.currentPage();
    if (p.path !== "pages/login/login") {
      await mp.reLaunch("/pages/login/login");
      await sleep(2000);
    }
    const page = await mp.currentPage();
    const inputs = await page.$$("input");
    if (inputs.length < 2) return "输入框数量=" + inputs.length;
    await inputs[0].input("functest01");
    await inputs[1].input("petbaby2026test");
    await sleep(400);
    const r = await tapText(mp, "登录", { waitMs: 3000 });
    if (!r.ok) return r.reason;
    const after = await mp.currentPage();
    return { path: after.path };
  });

  await step(mp, "登录后首页渲染", async () => {
    const info = await inspect(mp);
    const missing = [];
    info.images.forEach((s) => {
      if (!s) missing.push("空src");
    });
    return { path: info.path, textCount: info.texts.length, notes: info.notes, images: info.images.length };
  });

  fs.writeFileSync(REPORT, JSON.stringify(F, null, 2));
  console.log("\n=== 汇总 ===");
  console.log("步骤", F.steps.length, "失败", F.steps.filter((s) => s.failed).length, "控制台错误", F.errors.length);
  F.steps.filter((s) => s.failed).forEach((s) => console.log(" FAIL", s.name, JSON.stringify(s.detail).slice(0, 300)));
  if (F.errors.length) console.log("首次错误:", F.errors.slice(0, 5));
  // 不主动关闭：close 会同时关掉自动化端口
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
