const config = require("../config");
const manifest = require("../assets/samples/manifest");

function publicUrl(url) {
  if (!url || typeof url !== "string") return "";
  if (url.charAt(0) === "/") return config.apiBaseUrl + url;
  return url;
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

function templateSample(template) {
  return Object.assign({}, template, {
    sampleUrl: manifest.templates[template.templateId] || publicUrl(template.sampleUrl),
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
