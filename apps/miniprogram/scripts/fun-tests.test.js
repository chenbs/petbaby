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

function loadPage(request, wxOverrides, schedule) {
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
      if (name.endsWith("sample-assets")) return { manifest: { funTests: {} } };
      return { request };
    }, wx, console, Array, setTimeout: schedule || ((callback) => callback())
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

test("最后一题先展示 2.6 秒过渡，结果就绪后才揭晓", async () => {
  const timers = [];
  const page = loadPage(async () => result, {}, (callback, delay) => { timers.push({ callback, delay }); });
  page.setData({ test: detail, petName: "年糕", stage: "question", questionIndex: 9, question: detail.questions[9], answers: Array(9).fill(0) });
  const submission = page.chooseAnswer({ currentTarget: { dataset: { index: 1 } } });
  assert.equal(page.data.stage, "thinking");
  assert.equal(page.data.busy, true);
  await new Promise(setImmediate);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].delay, 2600);
  assert.equal(page.data.stage, "thinking");
  timers[0].callback();
  await submission;
  assert.equal(page.data.stage, "result");
  assert.equal(page.data.busy, false);
});

test("结果提交失败时回到最后一题并保留答案", async () => {
  const page = loadPage(async () => { throw new Error("网络暂不可用"); });
  page.setData({ test: detail, petName: "年糕", stage: "question", questionIndex: 9, question: detail.questions[9], answers: Array(9).fill(0) });
  await page.chooseAnswer({ currentTarget: { dataset: { index: 2 } } });
  assert.equal(page.data.stage, "question");
  assert.equal(page.data.busy, false);
  assert.equal(page.data.answers[9], 2);
  assert.equal(page.data.error, "网络暂不可用");
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

test("结果海报带宠物照片、关键词贴纸和小程序码，并交给系统相册保存", async () => {
  let saved = "";
  const drawn = { images: [], texts: [] };
  const noop = () => {};
  const context = {
    setFillStyle: noop, fillRect: noop, setFontSize: noop, setGlobalAlpha: noop, setTextAlign: noop,
    setStrokeStyle: noop, setLineWidth: noop, setLineDash: noop, beginPath: noop, arc: noop, clip: noop,
    stroke: noop, moveTo: noop, lineTo: noop, save: noop, restore: noop, translate: noop, rotate: noop,
    drawImage(path) { drawn.images.push(path); },
    fillText(text) { drawn.texts.push(text); },
    draw(_reserve, callback) { callback(); }
  };
  const downloads = [];
  const page = loadPage(async () => [], {
    createCanvasContext: () => context,
    getImageInfo: ({ src, success }) => success({ width: 600, height: 600, path: src }),
    downloadFile: ({ url, success }) => { downloads.push(url); success({ statusCode: 200, tempFilePath: "tmp-" + downloads.length + ".png" }); },
    canvasToTempFilePath: ({ success }) => success({ tempFilePath: "poster.png" }),
    saveImageToPhotosAlbum: ({ filePath, success }) => { saved = filePath; success(); },
    getStorageSync: () => "session-token"
  });
  page.setData({ result, stage: "result", pets: [{ name: "年糕", avatarUrl: "/api/media/avatar.png" }] });
  await page.savePoster();
  assert.equal(saved, "poster.png");
  assert.equal(page.data.busy, false);
  // 宠物照片 + 分享小程序码都参与绘制；关键词以贴纸形式出现
  assert.ok(downloads.some((url) => url.endsWith("/api/media/avatar.png")));
  assert.ok(downloads.some((url) => url.endsWith("/api/fun-test-share/" + result.shareToken + "/code")));
  assert.ok(drawn.texts.includes("#好奇"));
  assert.ok(drawn.texts.includes(result.outcome.name));
  assert.ok(drawn.images.length >= 2);
});
