const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { manifest, pluginSample, imageEntries } = require("../services/sample-assets");
const sharp = require(require.resolve("sharp", { paths: [path.resolve(__dirname, "../../platform")] }));

test("首页样片留在包内，其他玩法样片从静态 COS 读取", () => {
  const root = path.resolve(__dirname, "..");
  const paths = ["plugins", "scenes", "templates", "movie", "album", "funTests", "covers"].flatMap((name) => Object.values(manifest[name]));
  const local = new Set(paths.filter((url) => url.startsWith("/assets/")));
  const remote = paths.filter((url) => !url.startsWith("/assets/"));
  // 2026-09 互动星尘页（PL-15）下线，首页卡片图 pl-15.jpg 随之删除：30 → 29。
  assert.equal(local.size, 29);
  // 同上，互动组 3 张远程样片（stardust/meadow/sunset）移除：93 → 90。
  assert.equal(remote.length, 90 + 12); // 2026-10：写真扩到 36 套，新增美短 / 柯基 / 三花各 4 张远程样片
  for (const id of ["berry-pastry-chef", "ballet-backstage"]) {
    assert.equal(manifest.scenes[id], "/assets/home-effects/scenes/" + id + ".jpg");
  }
  assert.equal(manifest.covers["ink-portrait"], "/assets/home-effects/covers/ink-portrait.jpg");
  assert.equal(manifest.movie.rooftop, manifest.plugins["pet-movie-poster"]);
  assert.deepEqual(Object.keys(manifest.movie), ["rooftop", "highseas", "musical", "webcity", "starvoyage"]);
  assert.deepEqual(Object.keys(manifest.album), ["growth", "birthday", "healing", "holiday"]);
  assert.match(manifest.templates["ink-portrait"], /^https:\/\//);
  for (const url of local) {
    assert.match(url, /^\/assets\/(?:home-effects|fun-tests)\//);
    assert.ok(fs.statSync(path.join(root, url.slice(1))).size > 0, url);
  }
  for (const url of remote) {
    assert.ok(["v2", "v3"].some((version) => url.startsWith("https://babykitty-static-one-1252454114.cos.ap-shanghai.myqcloud.com/samples/miniprogram-effects/" + version + "/")), url);
    assert.match(url, /-[a-f0-9]{64}\.jpg$/);
  }
  const ignored = require("../project.config.json").packOptions.ignore;
  for (const group of ["plugins", "scenes", "templates", "movie", "album"]) {
    assert.ok(ignored.some((item) => item.type === "folder" && item.value === "assets/samples/" + group));
  }
  for (const id of ["recharge", "bond", "luck"]) {
    assert.ok(ignored.some((item) => item.type === "file" && item.value === `assets/fun-tests/${id}.jpg`));
  }
  const original = { id: "pl-10", samples: { heroUrl: "/api/plugin-samples/old.jpg", sceneUrls: { "window-morning": "/api/plugin-samples/scene.jpg" } } };
  const plugin = pluginSample(original);
  assert.equal(plugin.samples.heroUrl, manifest.plugins["pl-10"]);
  assert.equal(plugin.samples.sceneUrls["window-morning"], manifest.scenes["window-morning"]);
  assert.equal(original.samples.heroUrl, "/api/plugin-samples/old.jpg");
  const entries = imageEntries([{ id: "fun", templates: [{ templateId: "pet-wanted-poster", sampleUrl: "http://127.0.0.1:3000/sample" }] }]);
  assert.equal(entries[0].templates[0].sampleUrl, manifest.templates["pet-wanted-poster"]);
  const human = imageEntries([{ id: "human", templates: [{ templateId: "human-effect-31", sampleUrl: "/api/image-templates/human-effect-31/sample" }] }]);
  assert.equal(human[0].templates[0].sampleUrl, require("../config").apiBaseUrl + "/api/image-templates/human-effect-31/sample?format=jpeg");
});

test("模板和场景缩略图保持来源方向及预期比例", async () => {
  const root = path.resolve(__dirname, "..");
  for (const [id, url] of Object.entries(manifest.templates)) {
    if (id === "pet-art-photo") continue;
    const file = url.startsWith("/assets/") ? path.join(root, url.slice(1)) : path.join(root, "assets/samples/templates", id + ".jpg");
    const meta = await sharp(file).metadata();
    const ratio = meta.width / meta.height;
    assert.ok(manifest.templateShapes[id] === "wide" ? ratio > 1.5 : ratio < 0.65, id + " ratio=" + ratio);
  }
  for (const [id, url] of Object.entries(manifest.scenes)) {
    const file = url.startsWith("/assets/") ? path.join(root, url.slice(1)) : path.join(root, "assets/samples/scenes", id + ".jpg");
    const meta = await sharp(file).metadata();
    assert.ok(Math.abs(meta.width / meta.height - 0.75) < 0.02, id);
  }
});
