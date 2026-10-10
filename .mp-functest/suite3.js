/**
 * 生成链路实测：在运行时里真实上传一张照片，再用它走完整生成。
 */
const L = require("./lib");

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  const token = await L.loginAs(mp, "functest01", "petbaby2026test");

  await r.step("上传：在小程序里真实上传包内样片", async () => {
    // 包内路径运行时读不到（readFile permission denied），
    // 改从 Node 侧读字节、以 base64 写进小程序用户目录，再走真实 uploadFile。
    const fsNode = require("fs");
    const p = require("path");
    const sample = p.join(__dirname, "..", "apps", "miniprogram", "assets", "samples", "scenes", "corgi-sploot.jpg");
    const b64 = fsNode.readFileSync(sample).toString("base64");
    const res = await mp.evaluate(
      (o) =>
        new Promise((resolve) => {
          const fsm = wx.getFileSystemManager();
          const dst = wx.env.USER_DATA_PATH + "/upload-test.jpg";
          fsm.writeFile({
            filePath: dst,
            data: o.b64,
            encoding: "base64",
            success: () => {
              wx.uploadFile({
                url: o.url,
                filePath: dst,
                name: "file",
                formData: { petId: o.petId, filename: "upload-test.jpg", entry: "photos" },
                header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + o.token },
                success: (up) => resolve({ status: up.statusCode, body: String(up.data).slice(0, 400) }),
                fail: (e) => resolve({ fail: e.errMsg }),
              });
            },
            fail: (e) => resolve({ fail: "writeFile: " + e.errMsg }),
          });
        }),
      { b64, url: L.BASE + "/api/uploads", petId: process.env.MP_PETID, token }
    );
    return res;
  });

  await r.step("上传：确认照片入库并可列出", async () => {
    const res = await L.wxRequest(mp, {
      url: L.BASE + "/api/photos?petId=" + process.env.MP_PETID + "&pageSize=50&order=library",
      header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    const items = (res.body && res.body.data && res.body.data.items) || (res.body && res.body.data) || [];
    return { status: res.status, 张数: Array.isArray(items) ? items.length : "?", 首张id: Array.isArray(items) && items[0] ? items[0].id : null };
  });

  await r.step("照片页：渲染刚上传的照片", async () => {
    await mp.reLaunch("/pages/photos/photos?petId=" + process.env.MP_PETID);
    await L.sleep(4000);
    const d = await (await mp.currentPage()).data();
    return { photos: (d.photos || []).length, total: d.totalCount, error: d.error, petId: d.petId };
  });

  await r.step("生成：用免费玩法建任务（含 photoIds）", async () => {
    const photos = await L.wxRequest(mp, {
      url: L.BASE + "/api/photos?petId=" + process.env.MP_PETID + "&pageSize=50&order=library",
      header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    const items = (photos.body && photos.body.data && photos.body.data.items) || (photos.body && photos.body.data) || [];
    if (!Array.isArray(items) || !items.length) return "没有可用照片";
    const gen = await L.wxRequest(mp, {
      url: L.BASE + "/api/generations",
      method: "POST",
      data: { petId: process.env.MP_PETID, pluginId: "pet-id-card", photoIds: [items[0].id], idempotencyKey: "mp-functest-" + Date.now() },
      header: { "content-type": "application/json", "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
    });
    return { status: gen.status, task: JSON.stringify(gen.body).slice(0, 300) };
  });

  await r.step("生成：等任务出结果", async () => {
    for (let i = 0; i < 12; i++) {
      const res = await L.wxRequest(mp, {
        url: L.BASE + "/api/generations",
        header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
      });
      const list = (res.body && res.body.data) || [];
      const t = list[0];
      if (t && ["succeeded", "failed"].indexOf(t.status) >= 0) return { status: t.status, attempt: t.attempt, error: t.error || t.failureReason || null };
      await L.sleep(3000);
    }
    return "12 次轮询仍未终态";
  });

  await r.step("作品柜：看生成结果是否归档", async () => {
    const res = await L.wxRequest(mp, { url: L.BASE + "/api/works", header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token } });
    const works = (res.body && res.body.data) || [];
    return { 作品数: works.length, 首件: works[0] ? { id: works[0].id, title: works[0].title, pluginId: works[0].pluginId } : null };
  });

  await r.step("作品柜：真实点击打开作品卡片", async () => {
    await mp.switchTab("/pages/works/works");
    await L.sleep(4500);
    const page = await mp.currentPage();
    const all = await page.$$("view");
    let card = null;
    for (const v of all) {
      let cls = "";
      try {
        cls = await v.attribute("class");
      } catch (e) {}
      if (cls && /work-card|work-item|work-entry/.test(cls)) {
        card = v;
        break;
      }
    }
    if (!card) {
      const d = await page.data();
      return { 没找到作品卡: true, 作品数: (d.groups || []).reduce((n, g) => n + ((g.items || []).length), 0), 文案: (d.tabs || []) };
    }
    await card.tap();
    await L.sleep(3500);
    const after = await mp.currentPage();
    const wd = await after.data();
    return { 跳到: after.path, workId: wd.work && wd.work.id, error: wd.error, title: wd.work && wd.work.title };
  });

  const sum = r.summary();
  L.writeReport("suite-3.json", sum);
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
