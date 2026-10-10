/**
 * 坏参数扫描：给每个带 query 的页面喂非法/缺失参数，看是否把服务端原始异常直接显示给用户。
 * 判据：页面 error/message 字段里出现英文技术串（UUID/SQL/undefined/Internal）即视为泄漏。
 */
const L = require("./lib");

const CASES = [
  ["/pages/work/work", "作品详情-缺id"],
  ["/pages/work/work?id=not-a-uuid", "作品详情-非uuid"],
  ["/pages/work/work?id=00000000-0000-4000-8000-0000000000ff", "作品详情-合法但不存在"],
  ["/pages/ai-run/ai-run", "生成结果-缺id"],
  ["/pages/ai-run/ai-run?id=abc", "生成结果-非uuid"],
  ["/pages/video/video", "短片-缺id"],
  ["/pages/video/video?id=abc", "短片-非uuid"],
  ["/pages/art-photo-result/art-photo-result", "写真结果-缺id"],
  ["/pages/art-photo-result/art-photo-result?id=abc", "写真结果-非uuid"],
  ["/pages/art-photo-bundle/art-photo-bundle", "写真套餐-缺id"],
  ["/pages/share/share", "分享-缺token"],
  ["/pages/share/share?token=abc", "分享-非法token"],
  ["/pages/memorial-share/memorial-share", "纪念分享-缺token"],
  ["/pages/memorial-share/memorial-share?token=abc", "纪念分享-非法token"],
  ["/pages/timeline/timeline?petId=abc", "时间线-非uuid"],
  ["/pages/photos/photos?petId=abc", "照片库-非uuid"],
  ["/pages/records/records?petId=abc", "记录-非uuid"],
  ["/pages/health/health?petId=abc", "健康-非uuid"],
  ["/pages/video-create/video-create?petId=abc", "视频创建-非uuid"],
  ["/pages/ai-create/ai-create?photoIds=abc", "AI创建-非法photoIds"],
  ["/pages/fun-tests/fun-tests?resultId=abc", "趣测-非uuid结果"],
];

const TECH = /Invalid|UUID|uuid|SQL|undefined|null is not|Internal|ECONNREFUSED|fetch failed|TypeError|Cannot read|\[object/i;

(async () => {
  const mp = await L.connect({});
  const r = L.makeRunner(mp);
  await L.loginAs(mp, "functest01", "petbaby2026test");

  for (const [route, label] of CASES) {
    await r.step(label, async () => {
      await mp.reLaunch("/pages/index/index");
      await L.sleep(500);
      await mp.navigateTo(route);
      await L.sleep(3200);
      const page = await mp.currentPage();
      const d = await page.data();
      const err = d.error || d.message || d.recordError || "";
      // 同时读界面上真实渲染出来的文字，判断用户实际看到了什么
      const texts = [];
      for (const tag of ["view", "text"]) {
        const els = await page.$$(tag);
        for (const el of els.slice(0, 80)) {
          try {
            const t = (await el.text()) || "";
            const s = t.replace(/\s+/g, " ").trim();
            if (s && s.length < 120) texts.push(s);
          } catch (e) {}
        }
      }
      const uniq = [...new Set(texts)];
      const leaking = uniq.filter((t) => TECH.test(t));
      return {
        路径: page.path,
        error字段: err,
        界面上技术串: leaking.slice(0, 3),
        泄漏: TECH.test(String(err)) || leaking.length > 0,
      };
    });
  }

  const sum = r.summary();
  L.writeReport("bad-params.json", sum);
  const leaks = sum.steps.filter((s) => s.detail && s.detail.泄漏);
  console.log("\n=== 泄漏清单 ===");
  leaks.forEach((l) => console.log("  " + l.name + " -> " + JSON.stringify(l.detail)));
  mp.disconnect();
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e && e.stack);
  process.exit(1);
});
