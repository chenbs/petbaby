/** 针对三个疑点做精确 DOM 诊断。 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");

  async function dump(route, tags) {
    await mp.reLaunch(route);
    await L.sleep(3000);
    const page = await mp.currentPage();
    console.log("\n########## " + route + " ##########");
    for (const tag of tags) {
      const els = await page.$$(tag);
      console.log(`--- <${tag}> ${els.length} 个`);
      for (let i = 0; i < Math.min(els.length, 25); i++) {
        let t = "";
        try {
          t = await els[i].text();
        } catch (e) {
          t = "<err>";
        }
        let cls = "";
        try {
          cls = await els[i].attribute("class");
        } catch (e) {}
        const s = String(t).replace(/\s+/g, " ").trim();
        if (s) console.log(`   [${i}] cls=${cls} :: ${s.slice(0, 70)}`);
      }
    }
  }

  // 1) 宠物页：表单打开后有没有 input
  await dump("/pages/pets/pets", ["t-button", "view"]);
  const page = await mp.currentPage();
  const btns = await page.$$("t-button");
  console.log("\n>>> t-button 原文逐个打印：");
  for (const b of btns) {
    let raw = null;
    try {
      raw = await b.text();
    } catch (e) {
      raw = "<err " + e.message + ">";
    }
    let attr = null;
    try {
      attr = await b.attribute("class");
    } catch (e) {}
    console.log("   ", JSON.stringify(raw), "cls=" + attr);
  }
  console.log(">>> 调用 page.newPet() 后：");
  await page.callMethod("newPet");
  await L.sleep(2000);
  const after = await (await mp.currentPage()).data();
  console.log("   editing:", JSON.stringify(after.editing));
  const inputs2 = await (await mp.currentPage()).$$("input");
  const areas2 = await (await mp.currentPage()).$$("textarea");
  console.log("   input 数:", inputs2.length, " textarea 数:", areas2.length);
  for (let i = 0; i < inputs2.length; i++) {
    let ph = "";
    try {
      ph = await inputs2[i].attribute("placeholder");
    } catch (e) {}
    let cls = "";
    try {
      cls = await inputs2[i].attribute("class");
    } catch (e) {}
    console.log("     input[" + i + "] placeholder=" + JSON.stringify(ph) + " cls=" + cls);
  }

  // 2) 记录页：表单打开后的按钮
  await mp.reLaunch("/pages/records/records");
  await L.sleep(3500);
  const rp = await mp.currentPage();
  const items = await rp.$$(".quick-item");
  for (const it of items) {
    const kind = await it.attribute("data-kind");
    if (kind === "meal") {
      await it.tap();
      break;
    }
  }
  await L.sleep(2500);
  console.log("\n########## /pages/records/records 表单打开后 ##########");
  const rpage = await mp.currentPage();
  const rbtns = await rpage.$$("t-button");
  console.log("--- t-button " + rbtns.length + " 个");
  for (const b of rbtns) {
    let raw = null;
    try {
      raw = await b.text();
    } catch (e) {
      raw = "<err>";
    }
    console.log("   ", JSON.stringify(raw));
  }
  const chips = await rpage.$$(".chip");
  console.log("--- chip " + chips.length + " 个");
  for (let i = 0; i < Math.min(chips.length, 20); i++) {
    let t = "";
    try {
      t = await chips[i].text();
    } catch (e) {}
    const s = String(t).replace(/\s+/g, " ").trim();
    if (s) console.log("   [" + i + "] " + s.slice(0, 50));
  }

  // 3) work 页无参数
  await mp.reLaunch("/pages/index/index");
  await L.sleep(600);
  await mp.navigateTo("/pages/work/work");
  await L.sleep(2500);
  const wp = await mp.currentPage();
  const wd = await wp.data();
  console.log("\n########## /pages/work/work 无参数 ##########");
  console.log("error:", JSON.stringify(wd.error), " work:", wd.work ? "有" : "无");
  const wtexts = await wp.$$("view");
  const shown = [];
  for (const v of wtexts.slice(0, 60)) {
    try {
      const t = (await v.text()) || "";
      const s = t.replace(/\s+/g, " ").trim();
      if (s && s.length < 60) shown.push(s);
    } catch (e) {}
  }
  console.log("可见文案:", JSON.stringify([...new Set(shown)].slice(0, 20)));

  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
