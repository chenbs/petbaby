const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const detail = {
  id: "hidden-personality", title: "它的隐藏性格", cover: "personality", questionCount: 10,
  questions: Array.from({ length: 10 }, (_, index) => ({ prompt: "问题" + index, choices: ["A", "B", "C"] }))
};
const result = {
  id: "result-1", testId: detail.id, testTitle: detail.title, cover: detail.cover,
  petName: "年糕", shareToken: "a".repeat(32),
  outcome: { name: "社交小太阳", description: "很有活力", closing: "一起开心", keywords: ["好奇", "热场"] }
};

function loadPage(request, wxOverrides) {
  let definition;
  const wx = Object.assign({
    getSystemInfoSync: () => ({ windowWidth: 375 }),
    showToast: () => {},
  }, wxOverrides || {});
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages/fun-tests/fun-tests.js"), "utf8"), {
    require: (name) => {
      if (name.endsWith("page-mixin")) return { themedPage: (page) => { definition = page; } };
      if (name.endsWith("manager")) return { getTheme: () => ({ navBarBackground: "#fff", primary: "#123", textPrimary: "#234", textSecondary: "#345" }) };
      if (name.endsWith("config")) return { apiBaseUrl: "https://example.test" };
      return { request };
    }, wx, console, Array
  });
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values); }
  });
}

test("趣味测试从目录连续完成 10 题，保存结果并生成正确的小程序分享路径", async () => {
  const calls = [];
  const page = loadPage(async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/fun-tests") return [detail];
    if (url === "/api/pets") return [{ id: "pet-1", name: "年糕", isDefault: true }];
    if (url === "/api/fun-test-results") return [];
    if (url === "/api/fun-tests/hidden-personality/start") return { started: true };
    if (url === "/api/fun-tests/hidden-personality" && options && options.method === "POST") return result;
    if (url === "/api/fun-tests/hidden-personality") return detail;
    throw new Error(url);
  });
  await page.load();
  await new Promise(setImmediate);
  assert.equal(page.data.tests.length, 1);
  assert.equal(page.data.petName, "年糕");
  await page.openTest({ currentTarget: { dataset: { id: detail.id } } });
  await page.start();
  assert.equal(page.data.progress, 10);
  for (let index = 0; index < 10; index++) await page.chooseAnswer({ currentTarget: { dataset: { index: index % 3 } } });
  assert.equal(page.data.stage, "result");
  assert.equal(page.data.history.length, 1);
  const submission = calls.find(([url, options]) => url === "/api/fun-tests/hidden-personality" && options && options.method === "POST");
  assert.deepEqual(Array.from(submission[1].data.answers), [0, 1, 2, 0, 1, 2, 0, 1, 2, 0]);
  assert.match(page.onShareAppMessage().path, /shareToken=a{32}$/);
  assert.equal(page.onShareTimeline().query, "shareToken=" + "a".repeat(32));
});

test("未登录时在开始前转到登录页，不消耗十道题", async () => {
  let target = "";
  const page = loadPage(async (url) => {
    if (url.endsWith("/start")) throw Object.assign(new Error("请登录"), { statusCode: 401 });
    return detail;
  }, { navigateTo: ({ url }) => { target = url; } });
  page.setData({ test: detail, petName: "年糕", stage: "intro" });
  await page.start();
  assert.equal(target, "/pages/login/login");
  assert.equal(page.data.stage, "intro");
  assert.deepEqual(page.data.answers, []);
});

test("访客通过分享 token 直接读公开结果，不请求私人档案", async () => {
  const calls = [];
  const page = loadPage(async (url) => { calls.push(url); return result; });
  await page.loadShared(result.shareToken);
  assert.deepEqual(calls, ["/api/fun-test-share/" + result.shareToken]);
  assert.equal(page.data.stage, "result");
  assert.equal(page.data.ownResult, false);
});

test("结果海报可生成并交给系统相册保存", () => {
  let saved = "";
  const context = {
    setFillStyle() {}, fillRect() {}, setFontSize() {}, fillText() {},
    draw(_reserve, callback) { callback(); }
  };
  const page = loadPage(async () => [], {
    createCanvasContext: () => context,
    canvasToTempFilePath: ({ success }) => success({ tempFilePath: "poster.png" }),
    saveImageToPhotosAlbum: ({ filePath, success, complete }) => { saved = filePath; success(); complete(); }
  });
  page.setData({ result, stage: "result" });
  page.savePoster();
  assert.equal(saved, "poster.png");
  assert.equal(page.data.busy, false);
});
