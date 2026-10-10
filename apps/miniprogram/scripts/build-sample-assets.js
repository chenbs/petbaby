const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "../../..");
const platform = path.join(root, "apps/platform");
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const ts = require(require.resolve("typescript", { paths: [platform] }));
const output = path.join(root, "apps/miniprogram/assets/samples");
const registry = fs.readFileSync(path.join(platform, "src/server/image-template-registry.ts"), "utf8");
const source = ts.createSourceFile("registry.ts", registry, ts.ScriptTarget.Latest, true);

function declaration(name) {
  let result;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) result = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  if (!result) throw new Error("Missing registry declaration: " + name);
  return result;
}

function fields(node) {
  const result = {};
  for (const property of node.properties || []) {
    if (ts.isPropertyAssignment(property) && ts.isStringLiteral(property.initializer)) {
      result[property.name.text] = property.initializer.text;
    }
  }
  return result;
}

const overrides = fields(declaration("publicPreviewStorageKeyOverrides"));
const templates = declaration("registeredTemplates").elements.map(fields).filter((item) => item.status === "live");
const pluginSources = {
  "pet-id-card": "mp26-pet-id-card.jpg",
  "pet-movie-poster": "mp26-pet-movie-poster-v4.jpg",
  "pet-time-album": "mp26-pet-time-album.jpg",
  "pl-10": "mp26-gray-toy-poodle-editorial-v1.jpg",
  "pl-19": "mp26-pl-19.jpg",
  "pl-23": "mp26-pl-23-v4.jpg"
};
const scenes = {
  "window-morning": "v3", "garden-curious": "v3", "studio-confident": "v3",
  "night-playful": "v3", "seaside-breeze": "v3", "library-whisper": "v3",
  "autumn-leaves": "v3", "snow-cabin": "v14", "cafe-afternoon": "v3",
  "lakeside-sunset": "v14", "city-rain": "v14", "spring-picnic": "v14",
  "railway-traveler": "v14", "tennis-champion": "v14", "greenhouse-gardener": "v14", "sailboat-holiday": "v14",
  "berry-pastry-chef": "v14", "paper-flower-window": "v14", "mountain-cable-car": "v14", "laundry-day": "v14",
  "museum-curator": "v14", "poolside-vacation": "v14", "post-office": "v14", "ballet-backstage": "v12",
  "shorthair-armchair": "v14", "shorthair-books": "v13", "shorthair-night-rim": "v11", "shorthair-paper-bag": "v14",
  "corgi-denim": "v11", "corgi-crate": "v9", "corgi-sploot": "v14", "corgi-sweater": "v14",
  "calico-silk": "v12", "calico-bowl": "v12", "calico-rain-window": "v14", "calico-cane-stool": "v11"
};
const movieScenes = {
  highseas: path.join(root, "tools/imagegen/out/movie-album-v3/movie-highseas.jpg"),
  musical: path.join(root, "tools/imagegen/out/movie-album-v3/movie-musical.jpg"),
  webcity: path.join(root, "tools/imagegen/out/movie-album-v3/movie-webcity.jpg"),
  starvoyage: path.join(root, "tools/imagegen/out/movie-album-v3/movie-starvoyage.jpg")
};
const albumScenes = {
  growth: path.join(root, "tools/imagegen/out/movie-album-v2/album-growth.jpg"),
  birthday: path.join(root, "tools/imagegen/out/movie-album-v2/album-birthday.jpg"),
  healing: path.join(root, "tools/imagegen/out/movie-album-v2/album-healing.jpg"),
  holiday: path.join(root, "tools/imagegen/out/movie-album-v2/album-holiday.jpg")
};
const manifest = { plugins: {}, scenes: {}, templates: {}, movie: {}, album: {}, templateShapes: {} };

async function thumbnail(input, target, width, height, options = {}) {
  if (!fs.existsSync(input)) throw new Error("Missing public sample: " + input);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  let image = sharp(input).resize(width, height, { fit: "inside", withoutEnlargement: true });
  if (options.saturation) image = image.modulate({ saturation: options.saturation });
  if (options.frame) {
    const inset = options.inset || 12;
    image = sharp(await image.resize(width - inset * 2, height - inset * 2).jpeg({ quality: 58 }).toBuffer())
      .extend({ top: inset, bottom: inset, left: inset, right: inset, background: options.frame });
  }
  await image.jpeg({ quality: options.quality || 55, mozjpeg: true }).toFile(target);
}

async function albumPage(id, target, scale = 1) {
  await thumbnail(albumScenes[id], target, Math.round(320 * scale), Math.round(420 * scale), { quality: scale === 1 ? 60 : 78 });
}

async function moviePoster(id, target, scale = 1) {
  await thumbnail(movieScenes[id], target, Math.round(320 * scale), Math.round(420 * scale), { quality: scale === 1 ? 60 : 78 });
}

async function main() {
  for (const [id, filename] of Object.entries(pluginSources)) {
    const target = path.join(output, "plugins", id + ".jpg");
    await thumbnail(path.join(root, "tools/imagegen/out/plugins", filename), target, 480, 300);
    manifest.plugins[id] = "/assets/samples/plugins/" + id + ".jpg";
  }
  for (const [id, version] of Object.entries(scenes)) {
    const target = path.join(output, "scenes", id + ".jpg");
    await thumbnail(path.join(root, "tools/imagegen/out/scenes", "scene-" + id + "-" + version + ".jpg"), target, 280, 374);
    manifest.scenes[id] = "/assets/samples/scenes/" + id + ".jpg";
  }
  for (const item of templates) {
    const master = item.masterStorageKey;
    if (!master) throw new Error("Live template has no public master: " + item.templateId);
    const sampleKey = item.subjectMode === "pet-human" ? master
      : overrides[item.templateId] || master.replace("/image-templates/", "/image-template-previews/");
    const target = path.join(output, "templates", item.templateId + ".jpg");
    const sourcePath = path.join(platform, ".data/objects", sampleKey);
    const metadata = await sharp(sourcePath).metadata();
    const wide = metadata.width > metadata.height;
    await thumbnail(sourcePath, target, wide ? 440 : 220, wide ? 248 : 392);
    manifest.templates[item.templateId] = "/assets/samples/templates/" + item.templateId + ".jpg";
    manifest.templateShapes[item.templateId] = wide ? "wide" : "portrait";
  }
  manifest.templates["pet-art-photo"] = manifest.plugins["pl-10"];
  manifest.templateShapes["pet-art-photo"] = "wide";
  manifest.movie.rooftop = manifest.plugins["pet-movie-poster"];
  for (const group of ["movie", "album"]) {
    for (const id of Object.keys(group === "movie" ? movieScenes : albumScenes)) {
      const target = path.join(output, group, id + ".jpg");
      if (group === "movie") await moviePoster(id, target);
      else await albumPage(id, target);
      manifest[group][id] = "/assets/samples/" + group + "/" + id + ".jpg";
    }
  }
  fs.writeFileSync(path.join(output, "manifest.js"), "module.exports = " + JSON.stringify(manifest, null, 2) + ";\n");
  console.log("Built " + ["plugins", "scenes", "templates", "movie", "album"].reduce((sum, group) => sum + Object.keys(manifest[group]).length, 0) + " local sample images.");
}

module.exports = { pluginSources, scenes, movieScenes, albumScenes, templates, overrides, thumbnail, albumPage, moviePoster };
if (require.main === module) main().catch((error) => { console.error(error); process.exitCode = 1; });
