const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const { manifest, pluginSample, imageEntries } = require("../services/sample-assets");
const sharp = require(require.resolve("sharp", { paths: [path.resolve(__dirname, "../../platform")] }));

test("公开样片均随小程序打包，首屏图片不依赖开发服务器域名", () => {
  const root = path.resolve(__dirname, "..");
  const paths = ["plugins", "scenes", "templates", "movie", "album", "interactive"].flatMap((name) => Object.values(manifest[name]));
  assert.ok(paths.length >= 100);
  for (const url of paths) {
    assert.match(url, /^\/assets\/samples\//);
    assert.ok(fs.statSync(path.join(root, url.slice(1))).size > 0, url);
  }
  const original = { id: "pl-10", samples: { heroUrl: "/api/plugin-samples/old.jpg", sceneUrls: { "window-morning": "/api/plugin-samples/scene.jpg" } } };
  const plugin = pluginSample(original);
  assert.equal(plugin.samples.heroUrl, manifest.plugins["pl-10"]);
  assert.equal(plugin.samples.sceneUrls["window-morning"], manifest.scenes["window-morning"]);
  assert.equal(original.samples.heroUrl, "/api/plugin-samples/old.jpg");
  const entries = imageEntries([{ id: "fun", templates: [{ templateId: "pet-wanted-poster", sampleUrl: "http://127.0.0.1:3000/sample" }] }]);
  assert.equal(entries[0].templates[0].sampleUrl, manifest.templates["pet-wanted-poster"]);
});

test("模板和场景缩略图保持来源方向及预期比例", async () => {
  const root = path.resolve(__dirname, "..");
  for (const [id, url] of Object.entries(manifest.templates)) {
    if (id === "pet-art-photo") continue;
    const meta = await sharp(path.join(root, url.slice(1))).metadata();
    const ratio = meta.width / meta.height;
    assert.ok(manifest.templateShapes[id] === "wide" ? ratio > 1.5 : ratio < 0.65, id + " ratio=" + ratio);
  }
  for (const [id, url] of Object.entries(manifest.scenes)) {
    const meta = await sharp(path.join(root, url.slice(1))).metadata();
    assert.ok(Math.abs(meta.width / meta.height - 0.75) < 0.02, id);
  }
});
