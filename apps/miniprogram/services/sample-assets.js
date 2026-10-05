const config = require("../config");
const rawManifest = require("../assets/samples/manifest");

function publicUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (url.indexOf("/assets/") === 0) return url;
  if (url.charAt(0) === "/") return config.apiBaseUrl + url;
  return url;
}

const manifest = Object.assign({}, rawManifest);
// scenesHd / templatesHd：原图分辨率 + 轻锐化的高清样片，只给大图位置用（见 scripts/publish-hd-samples.mjs）
for (const group of ["plugins", "scenes", "templates", "movie", "album", "funTests", "covers", "scenesHd", "templatesHd", "pluginsHd"]) {
  manifest[group] = Object.fromEntries(Object.entries(rawManifest[group] || {}).map(([id, url]) => [id, publicUrl(url)]));
}

function pluginSample(plugin) {
  const samples = plugin.samples || {};
  const sceneUrls = {};
  const sceneHdUrls = {};
  Object.keys(samples.sceneUrls || {}).forEach((id) => {
    sceneUrls[id] = manifest.scenes[id] || publicUrl(samples.sceneUrls[id]);
    sceneHdUrls[id] = manifest.scenesHd[id] || sceneUrls[id];
  });
  return Object.assign({}, plugin, {
    samples: Object.assign({}, samples, {
      heroUrl: manifest.plugins[plugin.id] || publicUrl(samples.heroUrl),
      // 详情页全宽封面用的高清版（首页瀑布流小卡继续用 heroUrl）
      heroHdUrl: manifest.pluginsHd[plugin.id] || manifest.plugins[plugin.id] || publicUrl(samples.heroUrl),
      sceneUrls,
      sceneHdUrls
    })
  });
}

/**
 * 服务端模板样片存的是 WebP，小程序 <image> 默认不解 WebP（真机空白、模拟器正常）。
 * 没有端上 manifest 映射的模板（如如果我是人 40 款）走服务端地址时，统一要 JPEG。
 */
function jpegSampleUrl(url) {
  const absolute = publicUrl(url);
  if (!absolute || absolute.indexOf("/api/image-templates/") < 0 || /[?&]format=/.test(absolute)) return absolute;
  return absolute + (absolute.indexOf("?") >= 0 ? "&" : "?") + "format=jpeg";
}

function templateSample(template) {
  return Object.assign({}, template, {
    sampleUrl: manifest.templates[template.templateId] || jpegSampleUrl(template.sampleUrl),
    // 大图位置用的高清样片；没有高清版的模板回落到普通样片
    hdUrl: manifest.templatesHd[template.templateId] || manifest.templates[template.templateId] || jpegSampleUrl(template.sampleUrl),
    sampleShape: manifest.templateShapes[template.templateId] || "portrait"
  });
}

function imageEntries(entries) {
  return (entries || []).map((entry) => Object.assign({}, entry, {
    templates: (entry.templates || []).map(templateSample)
  }));
}

module.exports = {
  manifest,
  pluginSample,
  imageEntries
};
