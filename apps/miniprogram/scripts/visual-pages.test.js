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

test("写真馆按四组展示三十六套场景（13–36 暂不分类）并直达照片选择", async () => {
  const ids = ["window-morning", "garden-curious", "studio-confident", "cafe-afternoon", "seaside-breeze", "library-whisper", "autumn-leaves", "lakeside-sunset", "night-playful", "snow-cabin", "city-rain", "spring-picnic", "railway-traveler", "tennis-champion", "greenhouse-gardener", "sailboat-holiday", "berry-pastry-chef", "paper-flower-window", "mountain-cable-car", "laundry-day", "museum-curator", "poolside-vacation", "post-office", "ballet-backstage", "shorthair-armchair", "shorthair-books", "shorthair-night-rim", "shorthair-paper-bag", "corgi-denim", "corgi-crate", "corgi-sploot", "corgi-sweater", "calico-silk", "calico-bowl", "calico-rain-window", "calico-cane-stool"];
  const urls = [];
  const page = loadPage("art-photo", {
    api: { request: async () => [{ id: "pl-10", samples: {
      sceneOptions: ids.map((id) => ({ id, title: id, description: id })),
      sceneUrls: Object.fromEntries(ids.map((id) => [id, id + ".jpg"]))
    } }] }
  }, { navigateTo: ({ url }) => urls.push(url) });
  page.onLoad();
  await new Promise((resolve) => setImmediate(resolve));
  // 1–12 保留三组；13–36 在 v12 重做后暂不分类，平铺一组，等用户审完再定排序
  assert.deepEqual(Array.from(page.data.collections, (group) => group.scenes.length), [4, 4, 4, 24]);
  assert.equal(page.data.collections.some((group) => ["光影肖像", "静物棚拍", "胶片与布景", "屋里的光", "安静的静物"].includes(group.title)), false);
  // 2026-09：默认 10 套并预选好，点图是替换而不是跳转
  assert.equal(page.data.packageMode, "ten");
  assert.equal(page.data.selectedSceneIds.length, 10);
  page.chooseScene({ currentTarget: { dataset: { id: page.data.selectedSceneIds[0] } } });
  assert.equal(page.data.selectedSceneIds.length, 9);
  assert.equal(urls.length, 0);
  // 全部 36 套：点图只提示「全部已包含」
  const toasts = [];
  page.choosePackage({ currentTarget: { dataset: { mode: "all" } } });
  assert.equal(page.data.selectedSceneIds.length, 36);
  // 单张：点图直达照片选择
  page.choosePackage({ currentTarget: { dataset: { mode: "single" } } });
  page.chooseScene({ currentTarget: { dataset: { id: "post-office" } } });
  assert.match(urls[0], /templateId=pet-art-photo&sceneId=post-office/);
  assert.equal(toasts.length, 0);
});

test("写真套餐页面解析页面跳转时编码的 36 个场景", async () => {
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
  assert.equal(page.data.sceneIds.length, 36);
  assert.equal(page.data.scenes.length, 36);
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
    if (url === "/api/image-templates") return { entries: [{ id: "human", title: "如果我是人", templates }] };
    if (url === "/api/plugins" || url === "/api/pets" || url === "/api/owner-photos") return [];
    throw new Error(url);
  } };
  const home = loadPage("index", { api }, { navigateTo: ({ url }) => urls.push(url) });
  home.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(home.data.humanTemplateCount, 40);
  assert.deepEqual(home.data.humanCovers.map((item) => item.templateId), [31, 5, 8, 32, 7, 36, 37, 20].map((number) => "human-effect-" + String(number).padStart(2, "0")));
  assert.equal(home.data.feed.filter((item) => item.kind === "template").length, 0);
  home.data.pet = { id: "pet-1" };
  home.openHuman();
  assert.equal(urls[0], "/pages/ai-create/ai-create?entryId=human&petId=pet-1");
  // 点某一张封面直达那一款
  home.openHuman({ currentTarget: { dataset: { id: "human-effect-05" } } });
  assert.equal(urls[1], "/pages/ai-create/ai-create?entryId=human&templateId=human-effect-05&petId=pet-1");

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

test("首页瀑布流单张图片失败时仍保留该玩法入口", () => {
  const page = loadPage("index", {}, {});
  page.data.feed = [
    { key: "plugin-pet-time-album", kind: "plugin", chip: "all", cover: "broken.jpg" },
    { key: "plugin-pet-movie-poster", kind: "plugin", chip: "all", cover: "other.jpg" }
  ];
  page.onImageError({ currentTarget: { dataset: { kind: "feed", id: "plugin-pet-time-album", src: "broken.jpg" } } });
  assert.equal(page.data["feed[0].cover"], "");
  assert.equal(page.data.feed[1].cover, "other.jpg");
});

test("首页：如果我是人、麻麻精选、分类 chip 瀑布流按指定顺序展示，chip 在当前页筛选", async () => {
  const bossIds = ["animal-car-window-westie", "animal-pink-scooter", "fun-fisheye-closeup", "fish-chase", "travel-glass-summer", "pet-milk-tea-shopkeeper", "animal-sword-cat-alt", "mini-companion", "character-outfit-grid"];
  const page = loadPage("index", {
    api: { request: async (url) => {
      if (url === "/api/plugins") return ["pet-id-card", "pet-movie-poster", "pet-time-album", "pl-10", "pl-19", "pl-23"].map((id) => ({ id, name: id, category: "layout", pricing: { unlockPrice: id === "pet-movie-poster" ? 12.9 : 0 }, samples: {
        heroUrl: id + ".jpg",
        sceneOptions: id === "pl-10" ? require("../services/home-effect-ids").BOSS_SCENE_IDS.map((sceneId) => ({ id: sceneId, title: sceneId })) : [],
        sceneUrls: {}
      } }));
      if (url === "/api/image-templates") return { entries: [
        { id: "boss", title: "老板精选", templates: bossIds.map((id) => ({ templateId: id, title: id })) },
        { id: "fun", title: "好笑出片", templates: [{ templateId: "pet-wanted-poster", title: "萌宠通缉令" }] },
        { id: "art", title: "艺术肖像", templates: [{ templateId: "pet-art-photo" }, { templateId: "ink-portrait" }] }
      ] };
      throw new Error(url);
    } }
  }, {});
  page.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(page.data.bossTemplates, (item) => item.templateId), ["fish-chase", "character-outfit-grid", "animal-sword-cat-alt", "travel-glass-summer", "pet-milk-tea-shopkeeper", "fun-fisheye-closeup", "mini-companion", "animal-pink-scooter"]);
  assert.deepEqual(Array.from(page.data.bossScenes, (item) => item.id), ["window-morning", "seaside-breeze", "library-whisper", "autumn-leaves", "berry-pastry-chef", "ballet-backstage"]);
  // 瀑布流：分类封面卡 → 图文 / 短片玩法 → 趣测卡；不再有自动轮播和「作品玩法」重复网格
  assert.deepEqual(Array.from(page.data.feed, (item) => item.key), ["entry-fun", "entry-art", "plugin-pet-movie-poster", "plugin-pet-time-album", "plugin-pl-19", "plugin-pl-23", "plugin-pet-id-card", "fun-tests"]);
  const ink = page.data.feed.find((item) => item.templateId === "ink-portrait");
  assert.equal(ink.cover, "/assets/home-effects/covers/ink-portrait.jpg");
  assert.match(page.data.feed.find((item) => item.key === "plugin-pet-movie-poster").note, /¥12.9 保存/);
  assert.deepEqual(Array.from(page.data.chips, (item) => item.id), ["all", "fun", "art"]);
  assert.equal(page.data.feedLeft.length + page.data.feedRight.length, 8);
  // 选分类 chip：展开这一类的全部模板卡，点卡直达该模板
  page.chooseChip({ currentTarget: { dataset: { id: "fun" } } });
  assert.deepEqual(Array.from(page.data.feedLeft.concat(page.data.feedRight), (item) => item.key), ["tpl-pet-wanted-poster"]);
  page.chooseChip({ currentTarget: { dataset: { id: "art" } } });
  assert.deepEqual(Array.from(page.data.feedLeft.concat(page.data.feedRight), (item) => item.key), ["tpl-ink-portrait"]);
  page.chooseChip({ currentTarget: { dataset: { id: "all" } } });
  assert.equal(page.data.feedLeft.length + page.data.feedRight.length, 8);
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
  // 2026-10：每次只出 1 张，底栏写「为我拍一张 / 满意再保存 ¥价格 / 开始」，不再出现「给我挑」
  assert.match(aiWxml, /为{{petText || '我'}}拍一张/);
  assert.doesNotMatch(aiWxml, /给我挑|2 选 1/);
  assert.match(aiWxml, /bindtap="create">开始<\/t-button>/);
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

test("多效果页面同时渲染候选项并通过点击选择", () => {
  for (const name of ["ai-create", "create"]) {
    const markup = fs.readFileSync(path.join(__dirname, "../pages", name, name + ".wxml"), "utf8");
    assert.doesNotMatch(markup, /<swiper[\s>]/);
    assert.match(markup, /wx:for="\{\{(?:carouselTemplates|pluginId ===)/);
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

const DUO_ENTRY = { id: "duo", title: "人宠写真", templates: [
  { templateId: "duo-stripes-cheek", title: "贴脸大笑", subjectMode: "owner-pet", groupId: "duo-stripes", groupTitle: "同款条纹", groupDescription: "撞色影棚 · 贴脸大笑", sampleUrl: "a.jpg" },
  { templateId: "duo-stripes-kiss", title: "被偷亲", subjectMode: "owner-pet", groupId: "duo-stripes", groupTitle: "同款条纹", groupDescription: "撞色影棚 · 贴脸大笑", sampleUrl: "b.jpg" },
  { templateId: "duo-seaside-run", title: "踏浪奔跑", subjectMode: "owner-pet", groupId: "duo-seaside", groupTitle: "海边奔跑", groupDescription: "浪花里 · 一起疯跑", sampleUrl: "c.jpg" },
  { templateId: "duo-seaside-lean", title: "靠着看海", subjectMode: "owner-pet", groupId: "duo-seaside", groupTitle: "海边奔跑", groupDescription: "浪花里 · 一起疯跑", sampleUrl: "d.jpg" }
] };

test("首页写真馆：宠物写真与人宠写真两张入口卡，横滑混排，人宠不进瀑布流", async () => {
  const urls = [];
  const page = loadPage("index", {
    api: { request: async (url) => {
      if (url === "/api/plugins") return [{ id: "pl-10", name: "写真", category: "ai-image", pricing: { unlockPrice: 16.9 }, samples: {
        sceneOptions: require("../services/home-effect-ids").BOSS_SCENE_IDS.map((sceneId) => ({ id: sceneId, title: sceneId })), sceneUrls: {}
      } }];
      if (url === "/api/image-templates") return { entries: [DUO_ENTRY, { id: "fun", title: "好笑出片", templates: [{ templateId: "pet-wanted-poster", title: "萌宠通缉令" }] }] };
      throw new Error(url);
    } }
  }, { navigateTo: ({ url }) => urls.push(url), switchTab: ({ url }) => urls.push(url) });
  page.load();
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(Array.from(page.data.duoCovers, (item) => item.templateId), ["duo-stripes-cheek", "duo-seaside-run"]);
  assert.equal(page.data.duoGroupCount, 2);
  assert.deepEqual(Array.from(page.data.studioStrip.slice(0, 4), (item) => item.kind), ["scene", "duo", "scene", "duo"]);
  assert.equal(page.data.duoCovers[0].title, "同款条纹");
  assert.equal(page.data.feed.some((item) => item.entryId === "duo"), false);
  assert.equal(page.data.chips.some((item) => item.id === "duo"), false);
  // 点横滑里的人宠样片直达制作页，点宠物写真样片走单张写真
  page.openStudioItem({ currentTarget: { dataset: { kind: "duo", id: "duo-seaside-run" } } });
  assert.match(urls.pop(), /ai-create\?entryId=duo&templateId=duo-seaside-run/);
  page.openStudioItem({ currentTarget: { dataset: { kind: "scene", id: "window-morning" } } });
  assert.match(urls.pop(), /templateId=pet-art-photo&sceneId=window-morning/);
  page.openArtStudio({ currentTarget: { dataset: { mode: "duo" } } });
  assert.equal(urls.pop(), "/pages/art-photo/art-photo");
});

test("写真馆人宠写真：按组展示两个镜头，点镜头进主人 + 宠物制作页", async () => {
  const urls = [];
  const ids = require("../services/home-effect-ids").BOSS_SCENE_IDS;
  const page = loadPage("art-photo", {
    api: { request: async (url) => {
      if (url === "/api/plugins") return [{ id: "pl-10", pricing: { unlockPrice: 16.9 }, samples: { sceneOptions: ids.map((id) => ({ id, title: id, description: id })), sceneUrls: {} } }];
      if (url === "/api/image-templates") return { entries: [DUO_ENTRY] };
      return null;
    } }
  }, { navigateTo: ({ url }) => urls.push(url) });
  page.onLoad({ mode: "duo" });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(page.data.artMode, "duo");
  assert.equal(page.data.duoCount, 4);
  assert.deepEqual(Array.from(page.data.duoGroups, (group) => [group.title, group.shots.length]), [["同款条纹", 2], ["海边奔跑", 2]]);
  assert.match(page.data.duoPriceText, /¥16.9/);
  // 人宠写真不在「其他玩法」里重复
  assert.equal(page.data.categories.some((item) => item.id === "duo"), false);
  page.openDuoTemplate({ currentTarget: { dataset: { id: "duo-stripes-kiss" } } });
  assert.equal(urls[0], "/pages/ai-create/ai-create?entryId=duo&templateId=duo-stripes-kiss");
  page.chooseArtMode({ currentTarget: { dataset: { id: "pet" } } });
  assert.equal(page.data.artMode, "pet");
});
