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
      return dependencies[module.split("/").pop()] || {};
    },
    wx, console
  });
  return Object.assign({}, definition, {
    data: JSON.parse(JSON.stringify(definition.data)),
    setData(values) { Object.assign(this.data, values); }
  });
}

test("艺术写真展示十二套场景并提交所选场景", async () => {
  const ids = ["window-morning", "garden-curious", "studio-confident", "night-playful", "seaside-breeze", "library-whisper", "autumn-leaves", "snow-cabin", "cafe-afternoon", "lakeside-sunset", "city-rain", "spring-picnic"];
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
  assert.equal(page.data.sceneOptions.length, 12);
  page.chooseScene({ currentTarget: { dataset: { id: "spring-picnic" } } });
  page.setData({ photoIds: ["photo"] });
  page.create();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(submitted.options.scene, "spring-picnic");
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
