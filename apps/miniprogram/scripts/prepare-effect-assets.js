const fs = require("node:fs");
const path = require("node:path");
const { createHash } = require("node:crypto");

const root = path.resolve(__dirname, "../../..");
const platform = path.join(root, "apps/platform");
const sharp = require(require.resolve("sharp", { paths: [platform] }));
const { CATEGORY_COVERS, BOSS_TEMPLATE_IDS, BOSS_SCENE_IDS } = require("../services/home-effect-ids");
const { pluginSources, scenes, movieScenes, albumScenes, interactiveColors, templates, overrides, thumbnail, albumPage, moviePoster } = require("./build-sample-assets");

const legacyRoot = path.join(root, "apps/miniprogram/assets/samples");
const homeRoot = path.join(root, "apps/miniprogram/assets/home-effects");
const stageRoot = path.join(platform, ".data/miniprogram-effects");
const remoteRoot = path.join(stageRoot, "remote");
const staticOrigin = "https://babykitty-static-one-1252454114.cos.ap-shanghai.myqcloud.com";
const manifest = { plugins: {}, scenes: {}, templates: {}, movie: {}, album: {}, interactive: {}, funTests: {}, covers: {}, templateShapes: {} };
const plan = { version: 1, home: [], remote: [], manifest };

const firstByEntry = new Map();
for (const template of templates) if (!firstByEntry.has(template.entryId)) firstByEntry.set(template.entryId, template.templateId);
const homeTemplateIds = new Set(BOSS_TEMPLATE_IDS);
for (const [entryId, firstId] of firstByEntry) {
  if (entryId === "boss" || entryId === "art") continue;
  const preferred = CATEGORY_COVERS[entryId];
  homeTemplateIds.add(preferred && templates.some((item) => item.templateId === preferred) ? preferred : firstId);
}
const homeScenes = new Set(BOSS_SCENE_IDS);

function digest(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function scaledTarget(group, id) {
  const old = path.join(legacyRoot, group, id + ".jpg");
  if (!fs.existsSync(old) && (group === "movie" || group === "album")) {
    return Promise.resolve({ width: 480, height: 630, oldWidth: 320, oldHeight: 420 });
  }
  if (!fs.existsSync(old)) throw new Error("缺少当前效果图：" + old);
  return sharp(old).metadata().then((meta) => ({ width: Math.round(meta.width * 1.5), height: Math.round(meta.height * 1.5), oldWidth: meta.width, oldHeight: meta.height }));
}

async function record(group, id, source, home, render) {
  const size = await scaledTarget(group, id);
  const directory = home ? path.join(homeRoot, group) : path.join(remoteRoot, group);
  fs.mkdirSync(directory, { recursive: true });
  const draft = path.join(directory, id + ".jpg");
  await render(source, draft, size.width, size.height);
  const meta = await sharp(draft).metadata();
  if (meta.width < size.width - 2 || meta.height < size.height - 2) throw new Error(`${group}/${id} 导出尺寸不足：${meta.width}x${meta.height}`);
  const hash = digest(draft);
  const file = home ? draft : path.join(directory, `${id}-${hash.slice(0, 12)}.jpg`);
  if (!home) fs.renameSync(draft, file);
  const version = group === "movie" || group === "album" ? "v3" : "v2";
  const key = home ? "" : `samples/miniprogram-effects/${version}/${group}/${id}-${hash}.jpg`;
  const url = home ? `/assets/home-effects/${group}/${id}.jpg` : `${staticOrigin}/${key}`;
  manifest[group][id] = url;
  (home ? plan.home : plan.remote).push({ group, id, file: path.relative(root, file).replace(/\\/g, "/"), key, url,
    width: meta.width, height: meta.height, oldWidth: size.oldWidth, oldHeight: size.oldHeight,
    bytes: fs.statSync(file).size, sha256: hash });
}

async function main() {
  for (const [id, filename] of Object.entries(pluginSources)) {
    await record("plugins", id, path.join(root, "tools/imagegen/out/plugins", filename), true,
      (source, target, width, height) => thumbnail(source, target, width, height, { quality: 78 }));
  }
  for (const [id, version] of Object.entries(scenes)) {
    await record("scenes", id, path.join(root, "tools/imagegen/out/scenes", `scene-${id}-${version}.jpg`), homeScenes.has(id),
      (source, target, width, height) => thumbnail(source, target, width, height, { quality: 78 }));
  }
  for (const item of templates) {
    const master = item.masterStorageKey;
    if (!master) throw new Error("上线模板缺少来源：" + item.templateId);
    const sampleKey = item.subjectMode === "pet-human" ? master
      : overrides[item.templateId] || master.replace("/image-templates/", "/image-template-previews/");
    const source = path.join(platform, ".data/objects", sampleKey);
    const meta = await sharp(source).metadata();
    manifest.templateShapes[item.templateId] = meta.width > meta.height ? "wide" : "portrait";
    await record("templates", item.templateId, source, homeTemplateIds.has(item.templateId),
      (input, target, width, height) => thumbnail(input, target, width, height, { quality: 78 }));
  }
  manifest.templates["pet-art-photo"] = manifest.plugins["pl-10"];
  manifest.templateShapes["pet-art-photo"] = "wide";
  const ink = templates.find((item) => item.templateId === "ink-portrait");
  if (!ink || !ink.masterStorageKey) throw new Error("黑白水墨首页封面缺少原图");
  const inkPreview = ink.masterStorageKey.replace("/image-templates/", "/image-template-previews/");
  const inkSource = path.join(platform, ".data/objects", inkPreview);
  const coverFile = path.join(homeRoot, "covers/ink-portrait.jpg");
  fs.mkdirSync(path.dirname(coverFile), { recursive: true });
  const cover = await sharp(inkSource).extract({ left: 0, top: 165, width: 720, height: 440 })
    .resize(1080, 660).jpeg({ quality: 82 }).toFile(coverFile);
  manifest.covers["ink-portrait"] = "/assets/home-effects/covers/ink-portrait.jpg";
  plan.home.push({ group: "covers", id: "ink-portrait", file: path.relative(root, coverFile).replace(/\\/g, "/"),
    key: "", url: manifest.covers["ink-portrait"], width: cover.width, height: cover.height,
    oldWidth: 720, oldHeight: 440, bytes: cover.size, sha256: digest(coverFile) });
  for (const id of Object.keys(movieScenes)) {
    await record("movie", id, movieScenes[id], false, (_source, target) => moviePoster(id, target, 1.5));
  }
  manifest.movie.rooftop = manifest.plugins["pet-movie-poster"];
  for (const id of Object.keys(albumScenes)) {
    await record("album", id, albumScenes[id], false, (_source, target) => albumPage(id, target, 1.5));
  }
  for (const [id, color] of Object.entries(interactiveColors)) {
    await record("interactive", id, path.join(root, "tools/imagegen/out/plugins", pluginSources["pl-15"]), false,
      (source, target, width, height) => thumbnail(source, target, width, height, { frame: color, inset: Math.round(26 * 1.5), quality: 78 }));
  }
  for (const id of ["personality", "recharge", "bond", "luck"]) {
    const source = path.join(root, "tools/imagegen/out/goal-20260929", `fun-${id}-v2.jpg`);
    const home = id === "personality";
    const target = home ? path.join(root, "apps/miniprogram/assets/fun-tests", id + ".jpg") : path.join(remoteRoot, "funTests", id + ".jpg");
    fs.mkdirSync(path.dirname(target), { recursive: true });
    await thumbnail(source, target, 960, 960, { quality: 78 });
    const result = await sharp(target).metadata();
    const hash = digest(target);
    const file = home ? target : path.join(path.dirname(target), `${id}-${hash.slice(0, 12)}.jpg`);
    if (!home) fs.renameSync(target, file);
    const key = home ? "" : `samples/miniprogram-effects/v2/funTests/${id}-${hash}.jpg`;
    const url = home ? `/assets/fun-tests/${id}.jpg` : `${staticOrigin}/${key}`;
    manifest.funTests[id] = url;
    (home ? plan.home : plan.remote).push({ group: "funTests", id, file: path.relative(root, file).replace(/\\/g, "/"), key, url,
      width: result.width, height: result.height, oldWidth: 640, oldHeight: 640,
      bytes: fs.statSync(file).size, sha256: hash });
  }
  fs.mkdirSync(stageRoot, { recursive: true });
  fs.writeFileSync(path.join(stageRoot, "plan.json"), JSON.stringify(plan, null, 2) + "\n");
  const homeBytes = plan.home.reduce((total, item) => total + item.bytes, 0);
  const remoteBytes = plan.remote.reduce((total, item) => total + item.bytes, 0);
  console.log(`准备完成：首页 ${plan.home.length} 张 ${(homeBytes / 1024).toFixed(0)} KB，远程 ${plan.remote.length} 张 ${(remoteBytes / 1024).toFixed(0)} KB`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
