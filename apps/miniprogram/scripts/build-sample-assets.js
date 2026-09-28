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
  "pet-movie-poster": "mp26-pet-movie-poster-v3.jpg",
  "pet-time-album": "mp26-pet-time-album.jpg",
  "pl-10": "mp26-gray-toy-poodle-editorial-v1.jpg",
  "pl-15": "mp26-pl-15-photographic-v2.jpg",
  "pl-19": "mp26-pl-19.jpg",
  "pl-23": "mp26-pl-23-v4.jpg"
};
const scenes = {
  "window-morning": "v3", "garden-curious": "v3", "studio-confident": "v3",
  "night-playful": "v3", "seaside-breeze": "v3", "library-whisper": "v3",
  "autumn-leaves": "v3", "snow-cabin": "v4", "cafe-afternoon": "v3",
  "lakeside-sunset": "v4", "city-rain": "v3", "spring-picnic": "v4",
  "railway-traveler": "v4", "tennis-champion": "v4", "greenhouse-gardener": "v4", "sailboat-holiday": "v4",
  "berry-pastry-chef": "v4", "paper-flower-window": "v4", "mountain-cable-car": "v4", "laundry-day": "v4",
  "museum-curator": "v4", "poolside-vacation": "v4", "post-office": "v4", "ballet-backstage": "v4"
};
const palettes = {
  movie: { classic: "#101820", arthouse: "#d8e8df", hongkong: "#e63d25" },
  album: { growth: "#edf8f2", birthday: "#fff1b7", healing: "#e8f1ff", holiday: "#fff0ec" }
};
const movieScenes = {
  classic: path.join(root, "tools/imagegen/out/plugins/mp26-pet-movie-poster-v3.jpg"),
  arthouse: path.join(root, "tools/imagegen/out/scenes/scene-window-morning-v3.jpg"),
  hongkong: path.join(root, "tools/imagegen/out/scenes/scene-city-rain-v3.jpg")
};
const albumScenes = {
  growth: "scene-spring-picnic-v4.jpg",
  birthday: "scene-studio-confident-v3.jpg",
  healing: "scene-window-morning-v3.jpg",
  holiday: "scene-snow-cabin-v4.jpg"
};
const interactiveColors = { stardust: "#141b3d", meadow: "#1c3326", sunset: "#3b1e2b" };
const manifest = { plugins: {}, scenes: {}, templates: {}, movie: {}, album: {}, interactive: {}, templateShapes: {} };

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
  await image.jpeg({ quality: 55, mozjpeg: true }).toFile(target);
}

async function albumPage(id, target) {
  const photo = await sharp(path.join(root, "tools/imagegen/out/scenes", albumScenes[id]))
    .resize(256, 286, { fit: "cover", position: "attention" }).jpeg({ quality: 65 }).toBuffer();
  const paper = Buffer.from('<svg width="320" height="420" xmlns="http://www.w3.org/2000/svg"><rect x="14" y="15" width="292" height="390" rx="5" fill="#ffffff"/><text x="32" y="370" fill="#53645b" font-family="sans-serif" font-size="14">DAY 01 · 和你一起的日子</text><rect x="32" y="382" width="94" height="3" fill="#53645b"/></svg>');
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp({ create: { width: 320, height: 420, channels: 4, background: palettes.album[id] } })
    .composite([{ input: paper }, { input: photo, left: 32, top: 34 }])
    .jpeg({ quality: 60, mozjpeg: true }).toFile(target);
}

async function moviePoster(id, target) {
  const color = palettes.movie[id];
  const copy = {
    classic: ["THE PET FILM", "年度主角"],
    arthouse: ["A QUIET AFTERNOON", "和它虚度的下午"],
    hongkong: ["CITY OF PETS", "它的城市风云"]
  }[id];
  const ink = id === "arthouse" ? "#203b31" : "#ffffff";
  const overlay = Buffer.from(`<svg width="320" height="420" xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="shade" x1="0" y1="0" x2="0" y2="1"><stop offset="0.34" stop-color="${color}" stop-opacity="0"/><stop offset="1" stop-color="${color}" stop-opacity="0.98"/></linearGradient></defs><rect width="320" height="420" fill="url(#shade)"/><text x="22" y="332" fill="${ink}" font-family="sans-serif" font-size="12">${copy[0]}</text><text x="20" y="371" fill="${ink}" font-family="serif" font-weight="bold" font-size="27">${copy[1]}</text><rect x="20" y="385" width="96" height="3" fill="${id === "arthouse" ? "#203b31" : "#f4c941"}"/></svg>`);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  await sharp(movieScenes[id]).resize(320, 420, { fit: "cover", position: "attention" })
    .composite([{ input: overlay }]).jpeg({ quality: 60, mozjpeg: true }).toFile(target);
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
  for (const group of ["movie", "album"]) {
    for (const id of Object.keys(palettes[group])) {
      const target = path.join(output, group, id + ".jpg");
      if (group === "movie") await moviePoster(id, target);
      else await albumPage(id, target);
      manifest[group][id] = "/assets/samples/" + group + "/" + id + ".jpg";
    }
  }
  for (const [id, color] of Object.entries(interactiveColors)) {
    const target = path.join(output, "interactive", id + ".jpg");
    await thumbnail(path.join(root, "tools/imagegen/out/plugins", pluginSources["pl-15"]), target, 320, 420, { frame: color, inset: 26 });
    manifest.interactive[id] = "/assets/samples/interactive/" + id + ".jpg";
  }
  fs.writeFileSync(path.join(output, "manifest.js"), "module.exports = " + JSON.stringify(manifest, null, 2) + ";\n");
  console.log("Built " + ["plugins", "scenes", "templates", "movie", "album", "interactive"].reduce((sum, group) => sum + Object.keys(manifest[group]).length, 0) + " local sample images.");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
