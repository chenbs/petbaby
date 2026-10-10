/**
 * 自动化测试公共库。
 * 脚本一律放在小程序目录之外 —— 写在小程序根目录里会触发开发者工具的文件监听器重编译，
 * 编译期间自动化通道会超时（表现为 "timeout waiting for automator response"）。
 */
const path = require("path");
const automator = require("miniprogram-automator");

/*
 * 开发者工具在编译/忙的时候会回一条 "timeout waiting for automator response"，
 * 而 automator 的 Connection 在无 id 的消息上直接 emit，没人接就变成未捕获异常。
 * 这类超时是环境噪声、不是页面缺陷，统一吞掉并在调用处重试。
 */
process.on("uncaughtException", (e) => {
  const msg = (e && e.message) || String(e);
  if (/timeout waiting for automator response|Connection closed/i.test(msg)) return;
  console.error("UNCAUGHT:", e && e.stack ? e.stack : msg);
  process.exit(1);
});

const WS = process.env.MP_WS || "ws://127.0.0.1:9501";
const OUT = path.join(__dirname, "out");
const BASE = process.env.MP_BASE || "http://192.168.71.144:3300";

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function requireOut() {
  require("fs").mkdirSync(OUT, { recursive: true });
  return OUT;
}

/** 建立连接并等待模拟器就绪；IDE 刚启动时 currentPage 会超时。 */
async function connect(opts) {
  const o = opts || {};
  const mp = await automator.connect({ wsEndpoint: o.ws || WS });
  const errors = [];
  mp.on("exception", (e) => errors.push("exception:" + (e && e.message ? e.message : JSON.stringify(e))));
  /*
   * automator 把小程序侧的未捕获异常以 EventEmitter 的 "error" 事件广播；
   * "error" 没有监听器时 EventEmitter 会把参数直接 throw 出来（表现为 "Uncaught [object Object]"），
   * 看上去像连接故障，实际是被掩盖的页面异常。必须注册这个监听器。
   */
  mp.on("error", (e) => errors.push("error:" + (e && e.message ? e.message : JSON.stringify(e))));
  mp.on("console", (m) => {
    const t = (m.args || []).join(" ");
    if (m.type === "error" || /\berror\b|fail/i.test(t)) errors.push("console:" + t.slice(0, 300));
  });
  mp._collectedErrors = errors;

  let ready = false;
  for (let i = 0; i < 20; i++) {
    try {
      const p = await mp.currentPage();
      if (p && p.path) {
        ready = true;
        break;
      }
    } catch (e) {
      /* 模拟器尚未就绪 */
    }
    await sleep(3000);
  }
  if (!ready) throw new Error("模拟器未就绪：currentPage 反复超时");
  return mp;
}

/** 在小程序运行时里发一次 wx.request，走端上同样的 HTTP 路径。 */
function wxRequest(mp, opts) {
  return mp.evaluate(
    (o) =>
      new Promise((resolve) => {
        wx.request({
          url: o.url,
          method: o.method || "GET",
          data: o.data || {},
          header: o.header || {},
          success: (r) => resolve({ status: r.statusCode, body: r.data }),
          fail: (e) => resolve({ fail: e.errMsg }),
        });
      }),
    opts
  );
}

/** 设为已登录：在运行时里登录一次并存会话，随后所有请求都带 Bearer。 */
async function loginAs(mp, accountName, password) {
  const session = await wxRequest(mp, {
    url: BASE + "/api/auth/password/login",
    method: "POST",
    data: { accountName, password },
    header: { "content-type": "application/json", "x-petbaby-client": "miniprogram" },
  });
  if (!session.body || !session.body.data || !session.body.data.sessionToken) {
    throw new Error("登录失败: " + JSON.stringify(session).slice(0, 200));
  }
  const token = session.body.data.sessionToken;
  await mp.callWxMethod("setStorageSync", "petbaby_session", token);
  await mp.callWxMethod("setStorageSync", "petbaby_session_source", "password");
  return token;
}

async function clearSession(mp) {
  await mp.callWxMethod("removeStorageSync", "petbaby_session");
  await mp.callWxMethod("removeStorageSync", "petbaby_session_source");
}

/** 读当前页的关键状态。 */
async function snapshot(mp) {
  const page = await mp.currentPage();
  const info = { path: page.path, query: page.query, notes: [], texts: [] };
  try {
    const d = await page.data();
    ["error", "message", "recordError", "notice", "formError", "documentHint", "headline", "empty"].forEach((k) => {
      if (typeof d[k] === "string" && d[k]) info.notes.push(`${k}=${d[k]}`);
      if (d[k] === true) info.notes.push(`${k}=true`);
    });
    info.data = d;
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

/** 按可见文案真实点击。 */
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
  await sleep(o.waitMs === undefined ? 1800 : o.waitMs);
  return { ok: true, matches: hit.length };
}

/** 点击包含某段文字的第一个元素（比全等匹配宽松）。 */
async function tapContains(mp, text, opts) {
  const o = opts || {};
  const page = await mp.currentPage();
  const tags = o.tags || ["t-button", "button", "view"];
  for (const tag of tags) {
    const els = await page.$$(tag);
    for (const el of els) {
      let t = "";
      try {
        t = await el.text();
      } catch (e) {
        continue;
      }
      if (t && t.indexOf(text) >= 0) {
        await el.tap();
        await sleep(o.waitMs === undefined ? 1800 : o.waitMs);
        return { ok: true, text: t.trim() };
      }
    }
  }
  return { ok: false, reason: "找不到含「" + text + "」的元素" };
}

async function shot(mp, name) {
  try {
    requireOut();
    const page = await mp.currentPage();
    await page.screenshot({ path: path.join(OUT, name + ".png") });
    return name + ".png";
  } catch (e) {
    return null;
  }
}

/** 一个测试步骤，自动记录步骤中新增的控制台错误。 */
function makeRunner(mp) {
  const steps = [];
  const shots = [];
  return {
    steps,
    shots,
    async step(name, fn) {
      const before = mp._collectedErrors.length;
      const rec = { name, ok: false, detail: null };
      try {
        rec.detail = await fn();
        rec.ok = true;
      } catch (e) {
        rec.detail = "抛错: " + e.message;
      }
      rec.newErrors = mp._collectedErrors.slice(before);
      if (!rec.ok || rec.newErrors.length) rec.failed = true;
      steps.push(rec);
      let line = "";
      try {
        line = JSON.stringify(rec.detail);
      } catch (e) {
        line = String(rec.detail);
      }
      process.stdout.write(`${rec.failed ? "x" : "·"} ${name} → ${line.slice(0, 240)}\n`);
      return rec;
    },
    record(shotName) {
      shots.push(shotName);
    },
    summary() {
      const failed = steps.filter((s) => s.failed);
      console.log("\n=== 汇总 ===");
      console.log("步骤 " + steps.length + "，失败 " + failed.length + "，控制台错误 " + mp._collectedErrors.length);
      failed.forEach((s) => {
        let d = "";
        try {
          d = JSON.stringify(s.detail);
        } catch (e) {
          d = String(s.detail);
        }
        console.log("  FAIL " + s.name + " | " + d.slice(0, 300));
        s.newErrors.slice(0, 2).forEach((e) => console.log("        " + e.slice(0, 200)));
      });
      return { steps, failed, errors: mp._collectedErrors };
    },
  };
}

function writeReport(name, payload) {
  requireOut();
  require("fs").writeFileSync(path.join(OUT, name), JSON.stringify(payload, null, 2));
}

module.exports = {
  WS,
  OUT,
  BASE,
  sleep,
  requireOut,
  connect,
  wxRequest,
  loginAs,
  clearSession,
  snapshot,
  tapText,
  tapContains,
  shot,
  makeRunner,
  writeReport,
};
