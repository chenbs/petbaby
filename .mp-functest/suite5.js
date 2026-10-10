/** 第三批：分享、纪念、视频、钱包档位（按真实字段名）。 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");
  const H = { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" };
  const petsRes = await L.wxRequest(mp, { url: L.BASE + "/api/pets", header: H });
  const pets = (petsRes.body && petsRes.body.data) || [];
  const pet = pets[1] || pets[0];

  // ---------- 钱包档位（真实字段 tiers） ----------
  await r.step("钱包：开面板读取档位字段", async () => {
    await mp.reLaunch("/pages/wallet/wallet");
    await L.sleep(3000);
    await mp.currentPage().then((p) => p.callMethod("openTopup"));
    await L.sleep(2500);
    const d = await (await mp.currentPage()).data();
    const ws = d.walletSheet || {};
    return {
      visible: ws.visible,
      字段: Object.keys(ws),
      first: ws.first && ws.first.id,
      tiers: (ws.tiers || []).map((t) => t.id + ":" + t.units + "颗"),
      plainPack: ws.plainPack && ws.plainPack.id,
      selectedId: ws.selectedId,
    };
  });

  await r.step("钱包：真实点档位卡", async () => {
    const page = await mp.currentPage();
    const d = await page.data();
    const ws = d.walletSheet || {};
    const tiers = ws.tiers || [];
    if (!tiers.length) return "没有档位";
    const pick = tiers[1] || tiers[0];
    const all = await page.$$("view");
    let tapped = false;
    for (const v of all) {
      let id = "";
      try {
        id = await v.attribute("data-id");
      } catch (e) {}
      if (id === pick.id) {
        await v.tap();
        tapped = true;
        break;
      }
    }
    await L.sleep(1200);
    const after = await (await mp.currentPage()).data();
    return { 点了: pick.id, 命中: tapped, selectedId: after.walletSheet && after.walletSheet.selectedId };
  });

  await r.step("钱包：点支付按钮", async () => {
    const page = await mp.currentPage();
    const d = await page.data();
    if (!d.walletSheet || !d.walletSheet.selectedId) return "未选中档位，跳过";
    const before = await L.wxRequest(mp, { url: L.BASE + "/api/wallet", header: H });
    const cards = await page.$$("view");
    let hitPay = false;
    for (const c of cards) {
      let cls = "";
      try {
        cls = await c.attribute("class");
      } catch (e) {}
      let t = "";
      try {
        t = await c.text();
      } catch (e) {}
      if (cls && /ws-btn|pay/.test(cls) && /支付|冻干/.test(String(t))) {
        await c.tap();
        hitPay = true;
        break;
      }
    }
    if (!hitPay) await page.callMethod("pay");
    await L.sleep(14000);
    const after = await L.wxRequest(mp, { url: L.BASE + "/api/wallet", header: H });
    const orders = await L.wxRequest(mp, { url: L.BASE + "/api/payments/orders", header: H });
    return {
      真实点了支付: hitPay,
      余额前: before.body && before.body.data && before.body.data.balance,
      余额后: after.body && after.body.data && after.body.data.balance,
      订单数: ((orders.body && orders.body.data) || []).length,
      订单状态: ((orders.body && orders.body.data) || [])[0] && ((orders.body && orders.body.data) || [])[0].status,
    };
  });

  // ---------- 视频 ----------
  await r.step("视频：打开创建页", async () => {
    await mp.reLaunch("/pages/video-create/video-create?petId=" + pet.id);
    await L.sleep(4500);
    const s = await L.snapshot(mp);
    return { 时长档: s.data.durationOptions || s.data.durations, 模板数: (s.data.templates || s.data.plugins || []).length, error: s.data.error, petId: s.data.petId };
  });

  // ---------- 纪念空间 ----------
  await r.step("纪念：打开纪念页", async () => {
    await mp.reLaunch("/pages/memorials/memorials");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { error: s.data.error, texts: s.texts.slice(0, 8) };
  });

  // ---------- 分享落地页 ----------
  await r.step("分享：无 token 打开的兜底文案", async () => {
    await mp.reLaunch("/pages/share/share");
    await L.sleep(3000);
    const s = await L.snapshot(mp);
    return { error: s.data.error };
  });

  await r.step("分享：真实开分享后访问落地页", async () => {
    const works = await L.wxRequest(mp, { url: L.BASE + "/api/works", header: H });
    const list = (works.body && works.body.data) || [];
    if (!list.length) return "没有作品可分享";
    const share = await L.wxRequest(mp, {
      url: L.BASE + "/api/works/" + list[0].id + "/share",
      method: "POST",
      data: { expiresInHours: 168 },
      header: Object.assign({ "content-type": "application/json" }, H),
    });
    const t = share.body && share.body.data && share.body.data.token;
    if (!t) return "开分享失败: " + JSON.stringify(share.body).slice(0, 200);
    await mp.reLaunch("/pages/share/share?token=" + t);
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { token: t.slice(0, 12) + "...", error: s.data.error, 有作品: Boolean(s.data.work), texts: s.texts.slice(0, 6) };
  });

  // ---------- 我的页 ----------
  await r.step("我的：真实点击各入口", async () => {
    await mp.switchTab("/pages/me/me");
    await L.sleep(3500);
    const page = await mp.currentPage();
    const before = page.path;
    const all = await page.$$("view");
    const clickable = [];
    for (const v of all) {
      let cls = "";
      try {
        cls = await v.attribute("class");
      } catch (e) {}
      if (cls && /entry|row|cell|menu|menu-item/.test(cls)) {
        let t = "";
        try {
          t = await v.text();
        } catch (e) {}
        const s = String(t).replace(/\s+/g, " ").trim();
        if (s && s.length < 30) clickable.push({ cls, s });
      }
    }
    return { 可点入口: clickable.slice(0, 12).map((c) => c.s) };
  });

  const sum = r.summary();
  L.writeReport("suite-5.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
