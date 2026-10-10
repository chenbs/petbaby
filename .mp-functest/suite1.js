/**
 * 单次连接跑完的完整功能测试套件。
 *
 * 两条硬约束（都是踩出来的）：
 *  1. 脚本不能放在小程序目录里 —— 会触发开发者工具重编译，编译期间自动化通道超时。
 *  2. 结束用 mp.disconnect() 而不是 mp.close() —— close 会把自动化端口一起关掉；
 *     脚本异常退出留下残留连接则会占住单客户端通道，后续 connect 以 "[object Object]" 失败。
 */
const L = require("./lib");

const ACCOUNT = "functest01";
const PASSWORD = "petbaby2026test";

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  let token = "";

  // ============ 1. 登录 ============
  await r.step("登录：清会话后用账号密码登录", async () => {
    await L.clearSession(mp);
    token = await L.loginAs(mp, ACCOUNT, PASSWORD);
    return { tokenlen: token.length };
  });

  await r.step("登录：会话生效（/api/auth/session）", async () => {
    const res = await L.wxRequest(mp, {
      url: L.BASE + "/api/auth/session",
      header: { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" },
    });
    return { status: res.status, userId: res.body && res.body.data && res.body.data.userId, authenticated: res.body && res.body.data && res.body.data.authenticated };
  });

  // ============ 2. 全页面打开 ============
  const appJson = require("../apps/miniprogram/app.json");
  const tabPages = new Set(appJson.tabBar.list.map((t) => t.pagePath));
  const allPages = [...appJson.pages, ...(((appJson.subPackages || appJson.subpackages) || []).reduce((a, s) => a.concat(s.pages.map((p) => `${s.root}/${p}`)), []))];

  for (const p of allPages) {
    await r.step(`打开 ${p}`, async () => {
      if (tabPages.has(p)) await mp.switchTab("/" + p);
      else {
        await mp.reLaunch("/pages/index/index");
        await L.sleep(700);
        await mp.navigateTo("/" + p);
      }
      await L.sleep(1600);
      const page = await mp.currentPage();
      if (page.path !== p) return `路径不符：${page.path}`;
      const s = await L.snapshot(mp);
      const bad = s.notes.filter((n) => /error=|exception|失败/.test(n) && !/链接无效|链接不完整|缺少必要信息|重新进入|重新选择|重新打开|重新发送|重新分享/.test(n));
      return bad.length ? { 异常状态: bad } : { ok: true, texts: s.texts.length };
    });
  }

  // ============ 3. 主题切换（真实点击预览卡） ============
  await r.step("主题：打开主题页", async () => {
    await mp.reLaunch("/pages/theme/theme");
    await L.sleep(2500);
    const s = await L.snapshot(mp);
    return { current: s.data.themeId, previews: (s.data.previews || []).map((p) => p.name) };
  });

  await r.step("主题：点「手账相册」预览卡", async () => {
    const page = await mp.currentPage();
    const cards = await page.$$(".preview");
    if (!cards.length) return "没有 .preview 卡片";
    const before = await (await mp.currentPage()).data();
    let tapped = null;
    for (const c of cards) {
      const id = await c.attribute("data-id");
      if (id === "film") {
        await c.tap();
        tapped = "film";
        break;
      }
    }
    if (!tapped) return "没找到 data-id=film 的卡";
    await L.sleep(2000);
    const after = await (await mp.currentPage()).data();
    const stored = await mp.callWxMethod("getStorageSync", "petbaby_theme");
    const activeNow = (after.previews || []).find((p) => p.active);
    return {
      点击前: before.themeId,
      点击后themeId: after.themeId,
      使用中: activeNow && activeNow.name,
      已持久化: stored,
      切换成功: before.themeId !== after.themeId,
    };
  });

  await r.step("主题：回到首页确认生效", async () => {
    await mp.switchTab("/pages/index/index");
    await L.sleep(2500);
    const page = await mp.currentPage();
    const d = await page.data();
    return { themeId: d.themeId, skinClass: d.skinClass, navBg: d.navBg };
  });

  await r.step("主题：切回橘子汽水", async () => {
    await mp.reLaunch("/pages/theme/theme");
    await L.sleep(2000);
    const page = await mp.currentPage();
    const cards = await page.$$(".preview");
    for (const c of cards) {
      const id = await c.attribute("data-id");
      if (id === "pet") {
        await c.tap();
        break;
      }
    }
    await L.sleep(1800);
    const after = await (await mp.currentPage()).data();
    return { themeId: after.themeId };
  });

  // ============ 4. 宠物档案 ============
  await r.step("宠物：打开档案页", async () => {
    await mp.reLaunch("/pages/pets/pets");
    await L.sleep(2800);
    const s = await L.snapshot(mp);
    return { pets: (s.data.pets || []).map((p) => p.name), loading: s.data.loading };
  });

  await r.step("宠物：点「新建宠物档案」", async () => {
    const page = await mp.currentPage();
    const btns = await page.$$("t-button");
    let found = false;
    for (const b of btns) {
      let t = "";
      try {
        t = await b.text();
      } catch (e) {}
      if (String(t).trim() === "新建宠物档案") {
        await b.tap();
        found = true;
        break;
      }
    }
    if (!found) {
      // 退化路径：直接调页面方法，确认是定位问题还是功能问题
      await page.callMethod("newPet");
    }
    await L.sleep(1500);
    const after = await (await mp.currentPage()).data();
    return { 按钮文本命中: found, editing: after.editing ? { name: after.editing.name, species: after.editing.species } : null };
  });

  await r.step("宠物：填名字选物种并保存", async () => {
    const page = await mp.currentPage();
    const inputs = await page.$$("input");
    if (!inputs.length) return "表单无输入框（表单未打开？）";
    await inputs[0].input("小黑");
    await L.sleep(400);
    // 点物种「狗」
    const views = await page.$$(".chip");
    let sp = false;
    for (const v of views) {
      let t = "";
      try {
        t = await v.text();
      } catch (e) {}
      if (String(t).trim() === "狗") {
        await v.tap();
        sp = true;
        break;
      }
    }
    await L.sleep(400);
    const btns = await page.$$("t-button");
    let saved = false;
    for (const b of btns) {
      let t = "";
      try {
        t = await b.text();
      } catch (e) {}
      if (String(t).indexOf("保存档案") >= 0) {
        await b.tap();
        saved = true;
        break;
      }
    }
    await L.sleep(3500);
    const after = await (await mp.currentPage()).data();
    return { 选了狗: sp, 点了保存: saved, editing已关闭: !after.editing, message: after.message, error: after.error, pets: (after.pets || []).map((p) => p.name) };
  });

  await r.step("宠物：服务端校验入库结果", async () => {
    const res = await L.wxRequest(mp, {
      url: L.BASE + "/api/pets",
      header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    const pets = (res.body && res.body.data) || [];
    return { pets: pets.map((p) => `${p.name}/${p.species}`) };
  });

  // ============ 5. 日常记录录入 ============
  await r.step("记录：打开录入页", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    return { kinds: (s.data.kinds || []).map((k) => k.label), pets: (s.data.pets || []).map((p) => p.name), headline: s.data.headline };
  });

  await r.step("记录：点「吃饭」打开表单", async () => {
    const page = await mp.currentPage();
    const items = await page.$$(".quick-item");
    if (!items.length) return "没有快捷录入项";
    let hit = false;
    for (const it of items) {
      const kind = await it.attribute("data-kind");
      if (kind === "meal") {
        await it.tap();
        hit = true;
        break;
      }
    }
    if (!hit) await items[0].tap();
    await L.sleep(2000);
    const after = await (await mp.currentPage()).data();
    return { 表单打开: Boolean(after.form), kind: after.form && after.form.kind, fields: after.form ? (after.form.spec && after.form.spec.fields || []).map((f) => f.key) : null };
  });

  await r.step("记录：选选项并提交", async () => {
    const page = await mp.currentPage();
    const d = await page.data();
    if (!d.form) return "表单未打开";
    // 点第一个 choice 组的第一个选项
    const chips = await page.$$(".chip");
    for (const c of chips) {
      let t = "";
      try {
        t = await c.text();
      } catch (e) {}
      if (["吃完了", "差不多", "没怎么吃"].indexOf(String(t).trim()) >= 0) {
        await c.tap();
        await L.sleep(400);
        break;
      }
    }
    const btns = await page.$$("t-button");
    let ok = false;
    for (const b of btns) {
      let t = "";
      try {
        t = await b.text();
      } catch (e) {}
      if (String(t).trim() === "记下来") {
        await b.tap();
        ok = true;
        break;
      }
    }
    if (!ok) return "找不到「记下来」";
    await L.sleep(5000);
    const after = await (await mp.currentPage()).data();
    return { 表单已关闭: !after.form, headline: after.headline, formError: after.formError, afterSave: after.afterSave };
  });

  await r.step("记录：回看列表是否出现该条", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    const days = s.data.days || [];
    const count = days.reduce((n, d) => n + ((d.items || []).length), 0);
    return { 条数: count, headline: s.data.headline, empty: s.data.empty };
  });

  const sum = r.summary();
  L.writeReport("suite-1.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
