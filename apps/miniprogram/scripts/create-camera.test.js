const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

/*
 * 时光画册等制作页的「拍照」（2026-10-27）：拍照会拉起系统相机，页面先 onHide，
 * 回来时 chooseMedia 的 success 可能先于 onShow。原先按 _closed 判断「页面已关」，
 * 刚拍的照片被静默丢掉，相册选图不受影响。
 * 不装 global.wx：页面在自己的沙箱里拿到 wx 替身，不与其他测试文件互相覆盖。
 */
function loadCreate(wx) {
  let definition;
  const api = { request: async (url) => {
    if (url === "/api/plugins") return [{ id: "pet-time-album", name: "时光画册", input: { photos: { min: 6, max: 30 } } }];
    if (url === "/api/pets") return [{ id: "P1", name: "年糕", isDefault: true }];
    if (url === "/api/account") return { id: "U1" };
    if (url.startsWith("/api/photos")) return [];
    if (url.startsWith("/api/pets/P1/pricing")) return { free: true };
    return {};
  } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages/create/create.js"), "utf8"), {
    require(request) {
      if (request.endsWith("page-mixin")) return { themedPage: (options) => { definition = options; } };
      const key = request.split("/").pop();
      if (key === "api") return api;
      if (key === "wallet") return require("./wallet-test-harness").loadWallet(api);
      if (key === "photo-files") return { displayMediaTree: async (data) => data };
      if (key === "sample-assets") return { manifest: { movie: {}, album: {} }, pluginSample: (plugin) => plugin };
      if (key === "photo-upload-session") return {
        preparePhoto: async (file) => ({ path: file.tempFilePath, name: "pet-x.jpg" }),
        createUploadSession: () => ({}), requestId: () => "R" + Math.random()
      };
      return {};
    },
    wx, console, setTimeout, clearTimeout
  });
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values); }
  });
}
const tick = () => new Promise((resolve) => setImmediate(resolve));

function setup() {
  const calls = { choose: null };
  const wx = {
    getStorageSync: () => "", setStorageSync: () => {},
    chooseMedia: (options) => { calls.choose = options; },
    navigateTo: () => {}, showToast: () => {}
  };
  return { wx, calls };
}

test("拍照回来 success 先于 onShow：照片仍加进画册", async () => {
  const { wx, calls } = setup();
  const page = loadCreate(wx);
  page.onLoad({ pluginId: "pet-time-album", petId: "P1" });
  for (let index = 0; index < 6; index += 1) await tick();
  assert.equal(page.data.stage, "photos");

  page.choosePhotos();
  assert.deepEqual([...calls.choose.sourceType], ["album", "camera"]);
  page.onHide(); // 系统相机盖住页面
  await calls.choose.success({ tempFiles: [{ tempFilePath: "wxfile://camera.jpg" }] });
  assert.equal(page.data.newPhotos.length, 1, "刚拍的照片不能被丢掉");
  assert.equal(page.data.newPhotos[0].path, "wxfile://camera.jpg");
  assert.equal(page.data.busy, false);

  page.onShow();
  assert.equal(page.data.newPhotos.length, 1);
});

test("页面已经关闭时不再写入照片", async () => {
  const { wx, calls } = setup();
  const page = loadCreate(wx);
  page.onLoad({ pluginId: "pet-time-album", petId: "P1" });
  for (let index = 0; index < 6; index += 1) await tick();
  page.choosePhotos();
  page.onUnload();
  await calls.choose.success({ tempFiles: [{ tempFilePath: "wxfile://camera.jpg" }] });
  assert.equal(page.data.newPhotos.length, 0);
});

test("打不开相册时给出提示，取消则不提示", async () => {
  const { wx, calls } = setup();
  const page = loadCreate(wx);
  page.onLoad({ pluginId: "pet-time-album", petId: "P1" });
  for (let index = 0; index < 6; index += 1) await tick();
  page.choosePhotos();
  calls.choose.fail({ errMsg: "chooseMedia:fail cancel" });
  assert.equal(page.data.error, "");
  calls.choose.fail({ errMsg: "chooseMedia:fail auth deny" });
  assert.equal(page.data.error, "未能打开相册，请重试");
});
