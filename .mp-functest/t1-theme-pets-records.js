const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);

  await L.loginAs(mp, "functest01", "petbaby2026test");

  // ---------- 主题切换 ----------
  await r.step("主题页：打开并读取四套皮肤", async () => {
    await mp.reLaunch("/pages/theme/theme");
    await L.sleep(3000);
    const s = await L.snapshot(mp);
    const previews = (s.data.previews || []).map((p) => ({ id: p.id, name: p.name, active: p.active }));
    return { path: s.path, previews, notes: s.notes };
  });

  await r.step("主题页：切换到「星夜影院」并校验全局生效", async () => {
    const before = await L.snapshot(mp);
    const target = (before.data.previews || []).find((p) => p.id !== before.data.themeId) || (before.data.previews || [])[1];
    if (!target) return "没有可选皮肤";
    const res = await L.tapContains(mp, target.name, { tags: ["view"], waitMs: 2500 });
    if (!res.ok) return res.reason;
    const after = await L.snapshot(mp);
    const active = (after.data.previews || []).find((p) => p.active);
    const stored = await mp.callWxMethod("getStorageSync", "petbaby_theme");
    return { 点了: target.name, 使用中: active && active.name, 页面themeId: after.data.themeId, 已持久化: stored };
  });

  await r.step("主题页：切回默认皮肤", async () => {
    const s = await L.snapshot(mp);
    const def = (s.data.previews || []).find((p) => p.id === "pet") || (s.data.previews || [])[0];
    if (!def) return "没有默认皮肤";
    const res = await L.tapContains(mp, def.name, { tags: ["view"], waitMs: 2000 });
    if (!res.ok) return res.reason;
    const after = await L.snapshot(mp);
    const active = (after.data.previews || []).find((p) => p.active);
    return { 使用中: active && active.name };
  });

  // ---------- 宠物档案 ----------
  await r.step("宠物页：打开并渲染档案", async () => {
    await mp.reLaunch("/pages/pets/pets");
    await L.sleep(3000);
    const s = await L.snapshot(mp);
    return { path: s.path, pets: (s.data.pets || []).map((p) => p.name), notes: s.notes, textCount: s.texts.length };
  });

  await r.step("宠物页：点「新建宠物档案」打开表单", async () => {
    const res = await L.tapText(mp, "新建宠物档案", { waitMs: 2000 });
    if (!res.ok) return res.reason;
    const s = await L.snapshot(mp);
    return { showEditor: s.data.showEditor, editing: s.data.editing ? { name: s.data.editing.name, species: s.data.editing.species } : null };
  });

  await r.step("宠物页：填名字 + 选物种 + 保存", async () => {
    const page = await mp.currentPage();
    const inputs = await page.$$("input");
    if (!inputs.length) return "表单无输入框";
    await inputs[0].input("小黑");
    await L.sleep(300);
    const sp = await L.tapText(mp, "狗", { waitMs: 600 });
    const save = await L.tapText(mp, "保存档案", { waitMs: 4000 });
    if (!save.ok) {
      const again = await L.tapContains(mp, "保存", { waitMs: 4000 });
      if (!again.ok) return "找不到保存按钮";
    }
    const s = await L.snapshot(mp);
    return { 点了物种狗: sp.ok, pets: (s.data.pets || []).map((p) => p.name), notes: s.notes };
  });

  await r.step("宠物页：校验新宠物真的入库", async () => {
    const token = await mp.callWxMethod("getStorageSync", "petbaby_session");
    const res = await L.wxRequest(mp, {
      url: L.BASE + "/api/pets",
      header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    const pets = (res.body && res.body.data) || [];
    return { 服务端宠物: pets.map((p) => p.name + "/" + p.species), status: res.status };
  });

  // ---------- 日常记录 ----------
  await r.step("记录页：打开并渲染录入入口", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    return {
      path: s.path,
      pets: (s.data.pets || []).map((p) => p.name),
      kinds: (s.data.kinds || []).map((k) => k.label),
      groups: (s.data.groups || []).map((g) => g.label),
      notes: s.notes,
    };
  });

  await r.step("记录页：点第一个录入类型打开表单", async () => {
    const s = await L.snapshot(mp);
    const kind = (s.data.kinds || [])[0];
    if (!kind) return "没有可录入类型";
    const res = await L.tapContains(mp, kind.label, { tags: ["view"], waitMs: 2000 });
    if (!res.ok) return res.reason + "（类型:" + kind.label + "）";
    const after = await L.snapshot(mp);
    return { 类型: kind.label, 表单打开: Boolean(after.data.form), 字段: after.data.form ? (after.data.form.fields || []).map((f) => f.key) : null };
  });

  await r.step("记录页：填表单并提交", async () => {
    const s = await L.snapshot(mp);
    if (!s.data.form) return "表单未打开，跳过";
    // 勾选第一个可选字段，让表单具备可提交内容
    const fields = (s.data.form.fields || []).filter((f) => f.type === "choice");
    if (fields.length) {
      const first = fields[0];
      const opt = (first.options || [])[0];
      if (opt) await L.tapText(mp, opt.label, { waitMs: 600 });
    }
    const save = await L.tapText(mp, "记下来", { waitMs: 5000 });
    if (!save.ok) return "找不到「记下来」";
    const after = await L.snapshot(mp);
    return { 表单已关闭: !after.data.form, headline: after.data.headline, 提示: after.notes };
  });

  await r.step("记录页：校验记录真的入库", async () => {
    await mp.reLaunch("/pages/records/records");
    await L.sleep(3500);
    const s = await L.snapshot(mp);
    return { headline: s.data.headline, 列表条数: (s.data.days || []).reduce((n, d) => n + ((d.items || []).length), 0), notes: s.notes };
  });

  const sum = r.summary();
  L.writeReport("deep-records.json", sum);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
