/** 诊断：列出页面上所有元素的文本与关键属性，判断点击定位是否正确。 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const route = process.env.MP_ROUTE || "/pages/pets/pets";
  await mp.reLaunch(route);
  await L.sleep(3500);
  const page = await mp.currentPage();
  console.log("path:", page.path);

  for (const tag of ["t-button", "button", "view", "text"]) {
    const els = await page.$$(tag);
    console.log(`\n--- <${tag}> ${els.length} 个 ---`);
    for (let i = 0; i < Math.min(els.length, 30); i++) {
      let t = "";
      let cls = "";
      let id = "";
      try {
        t = await els[i].text();
      } catch (e) {
        t = "<text()失败:" + e.message + ">";
      }
      try {
        cls = await els[i].attribute("class");
      } catch (e) {}
      try {
        id = await els[i].attribute("data-id");
      } catch (e) {}
      const short = String(t).replace(/\s+/g, " ").slice(0, 70);
      if (short) console.log(`  [${i}] cls=${cls} data-id=${id} :: ${short}`);
    }
  }
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
