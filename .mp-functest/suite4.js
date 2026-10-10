/**
 * 第二批流程测试：充值、健康分诊、趣测、时间线、订单、实体商品、账号。
 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");
  const petsRes = await L.wxRequest(mp, { url: L.BASE + "/api/pets", header: { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" } });
  const pet = ((petsRes.body && petsRes.body.data) || [])[0];

  // ---------- 钱包 ----------
  await r.step("钱包：打开并读取余额", async () => {
    await mp.reLaunch("/pages/wallet/wallet");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    return { balance: s.data.wallet && s.data.wallet.balance, 名称: s.data.wallet && s.data.wallet.name, error: s.data.error };
  });

  await r.step("钱包：真实点「充值」开面板", async () => {
    await mp.reLaunch("/pages/wallet/wallet");
    await L.sleep(3000);
    const page = await mp.currentPage();
    const btns = await page.$$("t-button");
    let hit = false;
    for (const b of btns) {
      let t = "";
      try {
        t = await b.text();
      } catch (e) {}
      if (String(t).trim() === "充值") {
        await b.tap();
        hit = true;
        break;
      }
    }
    if (!hit) await page.callMethod("openTopup");
    await L.sleep(2500);
    const d = await (await mp.currentPage()).data();
    return { 按钮命中: hit, 面板visible: d.walletSheet && d.walletSheet.visible, 档位: d.walletSheet && d.walletSheet.packages && d.walletSheet.packages.map((p) => p.id) };
  });

  await r.step("钱包：选档并支付（development 直通）", async () => {
    const page = await mp.currentPage();
    const d = await page.data();
    if (!d.walletSheet || !d.walletSheet.visible) return "面板未打开";
    const pkgs = d.walletSheet.packages || [];
    const pick = pkgs.find((p) => p.id === "p6") || pkgs[0];
    if (!pick) return "没有档位";
    // 真实点击档位卡
    const cards = await page.$$("view");
    let tapped = false;
    for (const c of cards) {
      let id = "";
      try {
        id = await c.attribute("data-id");
      } catch (e) {}
      if (id === pick.id) {
        await c.tap();
        tapped = true;
        break;
      }
    }
    if (!tapped) await page.callMethod("choose", { currentTarget: { dataset: { id: pick.id } } });
    await L.sleep(1000);
    const mid = await (await mp.currentPage()).data();
    // 点支付
    await page.callMethod("pay");
    await L.sleep(12000);
    const after = await (await mp.currentPage()).data();
    const balance = await L.wxRequest(mp, { url: L.BASE + "/api/wallet", header: { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" } });
    return { 点了档位: tapped, chosen: pick.id, 支付前选中: mid.walletSheet && mid.walletSheet.selected, 余额: balance.body && balance.body.data && balance.body.data.balance };
  });

  await r.step("订单：打开并核对充值单", async () => {
    await mp.reLaunch("/pages/orders/orders");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    const res = await L.wxRequest(mp, { url: L.BASE + "/api/payments/orders", header: { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" } });
    const orders = (res.body && res.body.data) || [];
    return { 页面error: s.data.error, 页面订单数: (s.data.orders || []).length, 服务端订单数: orders.length, 首单状态: orders[0] && orders[0].status };
  });

  // ---------- 健康分诊 ----------
  await r.step("健康：打开分诊页", async () => {
    await mp.reLaunch("/pages/health/health");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { pets: (s.data.pets || []).map((p) => p.name), symptomChips: s.data.symptomChips, error: s.data.error };
  });

  await r.step("健康：真实点症状 chip", async () => {
    const page = await mp.currentPage();
    const chips = await page.$$(".chip");
    let hit = null;
    for (const c of chips) {
      let t = "";
      try {
        t = await c.text();
      } catch (e) {}
      if (String(t).trim() === "吐了") {
        await c.tap();
        hit = "吐了";
        break;
      }
    }
    await L.sleep(800);
    const d = await (await mp.currentPage()).data();
    return { 点了: hit, description: d.description };
  });

  await r.step("健康：紧急症状直通（不进模型）", async () => {
    const page = await mp.currentPage();
    await page.callMethod("inputDescription", { detail: { value: "尿不出来，一直叫" } });
    await L.sleep(800);
    await page.callMethod("submit");
    await L.sleep(9000);
    const d = await (await mp.currentPage()).data();
    const res = d.result || d.lastSession;
    return {
      有结果: Boolean(d.result),
      紧急: res && (res.urgentLevel || res.urgency || res.level),
      来源: res && res.source,
      结论摘要: res && String(res.summary || "").slice(0, 120),
      免责声明: res && res.disclaimer,
      包含药名: res ? /药|剂量|mg|服用/.test(JSON.stringify(res)) : null,
    };
  });

  await r.step("健康：服务端确认分诊已落库", async () => {
    const res = await L.wxRequest(mp, {
      url: L.BASE + "/api/health/sessions?petId=" + pet.id,
      header: { authorization: "Bearer " + token, "x-petbaby-client": "miniprogram" },
    });
    const list = (res.body && res.body.data) || [];
    return { status: res.status, 会话数: Array.isArray(list) ? list.length : "?", 首条: Array.isArray(list) && list[0] ? { source: list[0].triageSource, urgent: list[0].urgentAreas } : null };
  });

  // ---------- 趣测 ----------
  await r.step("趣测：打开列表", async () => {
    await mp.reLaunch("/pages/fun-tests/fun-tests");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { tests: (s.data.tests || s.data.list || []).length, error: s.data.error, texts: s.texts.slice(0, 8) };
  });

  // ---------- 时间线 ----------
  await r.step("时间线：带 petId 打开", async () => {
    await mp.reLaunch("/pages/timeline/timeline?petId=" + pet.id);
    await L.sleep(4500);
    const s = await L.snapshot(mp);
    return { petId: s.data.petId || s.query.petId, 条目: (s.data.entries || s.data.photos || []).length, error: s.data.error, texts: s.texts.slice(0, 6) };
  });

  await r.step("时间线：不带 petId 打开的兜底", async () => {
    await mp.reLaunch("/pages/timeline/timeline");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { error: s.data.error, message: s.data.message, texts: s.texts.slice(0, 6) };
  });

  // ---------- 实体商品 ----------
  await r.step("实体：打开并检查 SKU 与表单", async () => {
    await mp.reLaunch("/pages/physical/physical");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { price: s.data.priceText, 作品数: (s.data.works || []).length, error: s.data.error, canSubmit: s.data.canSubmit };
  });

  // ---------- 年度报告 ----------
  await r.step("年度报告：打开", async () => {
    await mp.reLaunch("/pages/commerce/commerce");
    await L.sleep(4000);
    const s = await L.snapshot(mp);
    return { 订阅数: (s.data.subscriptions || []).length, 报告数: (s.data.reports || []).length, error: s.data.error, walletCosts: s.data.walletCosts };
  });

  // ---------- 账号 ----------
  await r.step("账号：打开并读取资料", async () => {
    await mp.reLaunch("/pages/account/account");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    return { displayName: s.data.profile && s.data.profile.displayName, accountName: s.data.profile && s.data.profile.accountName, error: s.data.error };
  });

  const sum = r.summary();
  L.writeReport("suite-4.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
