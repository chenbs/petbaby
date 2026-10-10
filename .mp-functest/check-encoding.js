/**
 * 判定中文编码问题：在小程序运行时里用 wx.request 建一只中文名宠物，
 * 走的是和端上完全相同的 HTTP 路径，可区分「curl 传参编码」与「服务端/端上真缺陷」。
 */
const automator = require("miniprogram-automator");
const WS = process.env.MP_WS || "ws://127.0.0.1:9471";
const BASE = "http://192.168.71.144:3300";

(async () => {
  const mp = await automator.connect({ wsEndpoint: WS });

  const call = (opts) =>
    mp.evaluate(
      (o) =>
        new Promise((resolve) => {
          wx.request({
            url: o.url,
            method: o.method,
            data: o.data,
            header: o.header,
            success: (r) => resolve({ status: r.statusCode, body: r.data }),
            fail: (e) => resolve({ fail: e.errMsg }),
          });
        }),
      opts
    );

  const token = await mp.callWxMethod("getStorageSync", "petbaby_session");
  console.log("session token present:", Boolean(token));

  const created = await call({
    url: BASE + "/api/pets",
    method: "POST",
    data: { name: "中文测试猫", species: "cat", gender: "female" },
    header: { "content-type": "application/json", "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
  });
  console.log("创建结果:", JSON.stringify(created).slice(0, 400));

  const listed = await call({
    url: BASE + "/api/pets",
    method: "GET",
    data: {},
    header: { "x-petbaby-client": "miniprogram", authorization: "Bearer " + token },
  });
  const pets = (listed.body && listed.body.data) || [];
  console.log("宠物列表:");
  pets.forEach((p) => console.log("  name=" + JSON.stringify(p.name), "len=" + String(p.name || "").length, "id=" + p.id));

  // 再看首页 data 里拿到的名字
  await mp.reLaunch("/pages/index/index");
  await new Promise((r) => setTimeout(r, 3000));
  const page = await mp.currentPage();
  const d = await page.data();
  console.log("首页 pet.name =", JSON.stringify(d.pet && d.pet.name));
  console.log("首页 pets =", JSON.stringify((d.pets || []).map((p) => p.name)));
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
