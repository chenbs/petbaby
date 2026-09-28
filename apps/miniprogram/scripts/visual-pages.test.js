const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function loadPage(name, dependencies, wx) {
  let definition;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../pages", name, name + ".js"), "utf8"), {
    require(module) {
      if (module.endsWith("page-mixin")) return { themedPage: (options, page) => { definition = page || options; } };
      if (module.endsWith("sample-assets")) return require("../services/sample-assets");
      return dependencies[module.split("/").pop()] || {};
    },
    wx, console
  });
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values); }
  });
}

test("艺术写真展示二十四套场景并提交所选场景", async () => {
  const ids = ["window-morning", "garden-curious", "studio-confident", "night-playful", "seaside-breeze", "library-whisper", "autumn-leaves", "snow-cabin", "cafe-afternoon", "lakeside-sunset", "city-rain", "spring-picnic", "railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday", "berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day", "museum-curator", "poolside-vacation", "post-office", "ballet-backstage"];
  let submitted;
  const page = loadPage("ai-create", {
    api: { request: async (url, options) => {
      if (url === "/api/pets") return [{ id: "pet", name: "豆豆", isDefault: true }];
      if (url === "/api/image-templates") return { entries: [{ id: "art", title: "艺术", templates: [{ templateId: "pet-art-photo", subjectMode: "pet", version: "v03" }] }] };
      if (url === "/api/owner-photos") return [];
      if (url === "/api/plugins") return [{ id: "pl-10", samples: { sceneOptions: ids.map((id) => ({ id, title: id, description: id })), sceneUrls: Object.fromEntries(ids.map((id) => [id, id + ".jpg"])) } }];
      if (url === "/api/photos?petId=pet") return [{ id: "photo", petId: "pet" }];
      if (url === "/api/ai-runs" && options.method === "POST") { submitted = options.data; return { id: "run" }; }
      throw new Error("Unexpected request: " + url);
    } },
    "photo-files": { displayMediaTree: async (items) => items }
  }, { redirectTo() {} });
  page.onLoad({});
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.sceneOptions.length, 24);
  page.chooseScene({ currentTarget: { dataset: { id: "ballet-backstage" } } });
  assert.equal(page.data.stage, "photos");
  page.setData({ photoIds: ["photo"] });
  page.create();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submitted.options.scene, "ballet-backstage");
});

test("写真底栏按六组展示二十四套场景并直达照片选择", async () => {
  const ids = ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon", "seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset", "night-playful", "snow-cabin", "city-rain", "spring-picnic", "railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday", "berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day", "museum-curator", "poolside-vacation", "post-office", "ballet-backstage"];
  const urls = [];
  const page = loadPage("art-photo", {
    api: { request: async () => [{ id: "pl-10", samples: {
      sceneOptions: ids.map((id) => ({ id, title: id, description: id })),
      sceneUrls: Object.fromEntries(ids.map((id) => [id, id + ".jpg"]))
    } }] }
  }, { navigateTo: ({ url }) => urls.push(url) });
  page.onLoad();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(page.data.collections, (group) => group.scenes.length), [4, 4, 4, 4, 4, 4]);
  page.chooseScene({ currentTarget: { dataset: { id: "post-office" } } });
  assert.match(urls[0], /templateId=pet-art-photo&sceneId=post-office/);
});

test("首页独立艺术模板直达指定样片", async () => {
  const page = loadPage("ai-create", {
    api: { request: async (url) => {
      if (url === "/api/pets" || url === "/api/owner-photos") return [];
      if (url === "/api/plugins") return [{ id: "pl-10", samples: { sceneOptions: [], sceneUrls: {} } }];
      if (url === "/api/image-templates") return { entries: [{ id: "art", title: "艺术肖像", templates: [
        { templateId: "pet-art-photo", title: "宠物艺术写真", subjectMode: "pet" },
        { templateId: "ink-portrait", title: "黑白水墨肖像", subjectMode: "pet" }
      ] }] };
      throw new Error(url);
    } },
    "photo-files": { displayMediaTree: async (items) => items }
  }, {});
  page.onLoad({ entryId: "art", templateId: "ink-portrait" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.templateId, "ink-portrait");
  assert.equal(page.data.activeTemplate.title, "黑白水墨肖像");
});

test("纪念访客照下载为可显示临时路径，单张失败保留占位", async () => {
  const urls = [];
  const page = loadPage("memorial-share", {
    api: { request: async (_url, options) => options ? {} : {
      title: "小小的你", story: "一起走过", story_sections: [{ title: "第一章", body: "在家" }],
      photos: [{ id: "one", url: "/api/memorial-share/token/media/one" }, { id: "two", url: "/api/memorial-share/token/media/two" }]
    } },
    config: { apiBaseUrl: "https://test.example" }
  }, {
    setNavigationBarTitle() {},
    downloadFile({ url, success }) {
      urls.push(url);
      success(url.endsWith("/one") ? { statusCode: 200, tempFilePath: "wxfile://one" } : { statusCode: 410 });
    }
  });
  await page.onLoad({ token: "token" });
  assert.equal(page.data.photos[0].url, "wxfile://one");
  assert.equal(page.data.photos[1].url, "");
  assert.match(page.data.photos[1].imageError, /无法读取/);
  assert.equal(page.data.sections[0].title, "第一章");
  assert.equal(urls.length, 2);
});

test("纪念访客照解码失败后保留照片位置与错误提示", () => {
  const page = loadPage("memorial-share", {}, {});
  page.data.photos = [{ id: "one", url: "wxfile://one" }];
  let update;
  page.setData = (values) => { update = values; };
  page.onPhotoError({ currentTarget: { dataset: { id: "one", src: "wxfile://one" } } });
  assert.equal(update["photos[0].url"], "");
  assert.match(update["photos[0].imageError"], /无法显示/);
});

test("首页玩法主图失败后降级为可进入的文字卡", () => {
  const page = loadPage("index", {}, {});
  page.data.heroPlugin = { id: "pl-10", samples: { heroUrl: "broken.jpg" } };
  page.data.gridPlugins = [{ id: "pl-15", samples: { heroUrl: "other.jpg" } }];
  page.onImageError({ currentTarget: { dataset: { kind: "hero", id: "pl-10", src: "broken.jpg" } } });
  assert.equal(page.data.heroPlugin, null);
  assert.equal(page.data.gridPlugins[0].id, "pl-10");
  assert.equal(page.data.gridPlugins[0].samples.heroUrl, "");
  assert.equal(page.data.gridPlugins[1].id, "pl-15");
});

test("首页模板样片直接进入对应玩法，电影与画册样片保持所选参数", () => {
  const urls = [];
  const home = loadPage("index", {}, { navigateTo: (item) => urls.push(item.url) });
  home.data.pet = { id: "pet-1" };
  home.startTemplate({ currentTarget: { dataset: { entry: "fun", template: "pet-wanted-poster" } } });
  assert.match(urls[0], /entryId=fun&templateId=pet-wanted-poster&petId=pet-1/);

  const drafts = [];
  const create = loadPage("create", {}, {
    getStorageSync: () => "session",
    setStorageSync: (key, value) => drafts.push([key, value])
  });
  create._draftKey = "draft";
  create._sessionToken = "session";
  create.data.pet = { id: "pet-1" };
  create.data.plugin = { input: { photos: { min: 1, max: 3 } } };
  create.data.pluginId = "pet-movie-poster";
  create.chooseSample({ currentTarget: { dataset: { id: "hongkong" } } });
  assert.equal(create.data.style, "hongkong");
  assert.equal(drafts[drafts.length - 1][1].style, "hongkong");
  create.swipeSample({ detail: { current: 1 } });
  assert.equal(create.data.style, "arthouse");
  create.data.pluginId = "pet-time-album";
  create.chooseSample({ currentTarget: { dataset: { id: "birthday" } } });
  assert.equal(create.data.theme, "birthday");
  assert.equal(drafts[drafts.length - 1][1].theme, "birthday");
  create.swipeSample({ detail: { current: 3 } });
  assert.equal(create.data.theme, "holiday");
});

test("非写真模板横滑即时选中并保持照片阶段", () => {
  const page = loadPage("ai-create", {}, { setNavigationBarTitle() {} });
  page.data.stage = "photos";
  page.data.carouselTemplates = [
    { templateId: "one", title: "效果一", subjectMode: "pet" },
    { templateId: "two", title: "效果二", subjectMode: "owner-pet" }
  ];
  page.data.templateId = "one";
  page.swipeTemplate({ detail: { current: 1 } });
  assert.equal(page.data.templateId, "two");
  assert.equal(page.data.activeTemplate.title, "效果二");
  assert.equal(page.data.stage, "photos");
});

test("互动场景横滑即时更新场景与预览", () => {
  const page = loadPage("interactive-create", { "scene-presets": { SCENE_PRESETS: [{ id: "stardust" }, { id: "meadow" }], getSceneStyle: (id) => "scene=" + id } }, {});
  page.data.scenePresets = [{ id: "stardust" }, { id: "meadow" }];
  page.swipeScene({ detail: { current: 1 } });
  assert.equal(page.data.theme, "meadow");
  assert.equal(page.data.sceneStyle, "scene=meadow");
});

test("旧列表的图片错误不会覆盖筛选后同位置的新作品", () => {
  const page = loadPage("works", {}, {});
  page.data.works = [{ id: "new", coverUrl: "new.jpg" }];
  let updated = false;
  page.setData = () => { updated = true; };
  page.onCoverError({ currentTarget: { dataset: { id: "old", src: "old.jpg" } } });
  assert.equal(updated, false);
});

test("共享照片网格的坏图占位在重新勾选后仍保留", () => {
  let component;
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, "../components/photo-grid/index.js"), "utf8"), {
    Component(value) { component = value; }
  });
  const grid = {
    data: { tiles: [] },
    setData(values) { Object.assign(this.data, values); }
  };
  const photos = [{ id: "one", url: "broken.jpg" }];
  component.observers["photos, selectedIds, ordered"].call(grid, photos, []);
  let update;
  grid.setData = (values) => { update = values; };
  component.methods.handleImageError.call(grid, { currentTarget: { dataset: { id: "one", src: "broken.jpg" } } });
  assert.equal(update["tiles[0].imageFailed"], true);
  grid.data.tiles[0].imageFailed = true;
  grid.setData = (values) => { Object.assign(grid.data, values); };
  component.observers["photos, selectedIds, ordered"].call(grid, photos, ["one"]);
  assert.equal(grid.data.tiles[0].picked, true);
  assert.equal(grid.data.tiles[0].imageFailed, true);
});

test("视频主视区只下载项目封面照片", async () => {
  let transformed;
  const page = loadPage("video", {
    api: { request: async (url) => {
      assert.equal(url, "/api/photos?petId=pet");
      return [{ id: "other", url: "private-other" }, { id: "cover", url: "private-cover" }];
    } },
    "photo-files": { displayMediaTree: async (photo) => { transformed = photo; return { url: "wxfile://cover" }; } }
  }, {});
  await page.loadCover({ pet_id: "pet", cover_photo_id: "cover", photo_ids: ["other", "cover"] });
  assert.equal(transformed.id, "cover");
  assert.equal(page.data.coverUrl, "wxfile://cover");
});
