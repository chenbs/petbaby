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
      if (module.endsWith("home-effect-ids")) return require("../services/home-effect-ids");
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

test("写真套餐页面解析页面跳转时编码的 24 个场景", async () => {
  const ids = Object.keys(require("../assets/samples/manifest").scenes);
  const page = loadPage("art-photo-bundle", {
    api: { request: async (url) => {
      if (url === "/api/pets") return [];
      throw new Error(url);
    } },
    "photo-files": { displayMediaTree: async (items) => items, displayPhotos: async (items) => items }
  }, {});
  page.onLoad({ package: "all", sceneIds: encodeURIComponent(ids.join(",")) });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.error, "");
  assert.equal(page.data.sceneIds.length, 24);
  assert.equal(page.data.scenes.length, 24);
});

test("首页独立艺术模板直达指定样片", async () => {
  const page = loadPage("ai-create", {
    api: { request: async (url) => {
      if (url === "/api/pets" || url === "/api/owner-photos") return [];
      if (url === "/api/plugins") return [{ id: "pl-10", samples: { sceneOptions: [], sceneUrls: {} } }];
      if (url === "/api/image-templates") return { entries: [{ id: "art", title: "艺术肖像", templates: [
        { templateId: "pet-art-photo", title: "宠物艺术写真", subjectMode: "pet" },
        { templateId: "ink-portrait", title: "黑白水墨肖像", subjectMode: "pet" },
        { templateId: "decorative-art-portrait", title: "装饰艺术肖像", subjectMode: "pet" },
        { templateId: "ink-silhouette", title: "直立情绪角色", subjectMode: "pet" },
        { templateId: "ink-fullbody-flight", title: "立体情绪头像", subjectMode: "pet" },
        { templateId: "ink-brush-avatar", title: "飞羽水墨全身像", subjectMode: "pet" },
        { templateId: "animal-watercolor-cat-closeup", title: "金箔水彩猫咪", subjectMode: "pet" }
      ] }] };
      throw new Error(url);
    } },
    "photo-files": { displayMediaTree: async (items) => items }
  }, {});
  page.onLoad({ entryId: "art", templateId: "ink-portrait" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.templateId, "ink-portrait");
  assert.equal(page.data.activeTemplate.title, "黑白水墨肖像");
  assert.equal(page.data.carouselTemplates.length, 6);
});

test("人化首页入口展示全部造型并进入模板选择", async () => {
  const templates = Array.from({ length: 40 }, (_, index) => ({
    templateId: "human-effect-" + String(index + 1).padStart(2, "0"),
    title: "宠物人化 " + (index + 1), subjectMode: "pet-human", sampleUrl: "https://example.test/" + index
  }));
  const urls = [];
  const api = { request: async (url) => {
    if (url === "/api/image-templates") return { entries: [{ id: "human", title: "人类转生计划", templates }] };
    if (url === "/api/plugins" || url === "/api/pets" || url === "/api/owner-photos") return [];
    throw new Error(url);
  } };
  const home = loadPage("index", { api }, { navigateTo: ({ url }) => urls.push(url) });
  home.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(home.data.humanTemplateCount, 40);
  assert.deepEqual(home.data.humanCovers.map((item) => item.templateId), [31, 32, 5, 8, 7, 36, 37, 20].map((number) => "human-effect-" + String(number).padStart(2, "0")));
  assert.equal(home.data.featuredTemplates.length, 0);
  home.data.pet = { id: "pet-1" };
  home.openHuman();
  assert.equal(urls[0], "/pages/ai-create/ai-create?entryId=human&petId=pet-1");

  const create = loadPage("ai-create", { api, "photo-files": { displayMediaTree: async (items) => items } }, { setNavigationBarTitle() {} });
  create.onLoad({ entryId: "human" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(create.data.stage, "samples");
  assert.equal(create.data.templates.length, 40);
  create.chooseTemplate({ currentTarget: { dataset: { id: "human-effect-40" } } });
  assert.equal(create.data.templateId, "human-effect-40");
  assert.equal(create.data.stage, "photos");
});

test("车窗入口可选择麻麻精选全部九款跨分类模板", async () => {
  const ids = require("../services/home-effect-ids").BOSS_TEMPLATE_IDS;
  const entries = [
    { id: "boss", title: "老板精选", templates: ids.filter((id) => id.startsWith("animal-")).map((id) => ({ templateId: id, title: id, subjectMode: "pet" })) },
    { id: "together", title: "和我合照", templates: [{ templateId: "fish-chase", title: "偷鱼大作战", subjectMode: "owner-pet" }] },
    { id: "comic", title: "漫画", templates: [{ templateId: "character-outfit-grid", title: "穿搭动作设定九宫格", subjectMode: "pet" }] },
    { id: "travel", title: "旅行", templates: [{ templateId: "travel-glass-summer", title: "透明杯夏日视角", subjectMode: "pet" }] },
    { id: "career", title: "职业", templates: [{ templateId: "pet-milk-tea-shopkeeper", title: "奶茶店主理人", subjectMode: "pet" }] },
    { id: "fun", title: "趣味", templates: [{ templateId: "fun-fisheye-closeup", title: "鱼眼近脸", subjectMode: "pet" }] },
    { id: "character", title: "角色", templates: [{ templateId: "mini-companion", title: "同宠大小分身", subjectMode: "pet" }] },
    { id: "art", title: "写真", templates: [{ templateId: "pet-art-photo", title: "宠物艺术写真", subjectMode: "pet" }] }
  ];
  const page = loadPage("ai-create", {
    api: { request: async (url) => {
      if (url === "/api/pets" || url === "/api/owner-photos") return [];
      if (url === "/api/image-templates") return { entries };
      if (url === "/api/plugins") return [];
      throw new Error(url);
    } },
    "photo-files": { displayMediaTree: async (items) => items }
  }, { setNavigationBarTitle() {} });
  page.onLoad({ entryId: "boss", templateId: "animal-car-window-westie" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.entryTitle, "麻麻精选");
  assert.deepEqual(Array.from(page.data.carouselTemplates, (item) => item.templateId), ids);
  assert.equal(page.data.stage, "photos");
  page.chooseTemplate({ currentTarget: { dataset: { id: "fish-chase" } } });
  assert.equal(page.data.activeTemplate.subjectMode, "owner-pet");
  assert.equal(page.data.templateId, "fish-chase");
  assert.equal(page.data.stage, "photos");
  assert.equal(page.data.templates.some((item) => item.templateId === "pet-art-photo"), false);
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

test("首页轮播单张图片失败时仍保留该玩法入口", () => {
  const page = loadPage("index", {}, {});
  page.data.carouselPlugins = [
    { id: "pet-time-album", samples: { heroUrl: "broken.jpg" } },
    { id: "pet-movie-poster", samples: { heroUrl: "other.jpg" } }
  ];
  page.onImageError({ currentTarget: { dataset: { kind: "carousel", id: "pet-time-album", src: "broken.jpg" } } });
  assert.equal(page.data["carouselPlugins[0].samples.heroUrl"], "");
  assert.equal(page.data.carouselPlugins[1].samples.heroUrl, "other.jpg");
});

test("首页精选、四张玩法卡和双图轮播按指定顺序展示", async () => {
  const bossIds = ["animal-car-window-westie", "animal-pink-scooter", "fun-fisheye-closeup", "fish-chase", "travel-glass-summer", "pet-milk-tea-shopkeeper", "animal-sword-cat-alt", "mini-companion", "character-outfit-grid"];
  const page = loadPage("index", {
    api: { request: async (url) => {
      if (url === "/api/plugins") return ["pet-id-card", "pet-movie-poster", "pet-time-album", "pl-10", "pl-15", "pl-19", "pl-23"].map((id) => ({ id, category: "layout", samples: {
        heroUrl: id + ".jpg",
        sceneOptions: id === "pl-10" ? require("../services/home-effect-ids").BOSS_SCENE_IDS.map((sceneId) => ({ id: sceneId, title: sceneId })) : [],
        sceneUrls: {}
      } }));
      if (url === "/api/image-templates") return { entries: [
        { id: "boss", title: "老板精选", templates: bossIds.map((id) => ({ templateId: id, title: id })) },
        { id: "art", title: "艺术肖像", templates: [{ templateId: "pet-art-photo" }, { templateId: "ink-portrait" }] }
      ] };
      throw new Error(url);
    } }
  }, {});
  page.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(page.data.carouselPlugins, (item) => item.id), ["pet-time-album", "pet-movie-poster"]);
  assert.deepEqual(Array.from(page.data.gridPlugins, (item) => item.id), ["pl-10", "pl-19", "pl-23", "pet-id-card"]);
  assert.deepEqual(Array.from(page.data.bossTemplates, (item) => item.templateId), ["fish-chase", "character-outfit-grid", "animal-sword-cat-alt", "travel-glass-summer", "pet-milk-tea-shopkeeper", "fun-fisheye-closeup", "mini-companion", "animal-pink-scooter"]);
  assert.deepEqual(Array.from(page.data.bossScenes, (item) => item.id), ["window-morning", "seaside-breeze", "library-whisper", "autumn-leaves", "berry-pastry-chef", "ballet-backstage"]);
  const ink = page.data.featuredTemplates.find((item) => item.templateId === "ink-portrait");
  assert.equal(ink.sampleUrl, "/assets/home-effects/covers/ink-portrait.jpg");
  assert.equal(ink.sampleShape, "wide");
  page.onCarouselChange({ detail: { current: 1 } });
  assert.equal(page.data.carouselIndex, 1);
});

test("首页模板样片直接进入对应玩法，电影与画册网格点选保持所选参数", () => {
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
  assert.deepEqual(Array.from(create.data.movieSamples, (item) => item.id), ["rooftop", "highseas", "musical", "webcity", "starvoyage"]);
  assert.equal(create.data.movieSamples[0].url, require("../assets/samples/manifest").plugins["pet-movie-poster"]);
  create.chooseSample({ currentTarget: { dataset: { id: "highseas" } } });
  assert.equal(create.data.style, "highseas");
  assert.equal(drafts[drafts.length - 1][1].style, "highseas");
  create.chooseSample({ currentTarget: { dataset: { id: "musical" } } });
  assert.equal(create.data.style, "musical");
  create.data.pluginId = "pet-time-album";
  assert.deepEqual(Array.from(create.data.albumSamples, (item) => item.id), ["growth", "birthday", "healing", "holiday"]);
  create.chooseSample({ currentTarget: { dataset: { id: "birthday" } } });
  assert.equal(create.data.theme, "birthday");
  assert.equal(drafts[drafts.length - 1][1].theme, "birthday");
  create.chooseSample({ currentTarget: { dataset: { id: "holiday" } } });
  assert.equal(create.data.theme, "holiday");
});

test("电影与画册选好样片后直达照片区，照片齐备才生成", () => {
  const scrolled = [];
  const page = loadPage("create", {}, { pageScrollTo: (options) => scrolled.push(options) });
  page.data.pluginId = "pet-movie-poster";
  page.data.plugin = { input: { photos: { min: 1, max: 1 } } };
  let generations = 0;
  page.generate = () => { generations += 1; };
  page.goToPhotosOrGenerate();
  assert.equal(scrolled[0].selector, "#photo-picker");
  assert.equal(generations, 0);
  page.data.selectedExistingIds = ["photo-1"];
  page.goToPhotosOrGenerate();
  assert.equal(generations, 1);

  const createWxml = fs.readFileSync(path.join(__dirname, "../pages/create/create.wxml"), "utf8");
  const aiWxml = fs.readFileSync(path.join(__dirname, "../pages/ai-create/ai-create.wxml"), "utf8");
  assert.match(createWxml, /id="photo-picker"/);
  assert.match(aiWxml, /<t-steps steps="{{flowSteps}}"/);
  assert.match(aiWxml, />看看效果<\/t-button>/);
  assert.doesNotMatch(aiWxml, /生成\s*2\s*张候选|2\s*选照片/);
});

test("非写真模板点选任意效果并保持照片阶段", () => {
  const page = loadPage("ai-create", {}, { setNavigationBarTitle() {} });
  page.data.stage = "photos";
  page.data.templates = page.data.carouselTemplates = [
    { templateId: "one", title: "效果一", subjectMode: "pet" },
    { templateId: "two", title: "效果二", subjectMode: "owner-pet" }
  ];
  page.data.templateId = "one";
  page.data.ownerPhotoIds = ["owner"];
  page.data.authorizationConfirmed = true;
  page.chooseTemplate({ currentTarget: { dataset: { id: "two" } } });
  assert.equal(page.data.templateId, "two");
  assert.equal(page.data.activeTemplate.title, "效果二");
  assert.equal(page.data.stage, "photos");
  assert.equal(page.data.ownerPhotoIds.length, 0);
  assert.equal(page.data.authorizationConfirmed, false);
});

test("互动场景网格点选即时更新场景与预览", () => {
  const page = loadPage("interactive-create", { "scene-presets": { SCENE_PRESETS: [{ id: "stardust" }, { id: "meadow" }], getSceneStyle: (id) => "scene=" + id } }, {});
  page.data.scenePresets = [{ id: "stardust" }, { id: "meadow" }];
  page.chooseScene({ currentTarget: { dataset: { id: "meadow" } } });
  assert.equal(page.data.theme, "meadow");
  assert.equal(page.data.sceneStyle, "scene=meadow");
});

test("多效果页面同时渲染候选项并通过点击选择", () => {
  for (const name of ["ai-create", "create", "interactive-create"]) {
    const markup = fs.readFileSync(path.join(__dirname, "../pages", name, name + ".wxml"), "utf8");
    assert.doesNotMatch(markup, /<swiper[\s>]/);
    assert.match(markup, /wx:for="\{\{(?:carouselTemplates|pluginId ===|scenePresets)/);
    assert.match(markup, /aria-checked=/);
  }
});

test("记录页上传反馈只保留未完成项", () => {
  const page = loadPage("photos", {}, {});
  page.syncUpload({ items: [
    { requestId: "saved", state: "saved", path: "one.jpg" },
    { requestId: "ready", state: "ready", path: "two.jpg" }
  ], savedCount: 1, pendingCount: 1, running: false });
  assert.equal(page.data.uploadItems.length, 2);
  assert.equal(page.data.activeUploadItems.length, 1);
  assert.equal(page.data.activeUploadItems[0].requestId, "ready");
  let patch;
  page.setData = (values) => { patch = values; };
  page.onUploadThumbError({ currentTarget: { dataset: { id: "ready", src: "two.jpg" } } });
  assert.equal(patch["activeUploadItems[0].thumbFailed"], true);
});

test("从图库开始新一批记录时先清空已完成上传", () => {
  const page = loadPage("photos", { "record-events": { recordSession: () => ({ opened() {} }) } }, {});
  let reset = false;
  let chosen = false;
  page._session = { reset() { reset = true; } };
  page._tracking = { opened() {} };
  page.data.petId = "pet";
  page.data.savedCount = 1;
  page.choosePhotos = () => { chosen = true; };
  page.goCreate();
  assert.equal(reset, true);
  assert.equal(chosen, true);
  assert.equal(page.data.recordMode, true);
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
