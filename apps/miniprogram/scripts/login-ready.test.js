const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
 * 首次扫码进入时，首页请求不能抢在启动静默登录之前发出（否则拿到 401，顶部提示「登录状态已失效」）。
 * services/api.js 先等 app.globalData.loginReady 落定；登录接口本身不等。
 */
function loadApi(app) {
  const calls = [];
  const wx = {
    getStorageSync: (key) => (key === "petbaby_session" ? app.session || "" : ""),
    removeStorageSync() {},
    reLaunch() {},
    request(options) { calls.push(options.url); options.success({ statusCode: 200, data: { data: { ok: true } } }); }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/api.js"), "utf8"), {
    module, exports: module.exports, wx, getApp: () => app, setTimeout, Promise,
    require: (name) => (name.endsWith("/config") ? { apiBaseUrl: "https://api.test" } : {})
  });
  return { api: module.exports, calls };
}

const tick = () => new Promise((resolve) => setImmediate(resolve));

test("业务请求等启动登录完成后才发出，且带上新会话", async () => {
  let finish;
  const app = { globalData: { loginReady: new Promise((resolve) => { finish = resolve; }) } };
  const { api, calls } = loadApi(app);
  const pending = api.request("/api/pets");
  await tick();
  assert.deepEqual(calls, []);
  app.session = "fresh-session";
  finish();
  await pending;
  assert.deepEqual(calls, ["https://api.test/api/pets"]);
});

test("登录接口本身不等 loginReady，否则会自己等自己", async () => {
  const app = { globalData: { loginReady: new Promise(() => {}) } };
  const { api, calls } = loadApi(app);
  await api.request("/api/auth/wechat", { method: "POST" });
  assert.deepEqual(calls, ["https://api.test/api/auth/wechat"]);
});

test("没有 loginReady（如测试或旧入口）时照常请求", async () => {
  const { api, calls } = loadApi({ globalData: {} });
  await api.request("/api/plugins");
  assert.deepEqual(calls, ["https://api.test/api/plugins"]);
});
