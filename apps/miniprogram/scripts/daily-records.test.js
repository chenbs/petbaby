const assert = require("node:assert/strict");
const { test, after } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const records = require("../services/records");

const KINDS = [
  { kind: "vomit", label: "呕吐", icon: "vomit", bodily: true, attachments: true, fields: [
    { key: "count", label: "次数", type: "count", min: 1, max: 20, defaultValue: 1, unit: "次" },
    { key: "content", label: "吐出来的", type: "choice", options: [{ value: "food", label: "没消化的粮" }, { value: "foam", label: "白色泡沫" }] },
    { key: "blood", label: "看到血", type: "toggle" }
  ] },
  { kind: "symptom", label: "不舒服", icon: "symptom", bodily: true, attachments: true, fields: [
    { key: "signs", label: "看到了什么", type: "choice", multiple: true, options: [{ value: "cough", label: "咳嗽" }, { value: "sneeze", label: "打喷嚏" }] }
  ] },
  { kind: "medication", label: "用药", icon: "medication", bodily: false, attachments: true, fields: [
    { key: "name", label: "药名", type: "text", maxLength: 40, placeholder: "", required: true },
    { key: "dose", label: "用量", type: "text", maxLength: 30, placeholder: "" },
    { key: "courseDays", label: "疗程", type: "count", min: 1, max: 60, defaultValue: 1, unit: "天" }
  ] },
  { kind: "weight", label: "体重", icon: "weight", bodily: false, attachments: false, fields: [{ key: "weightKg", label: "体重", type: "number", unit: "公斤", required: true }] }
];

const previousWx = global.wx;
after(() => { global.wx = previousWx; });

/** 在页面同一个沙箱里加载 services/pet-nav，让它读到测试的 wx 与 getCurrentPages */
function loadPetNav(sandbox) {
  const module = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/pet-nav.js"), "utf8"), Object.assign({ module, exports: module.exports }, sandbox));
  return module.exports;
}

function loadPage(name, dependencies, wx, file) {
  let definition;
  const sandboxGlobals = { wx, getCurrentPages: wx.getCurrentPages };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", file || path.join("pages", name, name + ".js")), "utf8"), {
    require: (request) => {
      if (request.endsWith("page-mixin")) return { themedPage: (a, b) => { definition = b || a; } };
      if (request.endsWith("theme/manager")) return { subscribe: () => () => {}, getTheme: () => ({}), getConstantVars: () => "", getCssVars: () => "", getSkinVars: () => "", getThemeId: () => "pet" };
      const key = request.split("/").pop();
      if (dependencies[key]) return dependencies[key];
      if (key === "companion") return require("../services/companion");
      if (key === "photo-files") return { displayMediaTree: async (data) => data };
      if (key === "pet-nav") return loadPetNav(sandboxGlobals);
      if (["sample-assets", "home-copy", "home-effect-ids"].indexOf(key) >= 0) return require(path.join(__dirname, "..", request.replace(/^(\.\.\/)+/, "")));
      return {};
    },
    Component: (options) => { definition = options; },
    wx, console, setTimeout, clearTimeout
  });
  const page = Object.assign({}, definition, definition.methods || {}, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.keys(values).forEach((key) => {
        const parts = key.split(".");
        let target = this.data;
        for (let index = 0; index < parts.length - 1; index += 1) target = target[parts[index]];
        target[parts[parts.length - 1]] = values[key];
      });
    }
  });
  return page;
}

const plain = (value) => JSON.parse(JSON.stringify(value));
// 页面里的 records 服务用假的类型清单：真实 loadKinds 会经 services/api 调 wx.request
const fakeRecords = Object.assign({}, records, { loadKinds: async () => KINDS });
const pets = [
  { id: "A", name: "年糕", isDefault: true, lifeStage: "active", birthday: "2024-01-01" },
  { id: "B", name: "汤圆", lifeStage: "memorial" },
  { id: "C", name: "芝麻", lifeStage: "senior", createdAt: "2025-01-01" }
];

function recordsApi(calls, overrides) {
  return {
    request: async (url, options) => {
      calls.push([url, options]);
      if (overrides && overrides[url]) return overrides[url](options);
      if (url === "/api/pets") return pets;
      if (url === "/api/record-kinds") return KINDS;
      if (url.endsWith("/records/overview")) return { today: records.today(), totalDays: 3, streakDays: 2, todayCount: 1, intervals: [], recentFacts: [], upcoming: [], courses: [{ logId: "L1", name: "医院开的药", dose: "半片", dayIndex: 2, courseDays: 5, dosesToday: 0 }] };
      if (url.includes("/records/visit-summary")) return { days: 14, header: ["年糕"], counts: ["呕吐 2 次"], lines: [], care: [], text: "摘要文本" };
      if (url.includes("/records?")) return { items: [
        { id: "1", source: "log", kind: "vomit", occurredOn: records.today(), occurredTime: "08:00", title: "呕吐", summary: "2 次", attachments: [] },
        { id: "2", source: "weight", kind: "weight", occurredOn: "2024-01-10", title: "体重", summary: "4 公斤", attachments: [] },
        { id: "3", source: "care", kind: "vaccine", occurredOn: "2024-01-10", title: "疫苗", summary: "猫三联", attachments: [] }
      ], nextCursor: null };
      if (url.endsWith("/records") && options && options.method === "POST") return { record: { id: "new" }, urgentAreas: [] };
      return {};
    }
  };
}

test("records 服务：表单初始值与 details 整理", () => {
  const vomit = KINDS[0];
  assert.deepEqual(plain(records.emptyValues(vomit)), { count: 1, content: "", blood: false });
  assert.deepEqual(plain(records.toDetails(vomit, { count: 2, content: "foam", blood: false })), { count: 2, content: "foam" });
  assert.deepEqual(plain(records.toDetails(KINDS[1], { signs: [] })), {});
  assert.deepEqual(plain(records.toDetails(KINDS[3], { weightKg: "4.25" })), { weightKg: 4.25 });
  // 疗程默认 1 天不发，避免每条用药都被当成疗程起点
  assert.deepEqual(plain(records.toDetails(KINDS[2], { name: " 药 ", dose: "", courseDays: 1 })), { name: "药" });
  assert.equal(records.today(new Date(2026, 0, 5, 0, 30)), "2026-01-05");
});

test("日常记录页：按天分组带陪伴天数、已离开的宠物不在切换列表里", async () => {
  records.resetKindsCache();
  const calls = [];
  const page = loadPage("records", { api: recordsApi(calls), records: fakeRecords }, {});
  page.onLoad({});
  await page.reload();
  assert.equal(page.data.pet.id, "A");
  assert.deepEqual(plain(page.data.pets.map((pet) => pet.id)), ["A", "C"]);
  assert.equal(page.data.days.length, 2);
  assert.equal(page.data.days[0].label, "今天");
  assert.equal(page.data.days[1].dayText, "陪伴第 10 天");
  assert.deepEqual(plain(page.data.days[1].items.map((item) => item.icon)), ["weight", "care"]);
  assert.equal(page.data.headline, "已记录 3 天 · 连续 2 天");
});

test("日常记录页：已离开的宠物显示封存，不发记录请求", async () => {
  records.resetKindsCache();
  const calls = [];
  const page = loadPage("records", { api: recordsApi(calls), records: fakeRecords }, {});
  page.onLoad({ petId: "B" });
  await page.reload();
  assert.equal(page.data.sealed, true);
  assert.ok(!calls.some(([url]) => url.includes("/records")));
});

test("日常记录页：快记表单单选可取消、多选、计数夹在范围内，保存带上日期时间与关联的分诊", async () => {
  records.resetKindsCache();
  const calls = [];
  const toasts = [];
  const page = loadPage("records", { api: recordsApi(calls), records: fakeRecords }, { showToast: (item) => toasts.push(item.title) });
  page.onLoad({ petId: "A", kind: "symptom", sessionId: "S1", note: encodeURIComponent("今天又吐了") });
  await page.reload();
  // 从健康助手带参进来：直接打开对应表单，备注预填
  assert.equal(page.data.form.kind, "symptom");
  assert.equal(page.data.form.note, "今天又吐了");
  page.pickChoice({ currentTarget: { dataset: { key: "signs", value: "cough", multiple: true } } });
  page.pickChoice({ currentTarget: { dataset: { key: "signs", value: "sneeze", multiple: true } } });
  page.pickChoice({ currentTarget: { dataset: { key: "signs", value: "cough", multiple: true } } });
  assert.deepEqual(plain(page.data.form.values.signs), ["sneeze"]);
  await page.saveForm();
  const post = calls.find(([url, options]) => url === "/api/pets/A/records" && options && options.method === "POST")[1].data;
  assert.equal(post.kind, "symptom");
  assert.deepEqual(plain(post.details), { signs: ["sneeze"] });
  assert.equal(post.healthSessionId, "S1");
  assert.equal(post.occurredOn, records.today());
  assert.equal(page.data.form, null);
  assert.deepEqual(toasts, ["记好了"]);
  // 从健康助手记回来的，不再提示「去问健康助手」
  assert.equal(page.data.afterSave, null);

  page.openForm({ currentTarget: { dataset: { kind: "vomit" } } });
  page.pickChoice({ currentTarget: { dataset: { key: "content", value: "foam" } } });
  page.pickChoice({ currentTarget: { dataset: { key: "content", value: "foam" } } });
  assert.equal(page.data.form.values.content, "");
  for (let index = 0; index < 30; index += 1) page.stepCount({ currentTarget: { dataset: { key: "count", step: 1 } } });
  assert.equal(page.data.form.values.count, 20);
  page.stepCount({ currentTarget: { dataset: { key: "count", step: -100 } } });
  assert.equal(page.data.form.values.count, 1);
  await page.saveForm();
  assert.ok(page.data.afterSave, "身体状况类保存后提示可以问健康助手");
});

test("日常记录页：保存命中紧急表现时给出就医提示", async () => {
  records.resetKindsCache();
  const calls = [];
  const api = recordsApi(calls, { "/api/pets/A/records": () => ({ record: { id: "x" }, urgentAreas: ["泌尿"] }) });
  const page = loadPage("records", { api, records: fakeRecords }, { showToast() {} });
  page.onLoad({ petId: "A" });
  await page.reload();
  page.openForm({ currentTarget: { dataset: { kind: "symptom" } } });
  page.inputNote({ detail: { value: "尿不出来" } });
  await page.saveForm();
  assert.deepEqual(plain(page.data.urgent), { areas: "泌尿" });
  assert.equal(page.data.afterSave, null);
});

test("日常记录页：疗程一键记今天这次、就医摘要、删除按来源调用", async () => {
  records.resetKindsCache();
  const calls = [];
  let copied = "";
  const page = loadPage("records", { api: recordsApi(calls), records: fakeRecords }, { setClipboardData: (item) => { copied = item.data; } });
  page.onLoad({ petId: "A", action: "summary" });
  await page.reload();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.data.summary.countsText, "呕吐 2 次");
  page.copySummary();
  assert.equal(copied, "摘要文本");

  page.logCourseDose({ currentTarget: { dataset: { id: "L1" } } });
  assert.equal(page.data.form.kind, "medication");
  assert.equal(page.data.form.values.name, "医院开的药");
  assert.equal(page.data.form.values.dose, "半片");

  page.askRemove({ currentTarget: { dataset: { id: "2", source: "weight", title: "体重" } } });
  await page.confirmRemove();
  assert.ok(calls.some(([url, options]) => url === "/api/pets/A/records/2?source=weight" && options.method === "DELETE"));
  assert.ok(!page.data.days.some((day) => day.items.some((item) => item.id === "2")));
});

test("健康助手：带 petId 进来选中那一只，提交带 includeRecords，结果可记回日常记录", async () => {
  const calls = [];
  const urls = [];
  const api = { request: async (url, options) => {
    calls.push([url, options]);
    if (url === "/api/pets") return pets;
    if (url.endsWith("/records/overview")) return { totalDays: 4, recentFacts: ["近 7 天记了 2 次呕吐"] };
    if (url === "/api/health-sessions" && options) return { id: "S9", description: options.data.description, triageLevel: "observe", advisory: { summary: "暂可观察", watchFor: [], visitPreparation: [] }, contextRecords: ["10-03 呕吐 · 1 次"] };
    if (url.indexOf("/api/pets/") === 0 && url.endsWith("/weights")) return { records: [] };
    return [];
  } };
  const page = loadPage("health", { api }, { navigateTo: (item) => urls.push(item.url) });
  page.onLoad({ petId: "C" });
  await page.load();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(page.data.pets[page.data.petIndex].id, "C");
  assert.deepEqual(plain(page.data.recentFacts), ["近 7 天记了 2 次呕吐"]);
  page.toggleRecords();
  page.inputDescription({ detail: { value: "今天精神不太好" } });
  await page.submit();
  const body = calls.find(([url, options]) => url === "/api/health-sessions" && options)[1].data;
  assert.equal(body.petId, "C");
  assert.equal(body.includeRecords, false);
  page.saveToRecords();
  assert.match(urls[0], /^\/pages\/records\/records\?petId=C&kind=symptom&sessionId=S9&note=/);
  page.openRecords({ currentTarget: { dataset: { action: "summary" } } });
  assert.equal(urls[1], "/pages/records/records?petId=C&action=summary");
  page.goWeights();
  assert.equal(urls[2], "/pages/pets/pets?mode=create");
});

test("日常记录 ↔ 健康助手：上一页就是目标页时返回而不是再叠一层", async () => {
  const urls = [];
  let backs = 0;
  const previous = { route: "pages/health/health", _petId: "" };
  const page = loadPage("records", { api: recordsApi([]), records: fakeRecords }, {
    navigateTo: (item) => urls.push(item.url), navigateBack: () => { backs += 1; },
    getCurrentPages: () => [previous, { route: "pages/records/records" }]
  });
  page.onLoad({ petId: "A" });
  await page.reload();
  page.openHealth();
  assert.equal(backs, 1);
  assert.equal(urls.length, 0);
  assert.equal(previous._petId, "A");

  const fresh = loadPage("records", { api: recordsApi([]), records: fakeRecords }, {
    navigateTo: (item) => urls.push(item.url), navigateBack: () => { backs += 1; },
    getCurrentPages: () => [{ route: "pages/index/index" }, { route: "pages/records/records" }]
  });
  fresh.onLoad({ petId: "A" });
  await fresh.reload();
  fresh.openHealth();
  assert.deepEqual(urls, ["/pages/health/health?petId=A"]);
});

test("底栏「＋」：收好照片 / 记一笔日常 / 问健康助手", () => {
  const urls = [];
  let sheet;
  const tabbar = loadPage("", {}, {
    vibrateShort() {},
    showActionSheet: (options) => { sheet = options; },
    navigateTo: (item) => urls.push(item.url),
    switchTab() {}
  }, "custom-tab-bar/index.js");
  tabbar.switchTab({ currentTarget: { dataset: { index: 2 } } });
  assert.deepEqual(plain(sheet.itemList), ["收好照片", "记一笔日常", "问问健康助手"]);
  sheet.success({ tapIndex: 1 });
  sheet.success({ tapIndex: 2 });
  sheet.success({ tapIndex: 0 });
  assert.deepEqual(urls, ["/pages/records/records", "/pages/health/health", "/pages/photos/photos?mode=record&entry=tabbar"]);
});

test("宠物档案「···」：在世的宠物有日常记录与健康助手，已离开的没有", () => {
  const urls = [];
  const page = loadPage("pets", {}, { navigateTo: (item) => urls.push(item.url) });
  page.data.pets = [{ id: "A", name: "年糕", lifeStage: "active", isDefault: true }, { id: "B", name: "汤圆", lifeStage: "memorial", showMemorial: true }];
  page.openMore({ currentTarget: { dataset: { id: "A" } } });
  assert.deepEqual(plain(page.data.moreActions.map((item) => item.key)), ["records", "health", "remove"]);
  page.chooseMore({ detail: { key: "records" } });
  page.openMore({ currentTarget: { dataset: { id: "A" } } });
  page.chooseMore({ detail: { key: "health" } });
  assert.deepEqual(urls, ["/pages/records/records?petId=A", "/pages/health/health?petId=A"]);
  page.openMore({ currentTarget: { dataset: { id: "B" } } });
  assert.deepEqual(plain(page.data.moreActions.map((item) => item.key)), ["default", "memorial", "remove"]);
});

test("首页照顾条：到期优先、其次疗程、再次今日条数；已离开的宠物不出现", async () => {
  const urls = [];
  let overview = { upcoming: [{ title: "疫苗 · 猫三联", daysLeft: 3, overdue: false }], courses: [], todayCount: 0, streakDays: 0 };
  const api = { request: async (url) => {
    if (url === "/api/pets") return [pets[0], pets[1]];
    if (url.endsWith("/records/overview")) return overview;
    if (url.includes("on-this-day")) return { matches: [] };
    return { items: [] };
  } };
  const home = loadPage("index", { api }, { navigateTo: (item) => urls.push(item.url), getStorageSync: () => "s" });
  await home.loadPet();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(home.data.care.text, "疫苗 · 猫三联 3 天后到期");
  overview = { upcoming: [], courses: [{ name: "药", dayIndex: 2, courseDays: 5 }], todayCount: 0, streakDays: 0 };
  await home.loadPet(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(home.data.care.text, "药 · 用药第 2 / 5 天");
  overview = { upcoming: [], courses: [], todayCount: 2, streakDays: 4 };
  await home.loadPet(); await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(home.data.care.text, "今天已记 2 条 · 连续 4 天");
  home.openRecords(); home.openHealth();
  assert.deepEqual(urls, ["/pages/records/records?petId=A", "/pages/health/health?petId=A"]);

  home._petId = "B";
  await home.loadPet();
  assert.equal(home.data.care, null);
});
