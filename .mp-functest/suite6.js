/** 核心创建链路：AI 人化、写真、趣测答题。 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");
  const H = { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" };
  const HR = { "content-type": "application/json", authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" };
  const petsRes = await L.wxRequest(mp, { url: L.BASE + "/api/pets", header: H });
  const pet = ((petsRes.body && petsRes.body.data) || [])[1];

  // ---------- AI 创建页 ----------
  await r.step("AI创建：打开并渲染模板货架", async () => {
    await mp.reLaunch("/pages/ai-create/ai-create");
    await L.sleep(4500);
    const d = await (await mp.currentPage()).data();
    const entries = d.entries || [];
    return {
      petId: d.petId, pets: (d.pets || []).length, photos: (d.photos || []).length,
      入口数: entries.length,
      入口名: entries.map((e) => e.title + "(" + (e.templates || []).length + "款)"),
      stage: d.stage, error: d.error, costText: d.costText,
    };
  });

  await r.step("AI创建：真实点「如果我是人」入口", async () => {
    const page = await mp.currentPage();
    const all = await page.$$("view");
    let hit = null;
    for (const v of all) {
      let cls = "";
      try {
        cls = await v.attribute("class");
      } catch (e) {}
      let t = "";
      try {
        t = await v.text();
      } catch (e) {}
      const s = String(t).replace(/\s+/g, " ").trim();
      if (/entry|card|tab|chip/.test(cls || "") && s === "如果我是人") {
        await v.tap();
        hit = s;
        break;
      }
    }
    await L.sleep(2500);
    const d = await (await mp.currentPage()).data();
    return { 点了: hit, entryId: d.entryId, 模板数: (d.templates || []).length, stage: d.stage };
  });

  await r.step("AI创建：真实点某个效果模板", async () => {
    const page = await mp.currentPage();
    const d0 = await page.data();
    const tid = (d0.templates || [])[0] && d0.templates[0].templateId;
    if (!tid) return "没有模板";
    await page.callMethod("chooseTemplate", { currentTarget: { dataset: { id: tid } } });
    await L.sleep(2500);
    const d = await (await mp.currentPage()).data();
    return { 选中: tid, 当前templateId: d.templateId, stage: d.stage, 预览: d.previewUrl ? "有" : "无", costText: d.costText, activeTitle: d.activeTemplate && d.activeTemplate.title };
  });

  await r.step("AI创建：选宠物照片并提交生成", async () => {
    const page = await mp.currentPage();
    const d0 = await page.data();
    if (!d0.photos || !d0.photos.length) return "该宠物没有照片";
    await page.callMethod("choosePhoto", { currentTarget: { dataset: { id: d0.photos[0].id } } });
    await L.sleep(1200);
    const d1 = await (await mp.currentPage()).data();
    if (d1.ownerPhotoRequired && !d1.ownerPhotoIds.length) {
      return { 需要主人照片: true, ownerPhotos: (d1.ownerPhotos || []).length };
    }
    await page.callMethod("start");
    await L.sleep(6000);
    const after = await mp.currentPage();
    const d = await after.data();
    return { 跳转到: after.path, error: d.error, 选中照片: d1.photoIds };
  });

  // ---------- 趣测 ----------
  await r.step("趣测：打开并真实点第一份测试", async () => {
    await mp.reLaunch("/pages/fun-tests/fun-tests");
    await L.sleep(4000);
    const page = await mp.currentPage();
    const all = await page.$$("view");
    let hit = null;
    for (const v of all) {
      let t = "";
      try {
        t = await v.text();
      } catch (e) {}
      const s = String(t).replace(/\s+/g, " ").trim();
      if (s === "开始测试 →" || s === "开始测试") {
        await v.tap();
        hit = s;
        break;
      }
    }
    await L.sleep(3000);
    const d = await (await mp.currentPage()).data();
    return { 点了: hit, 题目数: (d.questions || []).length, 当前题: d.index, 标题: d.title };
  });

  await r.step("趣测：答完所有题看结果", async () => {
    let lastErr = null;
    for (let i = 0; i < 12; i++) {
      const page = await mp.currentPage();
      const d = await page.data();
      if (d.result) break;
      const opts = d.question && d.question.options ? d.question.options : d.options || [];
      if (!opts.length) {
        lastErr = "第" + i + "题无选项，字段:" + Object.keys(d).join(",");
        break;
      }
      // 真实点第一个选项
      const all = await page.$$("view");
      let tapped = false;
      for (const v of all) {
        let cls = "";
        try {
          cls = await v.attribute("class");
        } catch (e) {}
        let t = "";
        try {
          t = await v.text();
        } catch (e) {}
        if (/option|choice/.test(cls || "") && String(t).trim().startsWith(opts[0].label || opts[0])) {
          await v.tap();
          tapped = true;
          break;
        }
      }
      if (!tapped) {
        await page.callMethod("choose", { currentTarget: { dataset: { index: 0 } } });
      }
      await L.sleep(1200);
    }
    const d = await (await mp.currentPage()).data();
    return { 有结果: Boolean(d.result), 结果标题: d.result && (d.result.title || d.result.name), lastErr };
  });

  // ---------- 写真 ----------
  await r.step("写真：打开写真馆并切换人宠", async () => {
    await mp.reLaunch("/pages/art-photo/art-photo");
    await L.sleep(4500);
    const d0 = await (await mp.currentPage()).data();
    return {
      mode: d0.mode, 单宠场景: (d0.scenes || d0.petScenes || []).length,
      人宠组数: (d0.duoGroups || d0.groups || []).length,
      套餐: (d0.packages || []).length, error: d0.error,
      字段: Object.keys(d0).slice(0, 30),
    };
  });

  const sum = r.summary();
  L.writeReport("suite-6.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
