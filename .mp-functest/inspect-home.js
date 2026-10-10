/**
 * 首页内容核对：登录后检查图片 src 是否可加载、文案是否正常、宠物名片是否渲染。
 */
const fs = require("fs");
const path = require("path");
const automator = require("miniprogram-automator");

const WS = process.env.MP_WS || "ws://127.0.0.1:9451";
const OUT = path.join(__dirname, "out");

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const mp = await automator.connect({ wsEndpoint: WS });
  const errors = [];
  mp.on("console", (m) => {
    const t = (m.args || []).join(" ");
    if (m.type === "error" || /error|fail/i.test(t)) errors.push("console:" + t);
  });
  mp.on("exception", (e) => errors.push("exception:" + (e.message || "")));

  await mp.reLaunch("/pages/index/index");
  await new Promise((r) => setTimeout(r, 4000));

  const page = await mp.currentPage();
  const d = await page.data();

  console.log("path:", page.path);
  console.log("loading:", d.loading, "error:", JSON.stringify(d.error));
  console.log("pet:", d.pet ? JSON.stringify({ name: d.pet.name, id: d.pet.id, lifeStage: d.pet.lifeStage }) : null);
  console.log("petDisplayUrl:", d.petDisplayUrl);
  console.log("pets count:", (d.pets || []).length);
  console.log("plugins:", (d.plugins || []).length, "chips:", JSON.stringify((d.chips || []).map((c) => c.label)));
  console.log("humanCovers:", (d.humanCovers || []).length, "humanTemplateCount:", d.humanTemplateCount);
  console.log("bossTemplates:", (d.bossTemplates || []).length, "bossScenes:", (d.bossScenes || []).length);
  console.log("duoCovers:", (d.duoCovers || []).length, "duoGroupCount:", d.duoGroupCount);
  console.log("studioStrip:", (d.studioStrip || []).length, "artPriceText:", d.artPriceText);
  console.log("feedLeft:", (d.feedLeft || []).length, "feedRight:", (d.feedRight || []).length);
  console.log("care:", JSON.stringify(d.care || null));
  console.log("moment:", JSON.stringify(d.moment || null));

  // 图片可加载性
  const imgs = await page.$$("image");
  const srcs = [];
  for (const im of imgs) {
    try {
      const s = await im.attribute("src");
      if (s) srcs.push(s);
    } catch (e) {}
  }
  console.log("\nimage 元素:", imgs.length, "有 src:", srcs.length);
  const bad = srcs.filter((s) => !/^(https?:\/\/|\/|wxfile|http:\/\/tmp)/.test(s));
  if (bad.length) console.log("异常 src:", bad.slice(0, 5));

  // 首屏可见文案
  const texts = [];
  for (const tag of ["view", "text"]) {
    const els = await page.$$(tag);
    for (const el of els.slice(0, 300)) {
      try {
        const t = (await el.text()) || "";
        if (t.trim()) texts.push(t.trim());
      } catch (e) {}
    }
  }
  const uniq = [...new Set(texts)];
  console.log("\n可见文案 (" + uniq.length + "):");
  console.log(uniq.slice(0, 60).join(" | "));

  fs.writeFileSync(path.join(OUT, "home-inspect.json"), JSON.stringify({ data: { ...d, plugins: undefined, pets: undefined }, srcs, texts: uniq, errors }, null, 2));
  console.log("\nconsole errors:", errors.length);
  errors.slice(0, 8).forEach((e) => console.log(" ", e.slice(0, 200)));
  // 不主动关闭：close 会同时关掉自动化端口
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
