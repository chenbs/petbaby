const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
 * 新用户引导（2026-10 方案 A）：首页建档卡 → 一跳建档 → 头像一步（可跳过）→ 回到原本要去的玩法。
 * 不装 global.wx：每个页面在自己的沙箱里拿到测试的 wx 替身，不与其他测试文件互相覆盖。
 */
function loadPage(name, dependencies, wx) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require(request) {
      if (request.endsWith("page-mixin")) return { themedPage: (options, page) => { definition = page || options; } };
      const key = request.split("/").pop();
      if (key === "wallet") return require("./wallet-test-harness").loadWallet(dependencies.api || {});
      if (dependencies[key]) return dependencies[key];
      if (key === "photo-files") return { displayMediaTree: async (data) => data };
      if (key === "companion") return require("../services/companion");
      if (["sample-assets", "home-copy", "home-effect-ids"].indexOf(key) >= 0) return require(path.join(__dirname, "..", request.replace(/^(\.\.\/)+/, "")));
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

function homeWith(pets, wallet, wx) {
  const api = { request: async (url) => {
    if (url === "/api/pets") return pets;
    if (url === "/api/wallet") { if (wallet instanceof Error) throw wallet; return wallet; }
    return { matches: [], items: [] };
  } };
  return loadPage("index", { api }, Object.assign({ getStorageSync: () => "session" }, wx));
}

test("无宠物首页：建档卡的见面礼一行只用服务端颗数与有效期，已领过或拉取失败不显示", async () => {
  const home = homeWith([], { newcomerGift: { available: true, units: 3, days: 7 } }, {});
  await home.loadPet();
  await tick();
  assert.equal(home.data.pet, null);
  assert.equal(home.data.care, null);
  assert.equal(home.data.onboardGift, "建好就送 3 颗冻干，7 天内可用");

  const claimed = homeWith([], { newcomerGift: { available: false, units: 3, days: 7 } }, {});
  await claimed.loadPet(); await tick();
  assert.equal(claimed.data.onboardGift, "");

  const failed = homeWith([], new Error("offline"), {});
  await failed.loadPet(); await tick();
  assert.equal(failed.data.onboardGift, "");

  // 颗数改了，端上跟着服务端走
  const changed = homeWith([], { newcomerGift: { available: true, units: 5, days: 14 } }, {});
  await changed.loadPet(); await tick();
  assert.equal(changed.data.onboardGift, "建好就送 5 颗冻干，14 天内可用");
});

test("建档卡主按钮一跳直达建档抽屉；建完回首页选中新宠物，不再跳别处", async () => {
  const navigations = [];
  const home = homeWith([], { newcomerGift: { available: false } }, { navigateTo: (options) => navigations.push(options) });
  await home.loadPet();
  home.startOnboarding({ currentTarget: { dataset: {} } });
  assert.equal(navigations.length, 1);
  assert.equal(navigations[0].url, "/pages/pets/pets?mode=create&onboard=1");
  navigations[0].events.petCreated({ petId: "new-pet" });
  home.resumeOnboarding();
  assert.equal(home._petId, "new-pet");
  assert.equal(navigations.length, 1);
});

test("无宠物点样片先去建档，建完带原参数与新 petId 回到那款玩法；中途退出不误跳", async () => {
  const navigations = [];
  const home = homeWith([], {}, { navigateTo: (options) => navigations.push(options), switchTab: () => {} });
  await home.loadPet();

  home.startTemplate({ currentTarget: { dataset: { entry: "fun", template: "pet-wanted-poster" } } });
  assert.equal(navigations[0].url, "/pages/pets/pets?mode=create&onboard=1");
  navigations[0].events.petCreated({ petId: "P1" });
  home.resumeOnboarding();
  assert.equal(navigations[1].url, "/pages/ai-create/ai-create?entryId=fun&templateId=pet-wanted-poster&petId=P1");

  // 写真场景 / 如果我是人 / 图文玩法同样被拦
  home.data.pets = []; home.data.pet = null;
  home.startBossScene({ currentTarget: { dataset: { id: "window-morning" } } });
  assert.equal(navigations[2].url, "/pages/pets/pets?mode=create&onboard=1");
  // 用户没建完就返回：清掉待办，下次回首页不跳
  home.resumeOnboarding();
  home.resumeOnboarding();
  assert.equal(navigations.length, 3);

  home.openHuman({ currentTarget: { dataset: { id: "human-effect-05" } } });
  navigations[3].events.petCreated({ petId: "P2" });
  home.resumeOnboarding();
  assert.equal(navigations[4].url, "/pages/ai-create/ai-create?entryId=human&templateId=human-effect-05&petId=P2");

  home.start({ currentTarget: { dataset: { id: "pet-movie-poster", category: "layout" } } });
  navigations[5].events.petCreated({ petId: "P3" });
  home.resumeOnboarding();
  assert.equal(navigations[6].url, "/pages/create/create?pluginId=pet-movie-poster&petId=P3");
});

test("有宠物或列表尚未确认为空时不拦，照常带 petId 直达", async () => {
  const urls = [];
  const loading = homeWith([], {}, { navigateTo: (options) => urls.push(options.url) });
  loading.startTemplate({ currentTarget: { dataset: { entry: "fun", template: "pet-wanted-poster" } } });
  assert.equal(urls[0], "/pages/ai-create/ai-create?entryId=fun&templateId=pet-wanted-poster");

  const home = homeWith([{ id: "A", name: "年糕", isDefault: true, lifeStage: "active", counts: { photos: 0 } }], {}, { navigateTo: (options) => urls.push(options.url) });
  await home.loadPet();
  home.start({ currentTarget: { dataset: { id: "pl-19", category: "video" } } });
  assert.equal(urls[1], "/pages/video-create/video-create?petId=A");
});

function petsPage(calls, overrides, wx) {
  const api = { request: async (url, options) => {
    calls.push([url, options]);
    if (overrides[url]) return overrides[url](options);
    return [];
  } };
  return loadPage("pets", { api, "quick-upload": overrides.quickUpload || { uploadOnePhoto: async () => null } }, wx);
}

test("引导建档：建成即通知首页，见面礼按钮改「继续」不跳别处，关掉后给头像一步；上传后设为头像并返回", async () => {
  const calls = [], emitted = [], uploads = [];
  let backs = 0;
  const page = petsPage(calls, {
    "/api/pets": (options) => options ? { id: "P1", name: "年糕", newcomerGift: { units: 3 } } : [],
    "/api/pets/P1/avatar": () => ({ id: "P1", avatarUrl: "/api/media/x.webp" }),
    quickUpload: { uploadOnePhoto: async (pet, entry) => { uploads.push([pet.id, entry]); return "photo-1"; } }
  }, { navigateBack: () => { backs += 1; }, showToast: () => {} });
  page.getOpenerEventChannel = () => ({ emit: (...args) => emitted.push(args) });
  page.onLoad({ mode: "create", onboard: "1" });
  page.inputName({ detail: { value: "年糕" } });
  await page.save();

  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [["petCreated", { petId: "P1" }]]);
  assert.equal(page.data.giftVisible, true);
  assert.equal(page.data.giftActionText, "继续");
  assert.equal(page.data.giftActionUrl, "");
  assert.equal(page.data.avatarStep, null);
  assert.equal(backs, 0);

  page.closeGift();
  assert.equal(page.data.avatarStep.id, "P1");
  await page.uploadAvatar();
  assert.deepEqual(uploads, [["P1", "pets"]]);
  const avatarCall = calls.find(([url]) => url === "/api/pets/P1/avatar");
  assert.equal(avatarCall[1].method, "PUT");
  assert.deepEqual(JSON.parse(JSON.stringify(avatarCall[1].data)), { photoId: "photo-1" });
  assert.equal(page.data.avatarStep, null);
  assert.equal(backs, 1);
});

test("头像一步可跳过；取消选图留在这一步；设头像失败给出错误且不返回", async () => {
  const calls = [];
  let backs = 0, picked = null;
  const page = petsPage(calls, {
    "/api/pets": (options) => options ? { id: "P2", name: "汤圆" } : [],
    "/api/pets/P2/avatar": () => { throw Object.assign(new Error("没有找到这张照片"), { statusCode: 404 }); },
    quickUpload: { uploadOnePhoto: async () => picked }
  }, { navigateBack: () => { backs += 1; }, showToast: () => {} });
  page.getOpenerEventChannel = () => ({ emit: () => {} });
  page.onLoad({ mode: "create", onboard: "1" });
  page.inputName({ detail: { value: "汤圆" } });
  await page.save();
  // 已领过见面礼：直接出头像一步
  assert.equal(page.data.giftVisible, false);
  assert.equal(page.data.avatarStep.id, "P2");

  await page.uploadAvatar();
  assert.equal(page.data.avatarStep.id, "P2");
  assert.equal(calls.some(([url]) => url === "/api/pets/P2/avatar"), false);

  picked = "photo-2";
  await page.uploadAvatar();
  assert.equal(page.data.avatarError, "没有找到这张照片");
  assert.equal(page.data.avatarStep.id, "P2");
  assert.equal(backs, 0);

  page.skipAvatar();
  assert.equal(page.data.avatarStep, null);
  assert.equal(backs, 1);
});

test("档案页自己新建也给头像一步但不返回；从照片库来建档仍直接回去传照片", async () => {
  let backs = 0;
  const own = petsPage([], { "/api/pets": (options) => options ? { id: "P3", name: "芝麻" } : [] }, { navigateBack: () => { backs += 1; } });
  own.getOpenerEventChannel = () => ({ emit: () => {} });
  own.onLoad({});
  own.newPet();
  own.inputName({ detail: { value: "芝麻" } });
  await own.save();
  assert.equal(own.data.avatarStep.id, "P3");
  own.skipAvatar();
  assert.equal(backs, 0);

  const emitted = [];
  const record = petsPage([], { "/api/pets": (options) => options ? { id: "P4", name: "豆豆" } : [] }, { navigateBack: () => { backs += 1; } });
  record.getOpenerEventChannel = () => ({ emit: (...args) => emitted.push(args) });
  record.onLoad({ mode: "create", returnToRecord: "1" });
  record.inputName({ detail: { value: "豆豆" } });
  await record.save();
  assert.equal(record.data.avatarStep, null);
  assert.equal(backs, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(emitted)), [["petCreated", { petId: "P4" }]]);
});
