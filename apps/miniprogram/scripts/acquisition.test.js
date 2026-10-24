const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
 * 渠道归因与邀请码（2026-10-12）。不装 global.wx：服务模块在自己的沙箱里拿到存储替身。
 */
function loadAcquisition() {
  const storage = {};
  const wx = {
    getStorageSync: (key) => storage[key] === undefined ? "" : storage[key],
    setStorageSync: (key, value) => { storage[key] = JSON.parse(JSON.stringify(value)); },
    removeStorageSync: (key) => { delete storage[key]; }
  };
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/acquisition.js"), "utf8"), { module, wx, decodeURIComponent });
  return { acquisition: module.exports, storage };
}

test("启动参数：路径 query 与小程序码 scene 都能取到投放标记和邀请码", () => {
  const { acquisition } = loadAcquisition();
  assert.deepEqual(JSON.parse(JSON.stringify(acquisition.fromLaunch({ scene: 1007, query: { src: "xhs-1012-human", inv: "ABCD2345" } }))), { scene: 1007, src: "xhs-1012-human", inviteCode: "ABCD2345" });
  assert.deepEqual(JSON.parse(JSON.stringify(acquisition.fromLaunch({ scene: 1047, query: { scene: encodeURIComponent("s=shop-01&i=WXYZ2345") } }))), { scene: 1047, src: "shop-01", inviteCode: "WXYZ2345" });
  // 作品 / 趣测海报的 scene 是分享 token，不当归因
  assert.deepEqual(JSON.parse(JSON.stringify(acquisition.fromLaunch({ scene: 1047, query: { scene: "a".repeat(32) } }))), { scene: 1047 });
  assert.deepEqual(JSON.parse(JSON.stringify(acquisition.fromLaunch(undefined))), {});
});

test("只保留第一次的场景值；后来补上的邀请码会补进去", () => {
  const { acquisition } = loadAcquisition();
  acquisition.capture({ scene: 1053, query: { src: "xhs-1012" } });
  acquisition.capture({ scene: 1001, query: { inv: "ABCD2345" } });
  assert.deepEqual(JSON.parse(JSON.stringify(acquisition.loginPayload("code-1"))), { scene: 1053, src: "xhs-1012", inviteCode: "ABCD2345", code: "code-1" });
});

test("分享路径带上自己的邀请码；没有邀请码时原样返回", () => {
  const { acquisition } = loadAcquisition();
  assert.equal(acquisition.withInvite("/pages/index/index"), "/pages/index/index");
  assert.equal(acquisition.withInviteQuery("token=abc"), "token=abc");
  acquisition.rememberInviteCode("ABCD2345");
  assert.equal(acquisition.withInvite("/pages/index/index"), "/pages/index/index?inv=ABCD2345");
  assert.equal(acquisition.withInvite("/pages/share/share?token=abc"), "/pages/share/share?token=abc&inv=ABCD2345");
  assert.equal(acquisition.withInviteQuery("token=abc"), "token=abc&inv=ABCD2345");
  assert.equal(acquisition.withInviteQuery(""), "inv=ABCD2345");
  acquisition.clearInviteCode();
  assert.equal(acquisition.cachedInviteCode(), "");
});
