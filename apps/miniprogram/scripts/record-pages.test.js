const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const uploads = require("../services/photo-upload-session");

function loadPage(name, dependencies, wx) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require: (name) => {
      if (name.endsWith("page-mixin")) return { themedPage: (page) => { definition = page; } };
      const key = name.split("/").pop();
      if (dependencies[key]) return dependencies[key];
      if (key === "companion") return require("../services/companion");
      if (key === "record-events") return { recordSession: () => ({ opened() {}, viewed() {}, deliverable() {} }) };
      return {};
    }, wx, console, setTimeout, clearTimeout
  });
  const page = Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) {
      Object.keys(values).forEach((key) => {
        const parts = key.split(".");
        if (parts.length === 2) this.data[parts[0]][parts[1]] = values[key]; else this.data[key] = values[key];
      });
    }
  });
  return page;
}
const plain = (value) => JSON.parse(JSON.stringify(value));
function deferred() { let resolve; const promise = new Promise((done) => { resolve = done; }); return { promise, resolve }; }

test("A01：新档案最小输入只 POST pets，连点不重复；编辑仍走 PATCH，事件返回新 ID", async () => {
  const calls = [], pending = deferred(), emitted = [];
  let backs = 0;
  const page = loadPage("pets", { api: { request: (url, options) => { calls.push([url, options]); return pending.promise; } } }, { navigateBack: () => backs++ });
  page.getOpenerEventChannel = () => ({ emit: (...args) => emitted.push(args) });
  page.onLoad({ mode: "create", returnToRecord: "1" });
  page.inputName({ detail: { value: "年糕" } });
  const first = page.save(); page.save();
  assert.equal(calls.length, 1); assert.equal(calls[0][0], "/api/pets"); assert.equal(calls[0][1].method, "POST");
  assert.equal(calls[0][1].data.birthday, "");
  pending.resolve({ id: "created-pet" }); await first;
  assert.equal(backs, 1); assert.deepEqual(plain(emitted), [["petCreated", { petId: "created-pet" }]]);
  assert.equal(page.data.editing, null);
});

test("A01：建档结果不明时拉取列表，不自动重发 POST", async () => {
  const calls = [];
  const page = loadPage("pets", { api: { request: async (url, options) => {
    calls.push([url, options]);
    if (options) throw Object.assign(new Error("timeout"), { statusCode: 0 });
    return [];
  } } }, {});
  page.onLoad({ mode: "create" }); page.inputName({ detail: { value: "年糕" } });
  await page.save();
  assert.equal(calls.filter((call) => call[1] && call[1].method === "POST").length, 1);
  assert.equal(calls.length, 2); assert.equal(page.data.editing, null);
  assert.match(page.data.error, /不要重复新建/);
});

function gallery(request, extras) {
  const storage = {};
  const deps = {
    api: { request },
    "photo-files": { displayPhotos: async (photos) => photos, downloadPhoto: async () => "tmp-image" },
    "photo-upload-session": {
      preparePhoto: async (file) => ({ path: file.tempFilePath, name: "pet.jpg" }),
      createUploadSession: (settings) => uploads.createUploadSession(Object.assign({}, settings, { dependencies: {
        request, read: (key) => storage[key], write: (key, value) => { storage[key] = value; }, exists: async () => ({ size: 20 })
      } }))
    }
  };
  const page = loadPage("photos", deps, Object.assign({ showModal: ({ success }) => success({ confirm: true }) }, extras || {}));
  page._visible = true;
  return page;
}
const pets = [{ id: "A", name: "甲", isDefault: true, counts: { photos: 1 } }, { id: "B", name: "乙", counts: { photos: 1 } }];

test("A06：明确 B 入口不回退，过时 A 列表不会覆盖当前 B", async () => {
  const pending = deferred(), requested = [];
  const page = gallery(async (url) => {
    requested.push(url);
    if (url === "/api/pets") return pets;
    if (url === "/api/account") return { id: "user" };
    if (url.includes("petId=A")) return pending.promise;
    if (url.includes("petId=B")) return { items: [{ id: "B-photo" }], totalCount: 1, nextCursor: null };
    throw new Error("unexpected request");
  });
  page.onLoad({ petId: "A", mode: "record" });
  const oldLoad = page.load();
  await new Promise((resolve) => setImmediate(resolve));
  page.setData({ petId: "B" }); await page.load();
  pending.resolve({ items: [{ id: "A-photo" }], totalCount: 1, nextCursor: null }); await oldLoad;
  assert.equal(page.data.petId, "B"); assert.equal(page.data.photos[0].id, "B-photo");
  assert.ok(requested.some((url) => url.includes("petId=B&pageSize=50")));
});

test("A06/A09：无权 petId 与服务故障展示错误，不静默选择默认宠物或伪装无档案", async () => {
  const page = gallery(async (url) => url === "/api/pets" ? pets : { id: "user" });
  page.onLoad({ petId: "not-owned" }); await page.load();
  assert.equal(page.data.petId, "not-owned"); assert.match(page.data.error, /重新选择宠物/);
  const offline = gallery(async () => { throw new Error("断网"); });
  offline.onLoad({}); await offline.load();
  assert.equal(offline.data.error, "断网"); assert.equal(offline.data.loading, false);
});

test("A02：选图仅加入待上传队列，点收好之前不发上传请求；取消未上传项不留记录", async () => {
  let choose;
  const calls = [];
  const page = gallery(async (url) => {
    calls.push(url);
    if (url === "/api/pets") return pets;
    if (url === "/api/account") return { id: "user" };
    return { items: [], totalCount: 0, nextCursor: null };
  }, { chooseMedia: (options) => { choose = options; } });
  page.onLoad({ petId: "B", mode: "record" }); await page.load();
  page.choosePhotos({ currentTarget: { dataset: {} } });
  await choose.success({ tempFiles: [{ tempFilePath: "chosen" }] });
  assert.equal(page.data.pendingCount, 1); assert.equal(page.data.savedCount, 0);
  assert.equal(page.data.uploadItems[0].state, "ready");
  assert.equal(calls.some((url) => url.startsWith("/api/uploads")), false);
  page.cancelSelected({ currentTarget: { dataset: { id: page.data.uploadItems[0].requestId } } });
  assert.equal(page.data.uploadItems.length, 0);
});

test("A06：视频素材快速 A→B→A，较早 A 响应也不能覆盖最后一次 A 选择", async () => {
  const first = deferred(), calls = [];
  const page = loadPage("video-create", {
    api: { request: async (url) => {
      if (url.includes("pricing")) return { amount: 19.9, label: "高清" };
      calls.push(url); return calls.length === 1 ? first.promise : [{ id: calls.length === 2 ? "B-new" : "A-new" }];
    } }, "photo-files": { displayMediaTree: async (value) => value }
  }, {});
  page.setData({ petId: "A" }); page.loadPhotos("A");
  page.setData({ petId: "B" }); page.loadPhotos("B");
  page.setData({ petId: "A" }); page.loadPhotos("A");
  await new Promise((resolve) => setImmediate(resolve));
  first.resolve([{ id: "A-old" }]); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.photos[0].id, "A-new");
});

test("A03：制作任务响应丢失后保持同幂等键；有任务 ID 时回来继续轮询", async () => {
  const calls = [], storage = {}, polled = [];
  const page = loadPage("create", {
    api: { request: async (url, options) => {
      calls.push([url, options]);
      if (calls.length === 1) throw new Error("响应丢失");
      return { id: "same-task", status: "queued" };
    } },
    "photo-files": { displayMediaTree: async (value) => value },
    "photo-upload-session": { requestId: () => "stable-request" }
  }, { getStorageSync: (key) => key === "petbaby_session" ? "session" : storage[key], setStorageSync: (key, value) => { storage[key] = value; } });
  page._sessionToken = "session"; page._draftKey = "petbaby_create_user_pl-23";
  page.setData({ pet: { id: "B", name: "乙" }, pluginId: "pl-23", plugin: { input: { photos: { min: 2, max: 2 } } }, selectedExistingIds: ["p1", "p2"] });
  page.poll = (id) => polled.push(id);
  page.generate(); await new Promise((resolve) => setImmediate(resolve));
  page.generate(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls[0][1].data.idempotencyKey, calls[1][1].data.idempotencyKey);
  assert.equal(storage[page._draftKey].task.id, "same-task");
  page.onHide(); page.onShow(); assert.deepEqual(polled, ["same-task", "same-task"]);
});

test("制作任务失败后清除幂等键，隐藏前的旧轮询不能覆盖返回后的结果", async () => {
  const first = deferred(), second = deferred(), storage = {};
  let calls = 0;
  const page = loadPage("create", {
    api: { requestWithRetry: () => ++calls === 1 ? first.promise : second.promise },
    "photo-files": { displayMediaTree: async (value) => value }
  }, { getStorageSync: () => "session", setStorageSync: (key, value) => { storage[key] = value; } });
  page._sessionToken = "session"; page._draftKey = "create-test";
  page._submission = { key: "old-key" };
  page.setData({ pet: { id: "B" }, task: { id: "task", status: "queued", privatePayload: "not-persisted" }, stage: "generating", busy: true });
  page.saveDraft();
  assert.deepEqual(plain(storage[page._draftKey].task), { id: "task", status: "queued" });
  page.poll("task"); page.onHide(); page.onShow();
  second.resolve({ id: "task", status: "failed" }); await new Promise((resolve) => setImmediate(resolve));
  first.resolve({ id: "task", status: "processing" }); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.stage, "photos"); assert.equal(page.data.task, null);
  assert.equal(storage[page._draftKey].submission, null); assert.equal(page._submission, null);
  assert.equal(page._pollTimer, undefined);
});
