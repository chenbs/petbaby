const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
 * 创作页没有宠物档案时（2026-10-09）：「开始拍摄」不能置灰没反应，缺什么就带用户去补；
 * 「先建一个档案」直接打开新建抽屉，建成后回到制作页并选中新宠物。
 * 不装 global.wx：每个页面在自己的沙箱里拿到 wx 替身，不与其他测试文件互相覆盖。
 */
function loadPage(name, api, wx) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require(request) {
      if (request.endsWith("page-mixin")) return { themedPage: (options) => { definition = options; } };
      const key = request.split("/").pop();
      if (key === "api") return api;
      if (key === "wallet") return require("./wallet-test-harness").loadWallet(api);
      if (key === "photo-files") return { displayMediaTree: async (data) => data, displayPhotos: async (data) => data };
      if (key === "pet-onboarding") {
        const module = { exports: {} };
        vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../services/pet-onboarding.js"), "utf8"), { module, wx });
        return module.exports;
      }
      if (key === "quick-upload") return { uploadOnePhoto: async () => "" };
      if (["sample-assets", "home-effect-ids"].indexOf(key) >= 0) return require(path.join(__dirname, "..", request.replace(/^(\.\.\/)+/, "")));
      if (key === "video-duration") return require(path.join(__dirname, "..", request.replace(/^(\.\.\/)+/, "")));
      return {};
    },
    wx, console, setTimeout, clearTimeout
  });
  return Object.assign({}, definition, {
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
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function harness(petsAfterCreate) {
  const calls = { navigate: [], toast: [] };
  let pets = [];
  const api = { request: async (url) => {
    if (url === "/api/pets") return pets;
    if (url.startsWith("/api/photos")) return [];
    if (url === "/api/image-templates") return { entries: [{ id: "fun", title: "好笑出片", templates: [{ templateId: "pet-wanted-poster", title: "萌宠通缉令", subjectMode: "pet", donganCost: 2, version: "v01" }] }] };
    if (url === "/api/wallet") return { balance: 0 };
    return [];
  } };
  const wx = {
    navigateTo: (options) => { calls.navigate.push(options); },
    showToast: (options) => calls.toast.push(options.title),
    setNavigationBarTitle: () => {}, getWindowInfo: () => ({ windowWidth: 375 }), pageScrollTo: () => {}
  };
  return { api, wx, calls, createPet: () => { pets = petsAfterCreate; } };
}

test("ai-create 无档案：开始拍摄打开新建抽屉，建成后选中新宠物并加载照片", async () => {
  const pet = { id: "pet-new", name: "年糕", isDefault: true };
  const env = harness([pet]);
  const page = loadPage("ai-create", env.api, env.wx);
  page.onLoad({ entryId: "fun", templateId: "pet-wanted-poster" });
  await tick(); await tick();
  assert.equal(page.data.pets.length, 0);
  assert.ok(page.data.activeTemplate, "模板已就绪，按钮可点");

  page.create();
  assert.deepEqual(env.calls.toast, ["先给它建一份档案"]);
  assert.equal(env.calls.navigate.length, 1);
  assert.equal(env.calls.navigate[0].url, "/pages/pets/pets?mode=create&onboard=1");

  env.createPet();
  env.calls.navigate[0].events.petCreated({ petId: "pet-new" });
  await tick(); await tick();
  assert.equal(page.data.petId, "pet-new");
  assert.equal(page.data.petText, "年糕");
});

test("ai-create「先建一个档案」直接打开新建抽屉，而不是档案列表", async () => {
  const env = harness([]);
  const page = loadPage("ai-create", env.api, env.wx);
  page.onLoad({ entryId: "fun", templateId: "pet-wanted-poster" });
  await tick(); await tick();
  page.openPets();
  assert.equal(env.calls.navigate[0].url, "/pages/pets/pets?mode=create&onboard=1");
});

test("ai-create 有档案没选照片：给出轻提示，不静默", async () => {
  const pet = { id: "pet-1", name: "团子", isDefault: true };
  const env = harness([pet]);
  env.createPet();
  const page = loadPage("ai-create", env.api, env.wx);
  page.onLoad({ entryId: "fun", templateId: "pet-wanted-poster" });
  await tick(); await tick();
  page.setData({ photos: [{ id: "photo-1" }], photoIds: [], loading: false });
  page.create();
  assert.deepEqual(env.calls.toast, ["先选 1 张照片"]);
  assert.equal(env.calls.navigate.length, 0);
});

test("短片页无档案：创建按钮打开新建抽屉", async () => {
  const env = harness([]);
  const page = loadPage("video-create", env.api, env.wx);
  page.onLoad({});
  await tick(); await tick();
  page.create();
  assert.deepEqual(env.calls.toast, ["先给它建一份档案"]);
  assert.equal(env.calls.navigate[0].url, "/pages/pets/pets?mode=create&onboard=1");
});
