const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { loadWallet } = require("./wallet-test-harness");

const tick = () => new Promise((resolve) => setImmediate(resolve));
const insufficient = () => Object.assign(new Error("余额不足"), { code: "WALLET_INSUFFICIENT", details: { required: 18, balance: 1, shortfall: 17 } });

test("健康档案下载失败有提示，HTTP 错误文件不会交给系统打开", () => {
  let definition, download, opened = 0, open;
  const wx = {
    getStorageSync: () => "test-session",
    downloadFile(options) { download = options; },
    openDocument(options) { opened++; open = options; }
  };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages/health/health.js"), "utf8"), {
    require(name) {
      if (name.endsWith("page-mixin")) return { themedPage(value) { definition = value; } };
      if (name.endsWith("/wallet")) return { walletSheetMethods: {} };
      if (name.endsWith("/config")) return { apiBaseUrl: "https://example.test" };
      return {};
    }, wx
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData });
  const event = { currentTarget: { dataset: { id: "document" } } };
  page.downloadDocument(event);
  download.success({ statusCode: 404, tempFilePath: "error.json" });
  assert.equal(opened, 0);
  assert.match(page.data.documentHint, /下载失败/);
  page.downloadDocument(event);
  download.success({ statusCode: 200, tempFilePath: "archive.pdf" });
  assert.equal(opened, 1);
  open.fail({ errMsg: "openDocument:fail" });
  assert.match(page.data.documentHint, /打开失败/);
  page.downloadDocument(event);
  download.fail({ errMsg: "downloadFile:fail timeout" });
  assert.match(page.data.documentHint, /下载失败/);
  page.downloadDocument(event);
  download.success({ statusCode: 200, tempFilePath: "archive.pdf" });
  open.success();
  assert.equal(page.data.documentHint, "");
});

function setData(values) {
  Object.keys(values).forEach((key) => {
    const parts = key.split(".");
    if (parts.length === 2) this.data[parts[0]][parts[1]] = values[key];
    else this.data[key] = values[key];
  });
}

test("请求层保留 402 的余额与差额，充值后以原幂等键重放且只成功扣费一次", async () => {
  const calls = [];
  const module = { exports: {} };
  let paid = false;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/api.js"), "utf8"), {
    module, require: () => ({ apiBaseUrl: "https://example.test" }),
    wx: { getStorageSync: () => "session", request(options) {
      calls.push(options.data.idempotencyKey);
      options.success(paid ? { statusCode: 201, data: { data: { id: "task" } } } : { statusCode: 402, data: { error: { code: "WALLET_INSUFFICIENT", message: "余额不足", details: { required: 18, balance: 1, shortfall: 17 } } } });
    } }
  });
  const wallet = loadWallet(module.exports);
  const page = Object.assign({ data: {}, setData }, wallet.walletSheetMethods);
  const pending = wallet.withDongan(page, () => module.exports.request("/api/generations", { method: "POST", data: { idempotencyKey: "same-key-123" } }));
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.walletSheet)), { visible: true, required: 18, balance: 1, shortfall: 17 });
  paid = true; page.onWalletPaid({ detail: { balance: 23 } });
  assert.equal((await pending).id, "task");
  assert.deepEqual(calls, ["same-key-123", "same-key-123"]);
  assert.equal(page.data.walletSheet.visible, false);
});

test("关闭充值面板不重发任务；仍不足时继续补充，其他错误直接传播", async () => {
  const wallet = loadWallet({});
  const page = Object.assign({ data: {}, setData }, wallet.walletSheetMethods);
  let count = 0;
  const cancelled = wallet.withDongan(page, async () => { count++; throw insufficient(); });
  const rejected = assert.rejects(cancelled, { code: "WALLET_TOPUP_CANCELLED" });
  await tick(); page.onWalletSheetClose(); await rejected;
  assert.equal(count, 1);
  const repeated = wallet.withDongan(page, async () => { count++; if (count < 4) throw insufficient(); return "done"; });
  await tick(); page.onWalletPaid({ detail: { balance: 7 } });
  await tick(); assert.equal(page.data.walletSheet.visible, true);
  page.onWalletPaid({ detail: { balance: 23 } }); assert.equal(await repeated, "done");
  await assert.rejects(wallet.withDongan(page, async () => { throw Object.assign(new Error("冻结"), { code: "WALLET_FROZEN" }); }), { code: "WALLET_FROZEN" });
});

test("零食柜按差额选档，纪念场景不会默认选择已隐藏的首充", async () => {
  const packages = { first: { id: "first", amount: 6, units: 12, gift: 6 }, packages: [
    { id: "p6", amount: 6, units: 6, gift: 0 }, { id: "p18", amount: 18, units: 22, gift: 4 }, { id: "p38", amount: 38, units: 50, gift: 12 }
  ] };
  let definition;
  const wallet = loadWallet({ request: async () => packages });
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../components/wallet-sheet/index.js"), "utf8"), {
    require: (name) => name.endsWith("wallet") ? wallet : { getThemeId: () => "pet" }, Component(value) { definition = value; }
  });
  const component = Object.assign({ data: { quiet: true, shortfall: 4 }, setData }, definition.methods);
  component.load(); await tick();
  assert.equal(component.data.first, null);
  assert.equal(component.data.selected.id, "p18");
  assert.equal(wallet.decoratePackages(packages, 23).selectedId, "p38");
});

test("充值通过现金订单支付后回查钱包，到账数据由服务端决定", async () => {
  const requests = [], payments = [];
  const wallet = loadWallet({ request: async (url, options) => { requests.push([url, options]); return url === "/api/wallet/topups" ? { id: "topup" } : { balance: 13 }; } }, { pay: async (...args) => payments.push(args) });
  assert.equal((await wallet.topup("first")).balance, 13);
  assert.deepEqual(payments, [["growth", "topup"]]);
  assert.equal(requests[0][1].data.packageId, "first");
  assert.equal(requests[1][0], "/api/wallet");
});

const scenarios = [
  ["commerce", "report", (page) => {}, { id: "report" }, "/api/annual-reports"],
  ["health", "exportDocument", (page) => { page.data.pets = [{ id: "pet" }]; page.data.petIndex = 0; page.loadDocuments = () => {}; }, { id: "document" }, "/api/health-documents"],
  ["work", "unlock", (page) => { page.data.work = { id: "work", locked: true }; page.reload = () => {}; }, { work: { locked: false } }, "/api/works/work/unlock"],
  ["video", "render", (page) => { page.data.id = "project"; }, { id: "render", status: "queued" }, "/api/video-projects/project/render"],
  ["timeline", "confirmFilm", (page) => { page.data.petId = "pet"; page.data.filmPreview = { petId: "pet", year: 2026, durationSeconds: 20, photos: [{ id: "photo" }] }; }, { petName: "年糕", shots: 1 }, "/api/annual-films"],
  ["memorials", "chooseProduct", (page) => { page.data.productsFor = "memorial"; }, { id: "render" }, "/api/memorials/memorial/products"]
];
for (const [name, action, setup, result, endpoint] of scenarios) test(name + "付费入口余额不足时充值并重放原请求", async () => {
  let definition;
  const calls = [];
  const api = { request: async (url, options) => { calls.push([url, options]); if (calls.length === 1) throw insufficient(); return result; } };
  const wallet = loadWallet(api);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require(module) {
      if (module.endsWith("page-mixin")) return { themedPage: (a,b) => { definition = b || a; } };
      if (module.endsWith("/wallet")) return wallet;
      if (module.endsWith("/api")) return api;
      if (module.endsWith("photo-files")) return { displayMediaTree: async (data) => data };
      if (module.endsWith("scene-presets")) return { SCENE_PRESETS: [] };
      return {};
    }, setTimeout: () => 1, clearTimeout() {}, wx: {}
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData });
  page.load = () => {}; setup(page);
  page[action]({ detail: { key: "video" } }); await tick();
  assert.equal(page.data.walletSheet.visible, true);
  assert.equal(calls[0][0], endpoint);
  page.onWalletPaid({ detail: { balance: 30 } }); await tick();
  assert.equal(calls.length, 2);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])), JSON.parse(JSON.stringify(calls[1])));
});

test("健康档案零余额时弹充值面板，取消后解除加载并允许再次导出", async () => {
  let definition, funded = false;
  const requests = [];
  const api = { request: async (url) => {
    requests.push(url);
    if (!funded) throw Object.assign(new Error("冻干不够啦"), {
      code: "WALLET_INSUFFICIENT", details: { required: 6, balance: 0, shortfall: 6 }
    });
    return { id: "document" };
  } };
  const wallet = loadWallet(api);
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages/health/health.js"), "utf8"), {
    require(name) {
      if (name.endsWith("page-mixin")) return { themedPage(value) { definition = value; } };
      if (name.endsWith("/wallet")) return wallet;
      if (name.endsWith("/api")) return api;
      return {};
    }, wx: {}
  });
  const page = Object.assign({}, definition, { data: JSON.parse(JSON.stringify(definition.data)), setData });
  page.data.pets = [{ id: "pet" }];
  page.data.petIndex = 0;
  let refreshed = 0;
  page.loadDocuments = () => { refreshed++; };

  const cancelled = page.exportDocument();
  await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(page.data.walletSheet)), { visible: true, required: 6, balance: 0, shortfall: 6 });
  page.exportDocument();
  assert.equal(requests.length, 1);
  page.onWalletSheetClose();
  await cancelled;
  assert.equal(page.data.documentBusy, false);
  assert.equal(page.data.walletSheet.visible, false);
  assert.equal(page.data.documentHint, "");
  assert.equal(refreshed, 0);
  assert.equal(requests.length, 1);

  const exported = page.exportDocument();
  await tick();
  assert.equal(page.data.walletSheet.visible, true);
  funded = true;
  page.onWalletPaid({ detail: { balance: 6 } });
  await exported;
  assert.equal(requests.length, 3);
  assert.equal(refreshed, 1);
  assert.equal(page.data.documentBusy, false);
  assert.equal(page.data.walletSheet.visible, false);
  assert.equal(page.data.documentHint, "已导出，可以下载保存。");

  // 模拟 JS 已更新、JSON/WXML 编译缓存未更新，运行时没有充值组件。
  funded = false;
  page.selectComponent = () => null;
  await page.exportDocument();
  assert.equal(requests.length, 4);
  assert.equal(page.data.documentBusy, false);
  assert.equal(page.data.walletSheet.visible, false);
  assert.equal(page._walletResolve, null);
  assert.match(page.data.documentHint, /充值面板暂未加载/);
});

test("已挂载的充值组件可以打开，缺失组件明确失败而非留下付款等待", async () => {
  const wallet = loadWallet({});
  const selectors = [];
  const page = Object.assign({ data: {}, setData, selectComponent(selector) { selectors.push(selector); return {}; } }, wallet.walletSheetMethods);
  const pending = page.openWalletSheet({ required: 6, balance: 0, shortfall: 6 });
  assert.equal(page.data.walletSheet.visible, true);
  assert.deepEqual(selectors, ["#wallet-sheet"]);
  page.onWalletSheetClose();
  assert.equal(await pending, false);
  page.selectComponent = () => null;
  await assert.rejects(page.openWalletSheet({ required: 6 }), { code: "WALLET_SHEET_UNAVAILABLE" });
  assert.equal(page.data.walletSheet.visible, false);
  assert.equal(page._walletResolve, null);
});
