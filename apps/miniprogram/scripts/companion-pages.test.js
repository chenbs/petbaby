const { test } = require("node:test");
const assert = require("node:assert/strict");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");
const petA = { id: "A", name: "甲", isDefault: true, lifeStage: "active", createdAt: "2020-01-01", counts: { photos: 0 } };
const petB = { id: "B", name: "乙", lifeStage: "memorial", counts: { photos: 550 } };
function page(name, request) {
  let definition;
  const events = [], navigation = [];
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require(module) {
      if (module.endsWith("page-mixin")) return { themedPage: (a, b) => { definition = b || a; } };
      if (module.endsWith("/api")) return { request };
      if (module.endsWith("photo-files")) return { displayMediaTree: async (data) => data };
      if (module.endsWith("record-events")) return { recordSession: () => ({ viewed: (...args) => events.push(args), opened() {}, deliverable() {} }) };
      if (module.endsWith("companion")) return require("../services/companion");
      return {};
    },
    wx: { getStorageSync: () => "signed-session", navigateTo: (data) => navigation.push(data.url) }, console
  });
  const instance = Object.assign({}, definition, { _visible: true, data: JSON.parse(JSON.stringify(definition.data)), setData(values) { Object.assign(this.data, values); } });
  return { instance, events, navigation };
}
test("A06/A08：时间线分页到550张无遗漏，非默认B沿路透传，回页重置游标", async () => {
  const calls = [];
  const fixture = Array.from({ length: 550 }, (_, i) => ({ photo: { id: String(i), tags: ["keep"], caption: "记住" }, date: "2025-01-01", day: 1, showDay: false, dateSource: "manual" }));
  const { instance, navigation } = page("timeline", async (url) => {
    calls.push(url);
    if (url === "/api/pets") return [petA, petB];
    const cursor = Number((url.match(/cursor=(\d+)/) || [])[1] || 0);
    return { entries: fixture.slice(cursor, cursor + 50), totalCount: 550, nextCursor: cursor + 50 < 550 ? String(cursor + 50) : null, totalDays: 0, milestones: [] };
  });
  instance.onLoad({ petId: "B" }); await instance.reload();
  for (let i = 0; i < 10; i++) await instance.more();
  const ids = instance.data.groups.flatMap((group) => group.items.map((item) => item.key));
  assert.equal(ids.length, 550); assert.equal(new Set(ids).size, 550); assert.equal(instance.data.nextCursor, "");
  assert.equal(instance.data.totalCount, 550); assert.ok(calls.slice(1).every((url) => url.includes("/B/timeline")));
  instance.openPhotos(); assert.match(navigation[0], /petId=B/);
  await instance.reload(); assert.equal(instance.data.groups[0].items.length, 50); assert.equal(instance.data.nextCursor, "50");
});
test("A06/A14：年度入口先确认素材与实际价，用户再确认才以B和原选图入队", async () => {
  const calls = [];
  const { instance } = page("timeline", async (url, options) => {
    calls.push([url, options]);
    if (url.includes("/pricing")) return { amount: 19.9, label: "短片" };
    if (!options) return { petId: "B", petName: "乙", year: 2025, durationSeconds: 20, photos: [{ id: "b1", date: "2025-01-01" }] };
    return { petName: "乙", shots: 1 };
  });
  instance.onLoad({ petId: "B" }); instance._view = 1; instance.setData({ filmYear: 2025 });
  await instance.createFilm(); assert.equal(calls.filter((call) => call[1]).length, 0);
  assert.equal(instance.data.filmPricing.amount, 19.9);
  await instance.confirmFilm();
  const body = calls.find((call) => call[1])[1].data;
  assert.equal(body.petId, "B"); assert.deepEqual(Array.from(body.photoIds), ["b1"]);
});
test("A09：首页服务错误不伪装零档案；B的最近收好和去年今日分别按上传时间与宠物读取", async () => {
  const calls = [];
  let fail = true;
  const { instance } = page("index", async (url) => {
    calls.push(url);
    if (fail) throw new Error("断网");
    if (url === "/api/pets") return [petA, petB];
    if (url.includes("on-this-day")) return { matches: [] };
    return { items: [{ id: "b1", createdAt: "2026-09-23T12:00:00Z", recordedDate: "2020-01-01", memoryDateSource: "manual" }] };
  });
  await instance.loadPet(); assert.equal(instance.data.recordError, "断网"); assert.equal(instance.data.pet, null);
  fail = false; instance._petId = "B"; await instance.loadPet();
  assert.equal(instance.data.pet.id, "B"); assert.equal(instance.data.recordAction, "收好照片"); assert.equal(instance.data.milestone, "");
  assert.ok(calls.some((url) => url.includes("petId=B&pageSize=3&order=uploaded")));
  assert.ok(calls.includes("/api/on-this-day?petId=B"));
  assert.equal(instance.data.recent[0].recordedDate, "2020-01-01");
});
test("A06：明确无效petId不回退默认宠物", async () => {
  const { instance } = page("timeline", async () => [petA]);
  instance.onLoad({ petId: "other-account" }); await instance.reload();
  assert.equal(instance.data.petId, "other-account"); assert.match(instance.data.error, /不可用/); assert.equal(instance.data.empty, false);
});
