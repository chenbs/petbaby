/**
 * 关键流程重测：自定义组件内部节点 automator 取不到（t-button/t-field 的 $$ 恒为 0），
 * 所以按钮类用 callMethod 驱动（仍走真实的页面逻辑与网络链路），
 * 原生 view 系的可点元素（.chip/.quick-item/.preview/.pet-entry 等）继续用真实点击。
 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");

  // ---------- 宠物档案：完整走一遍新建 ----------
  await r.step("宠物：新建档案（打开→填名→选种类→保存）", async () => {
    await mp.reLaunch("/pages/pets/pets");
    await L.sleep(3000);
    let page = await mp.currentPage();
    await page.callMethod("newPet");
    await L.sleep(1500);
    page = await mp.currentPage();
    // 名字：用页面方法写入（等价于 t-field 的 change 事件）
    await page.callMethod("inputName", { detail: { value: "测试狗子" } });
    await L.sleep(300);
    // 种类「狗狗」：真实点击 chip
    const chips = await page.$$(".chip");
    let sp = false;
    for (const c of chips) {
      let t = "";
      try {
        t = await c.text();
      } catch (e) {}
      if (String(t).trim() === "狗狗") {
        await c.tap();
        sp = true;
        break;
      }
    }
    await L.sleep(500);
    const before = await (await mp.currentPage()).data();
    await page.callMethod("save");
    await L.sleep(4000);
    const after = await (await mp.currentPage()).data();
    return {
      点了狗狗: sp,
      提交前名字: before.editing && before.editing.name,
      提交前种类: before.editing && before.editing.species,
      保存后message: after.message,
      保存后error: after.error,
      编辑器已关: !after.editing,
      列表: (after.pets || []).map((p) => p.name + "/" + p.species),
    };
  });

  await r.step("宠物：服务端确认新档案", async () => {
    const res = await L.wxRequest(mp, { url: L.BASE + "/api/pets", header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token } });
    return { pets: ((res.body && res.body.data) || []).map((p) => `${p.name}/${p.species}/${p.lifeStage}`) };
  });

  // ---------- 日常记录：真实点击类型 + callMethod 提交 ----------
  await r.step("记录：真实点击「吃饭」打开表单", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(3500);
    const page = await mp.currentPage();
    const items = await page.$$(".quick-item");
    if (!items.length) return "没有 .quick-item";
    for (const it of items) {
      const kind = await it.attribute("data-kind");
      if (kind === "meal") {
        await it.tap();
        break;
      }
    }
    await L.sleep(2000);
    const d = await (await mp.currentPage()).data();
    return { 表单打开: Boolean(d.form), kind: d.form && d.form.kind, specFields: d.form && d.form.spec && (d.form.spec.fields || []).map((f) => f.key) };
  });

  await r.step("记录：真实点击「吃完了」选项", async () => {
    const page = await mp.currentPage();
    const chips = await page.$$(".chip");
    let hit = null;
    for (const c of chips) {
      let t = "";
      try {
        t = await c.text();
      } catch (e) {}
      const s = String(t).trim();
      if (s === "吃完了") {
        await c.tap();
        hit = s;
        break;
      }
    }
    await L.sleep(600);
    const d = await (await mp.currentPage()).data();
    return { 点了: hit, values: d.form && d.form.values };
  });

  await r.step("记录：提交「记下来」", async () => {
    const page = await mp.currentPage();
    const d0 = await page.data();
    if (!d0.form) return "表单未打开";
    await page.callMethod("saveForm");
    await L.sleep(6000);
    const d = await (await mp.currentPage()).data();
    return { 表单已关: !d.form, formError: d.formError, afterSave: d.afterSave, urgent: d.urgent, headline: d.headline };
  });

  await r.step("记录：回看列表确认已入库", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(4000);
    const d = await (await mp.currentPage()).data();
    const days = d.days || [];
    return {
      条数: days.reduce((n, x) => n + ((x.items || []).length), 0),
      headline: d.headline,
      empty: d.empty,
      今日条目: (days[0] && (days[0].items || []).map((i) => i.title)) || [],
    };
  });

  // ---------- work 页：无 id 的兜底 ----------
  await r.step("作品详情：无 id 打开（应给友好文案）", async () => {
    await mp.reLaunch("/pages/index/index");
    await L.sleep(800);
    await mp.navigateTo("/pages/work/work");
    await L.sleep(2500);
    const d = await (await mp.currentPage()).data();
    return { 页面error字段: d.error, 是否泄漏原始异常: /Invalid UUID|uuid/i.test(String(d.error)) };
  });

  // ---------- work 页：用真实作品 id ----------
  await r.step("作品详情：造一件作品后用真实 id 打开", async () => {
    // 用免费玩法（宠物身份证 pl-01? 免费证件照）走真实接口建一件
    const plugins = await L.wxRequest(mp, { url: L.BASE + "/api/plugins", header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token } });
    const list = (plugins.body && plugins.body.data) || [];
    const free = list.filter((p) => p.dongan && p.dongan.free).map((p) => p.id);
    const chosen = free.indexOf("pet-id-card") >= 0 ? "pet-id-card" : free[0];
    if (!chosen) return "没有免费玩法可测";
    const pets = await L.wxRequest(mp, { url: L.BASE + "/api/pets", header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token } });
    const pet = ((pets.body && pets.body.data) || [])[0];
    const gen = await L.wxRequest(mp, {
      url: L.BASE + "/api/generations",
      method: "POST",
      data: { petId: pet.id, pluginId: chosen },
      header: { "content-type": "application/json", "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    return { 玩法: chosen, 宠物: pet.name, 建任务: gen.status, body: JSON.stringify(gen.body).slice(0, 200) };
  });

  await r.step("作品柜：真实点击查看作品", async () => {
    await mp.switchTab("/pages/works/works");
    await L.sleep(4000);
    const page = await mp.currentPage();
    const cards = await page.$$(".work-item, .card, .item");
    return { 卡片数: cards.length, path: page.path };
  });

  const sum = r.summary();
  L.writeReport("suite-2.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
