/** 定性实验：t-popup / t-button 这类自定义组件是否真的渲染，automator 能否取到。 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  await L.loginAs(mp, "functest01", "petbaby2026test");

  // 基线：登录页有 t-button（"返回首页"/"退出登录"），且在 wxml 里是顶层节点
  await mp.reLaunch("/pages/login/login");
  await L.sleep(3000);
  let page = await mp.currentPage();
  console.log("=== 登录页（基线，已登录态）===");
  for (const sel of ["t-button", "button", ".btn", "view", "text"]) {
    const els = await page.$$(sel);
    console.log(`  ${sel}: ${els.length}`);
  }
  const loginBtns = await page.$$(".btn");
  for (let i = 0; i < loginBtns.length; i++) {
    let t = "";
    try {
      t = await loginBtns[i].text();
    } catch (e) {}
    console.log(`    .btn[${i}] = ${JSON.stringify(String(t).trim().slice(0, 30))}`);
  }

  // 目标：宠物页的 t-popup（visible=false 时是否存在于 DOM）
  await mp.reLaunch("/pages/pets/pets");
  await L.sleep(3000);
  page = await mp.currentPage();
  console.log("\n=== 宠物页：编辑器关闭时 ===");
  for (const sel of ["t-popup", "t-button", ".btn", ".popup", ".dialog", "input"]) {
    const els = await page.$$(sel);
    console.log(`  ${sel}: ${els.length}`);
  }

  console.log("\n=== 宠物页：调 newPet() 打开编辑器后 ===");
  await page.callMethod("newPet");
  await L.sleep(2000);
  page = await mp.currentPage();
  for (const sel of ["t-popup", "t-button", ".btn", ".popup", ".dialog", "input", "textarea", ".chip", ".field"]) {
    const els = await page.$$(sel);
    console.log(`  ${sel}: ${els.length}`);
  }
  const d = await page.data();
  console.log("  editing:", JSON.stringify(d.editing));

  // 用 xpath 找一下 popup 壳
  const xp = await page.getElementsByXpath("//*[contains(@class,'popup')]");
  console.log("  xpath popup:", xp.length);
  const xpBtn = await page.getElementsByXpath("//*[contains(@class,'btn')]");
  console.log("  xpath btn:", xpBtn.length);
  for (let i = 0; i < Math.min(xpBtn.length, 6); i++) {
    let t = "";
    try {
      t = await xpBtn[i].text();
    } catch (e) {}
    let cls = "";
    try {
      cls = await xpBtn[i].attribute("class");
    } catch (e) {}
    console.log(`    xbtn[${i}] cls=${cls} :: ${JSON.stringify(String(t).trim().slice(0, 30))}`);
  }

  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
