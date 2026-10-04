const config = require("../config");
const rawManifest = require("../assets/samples/manifest");

function publicUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (url.indexOf("/assets/") === 0) return url;
  if (url.charAt(0) === "/") return config.apiBaseUrl + url;
  return url;
}

const manifest = Object.assign({}, rawManifest);
for (const group of ["plugins", "scenes", "templates", "movie", "album", "funTests", "covers"]) {
  manifest[group] = Object.fromEntries(Object.entries(rawManifest[group] || {}).map(([id, url]) => [id, publicUrl(url)]));
}

function pluginSample(plugin) {
  const samples = plugin.samples || {};
  const sceneUrls = {};
  Object.keys(samples.sceneUrls || {}).forEach((id) => {
    sceneUrls[id] = manifest.scenes[id] || publicUrl(samples.sceneUrls[id]);
  });
  return Object.assign({}, plugin, {
    samples: Object.assign({}, samples, {
      heroUrl: manifest.plugins[plugin.id] || publicUrl(samples.heroUrl),
      sceneUrls
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
