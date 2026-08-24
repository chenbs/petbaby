/**
 * 帧循环与素材缓存的测试。
 *
 * 两个判据只有测试能守住：
 *
 * - **静止即停帧**（22 号文 5.1）：静止后不请求下一帧。漏了这条的表现是「岛开着就烫」，
 *   而开发者工具里看不出来 —— 那里没有电池。
 * - **LRU 必须真删**（5.3）：只写不删的话超配额后 `saveFile` 静默失败，
 *   表现是「素材突然不再更新」，而缓存索引里明明有记录。
 *
 * 小程序 API 用最小替身，只实现被用到的那几个方法。
 */

const test = require("node:test");
const assert = require("node:assert");
const Module = require("node:module");
const path = require("node:path");

/* ------------------------------------------------------------------ *
 * wx 替身。挂全局，因为被测模块直接引用 wx（小程序里它就是全局的）
 *
 * **`global.wx` 是进程级的，而 `node --test` 默认按 CPU 数并发跑文件** ——
 * 同进程内两个文件各自 `installWx()` 会互相覆盖，表现是**单跑全过、合跑随机失败**
 * （实测「雨转雪两档粒子」与「窗户暖光淡入」两例会挂，因为拿到的是别的文件装的替身）。
 *
 * 两道防线都要：
 *   ① `package.json` 的 `test` 脚本加 `--test-concurrency=1`；
 *   ② 每个 `installWx()` 记下前一个替身，测试文件跑完后还原（下面的 after 钩子）。
 *
 * 只做 ① 是把问题掩盖掉 —— 谁把并发调回来就又随机红了，而那种失败最难查。
 * ------------------------------------------------------------------ */

/** 本文件安装替身前的 `global.wx`，跑完后还原，不把污染留给同进程的其他测试文件 */
const originalWx = global.wx;

test.after(() => {
  if (originalWx === undefined) delete global.wx;
  else global.wx = originalWx;
  delete global.__downloadSize;
});

function installWx() {
  const storage = {};
  const savedFiles = {};
  const removed = [];
  let counter = 0;

  global.wx = {
    getStorageSync: (key) => storage[key],
    setStorageSync: (key, value) => { storage[key] = value; },
    getFileSystemManager: () => ({
      accessSync: (filePath) => { if (!savedFiles[filePath]) throw new Error("ENOENT"); },
      saveFile: (options) => {
        counter += 1;
        const savedFilePath = "wxfile://saved-" + counter;
        savedFiles[savedFilePath] = true;
        options.success({ savedFilePath: savedFilePath });
      },
      removeSavedFile: (options) => {
        removed.push(options.filePath);
        delete savedFiles[options.filePath];
      }
    }),
    downloadFile: (options) => {
      const size = global.__downloadSize || 1024;
      options.success({ statusCode: 200, tempFilePath: "wxfile://tmp-" + options.url, totalBytesWritten: size });
    }
  };
  return { storage: storage, savedFiles: savedFiles, removed: removed };
}

/** 每个用例拿一份干净的模块实例：assets.js 内有模块级缓存（inflight / decoded） */
function freshAssets() {
  const target = require.resolve("../island/scene/assets");
  delete require.cache[target];
  return require(target);
}

/* ------------------------------------------------------------------ *
 * 素材缓存
 * ------------------------------------------------------------------ */

test("URL 以 / 开头时判为非法 —— 小程序会当主包内本地文件找，必然裂图", async () => {
  installWx();
  const assets = freshAssets();
  assert.strictEqual(assets.isRemoteUrl("/samples/island/scene.jpg"), false);
  assert.strictEqual(assets.isRemoteUrl("https://cdn.example.com/a.jpg"), true);
  await assert.rejects(() => assets.fetchToLocal("scene", "/samples/island/scene.jpg"), /非法/);
});

test("首次取素材会下载并写入缓存，第二次直接命中不再下载", async () => {
  const env = installWx();
  const assets = freshAssets();
  let downloads = 0;
  const original = global.wx.downloadFile;
  global.wx.downloadFile = (options) => { downloads += 1; original(options); };

  const first = await assets.fetchToLocal("scene", "https://cdn.example.com/scene.jpg");
  assert.ok(first.indexOf("saved-") > 0, "没有落到 saveFile 的路径");
  assert.strictEqual(downloads, 1);

  const second = await assets.fetchToLocal("scene", "https://cdn.example.com/scene.jpg");
  assert.strictEqual(second, first);
  assert.strictEqual(downloads, 1, "命中缓存却又下载了一次");
  assert.strictEqual(assets.inspect().count, 1);
  void env;
});

/*
 * **同一个键换了地址必须重下。**
 *
 * 场景素材的键名带内容哈希（换图必换键），所以只按键命中是安全的；但立绘的键是端上
 * 写死的 `pet-avatar`，而它的地址每次重画都变（键里带 `runId`）。只按键命中的话
 * 用户重画形象后画面永远是旧的那只 —— 杀掉小程序重进也一样（`saveFile` 是持久缓存），
 * 只有系统清缓存或被 LRU 淘汰才会解开。全过程不报错：命中缓存是正常路径。
 */
test("同一个键换了 url 时重新下载 —— 重画形象后画面必须跟着换", async () => {
  const env = installWx();
  const assets = freshAssets();
  let downloads = 0;
  const original = global.wx.downloadFile;
  global.wx.downloadFile = (options) => { downloads += 1; original(options); };

  const first = await assets.fetchToLocal("pet-avatar", "https://cdn.example.com/avatar-run1.png", true);
  assert.strictEqual(downloads, 1);

  // 同键同址：命中，不重下
  await assets.fetchToLocal("pet-avatar", "https://cdn.example.com/avatar-run1.png", true);
  assert.strictEqual(downloads, 1, "同一个地址却又下载了一次");

  // 同键换址（重画形象后 runId 变了）：必须重下，且拿到的是新文件
  const second = await assets.fetchToLocal("pet-avatar", "https://cdn.example.com/avatar-run2.png", true);
  assert.strictEqual(downloads, 2, "换了地址却仍命中旧缓存 —— 用户会一直看到上一版立绘");
  assert.notStrictEqual(second, first, "拿到的还是旧文件路径");
  // 旧条目要被真删，不能两份并存把预算吃掉
  assert.strictEqual(assets.inspect().count, 1);
  assert.ok(env.removed.length >= 1, "旧缓存文件没有被真删");
});

test("LRU 超配额时真删文件 —— 不是只从索引里抹掉", async () => {
  const env = installWx();
  const assets = freshAssets();
  /*
   * 每张 1.5MB，预算 8MB → 第六张（累计 9MB）时必须淘汰掉最久未用的。
   *
   * **单张必须小于 MAX_ENTRY_BYTES（2MB）**，否则会走「超限不进缓存」那条分支，
   * 压根不触发淘汰 —— 这条用例第一次就是这么写错的。
   */
  global.__downloadSize = 1.5 * 1024 * 1024;

  const keys = ["a", "b", "c", "d", "e", "f"];
  for (const key of keys) {
    await assets.fetchToLocal(key, "https://cdn.example.com/" + key + ".jpg");
    // 让 usedAt 拉开距离，LRU 才有确定的顺序
    await new Promise((resolve) => setTimeout(resolve, 2));
  }

  const state = assets.inspect();
  assert.ok(state.bytes <= assets.BUDGET_BYTES, `缓存 ${state.bytes} 超过预算 ${assets.BUDGET_BYTES}`);
  // 关键断言：被淘汰的那个走了 removeSavedFile，文件真的删了
  assert.ok(env.removed.length > 0, "淘汰时没有调用 removeSavedFile —— 那就是只写不删");
  // 最久未用的 a 应该先走，刚写入的 f 必须留着
  assert.ok(state.keys.indexOf("a") < 0, "最久未用的没有被淘汰");
  assert.ok(state.keys.indexOf("f") >= 0, "刚写入的反而被淘汰了");
  delete global.__downloadSize;
});

test("单张超过上限时不进缓存，但本次仍可用 —— 不缓存不等于不能画", async () => {
  installWx();
  const assets = freshAssets();
  global.__downloadSize = 5 * 1024 * 1024;
  const filePath = await assets.fetchToLocal("huge", "https://cdn.example.com/huge.jpg");
  assert.ok(filePath.indexOf("tmp-") > 0, "应退回临时路径");
  assert.strictEqual(assets.inspect().count, 0, "超限的图不该进缓存");
  delete global.__downloadSize;
});

test("缓存文件已被系统清掉时重新下载，不把死路径交给 createImage", async () => {
  const env = installWx();
  const assets = freshAssets();
  const first = await assets.fetchToLocal("scene", "https://cdn.example.com/scene.jpg");
  // 模拟系统在空间紧张时清掉了文件（我们的索引不会收到通知）
  delete env.savedFiles[first];
  let downloads = 0;
  const original = global.wx.downloadFile;
  global.wx.downloadFile = (options) => { downloads += 1; original(options); };
  const second = await assets.fetchToLocal("scene", "https://cdn.example.com/scene.jpg");
  assert.strictEqual(downloads, 1, "文件没了却没有重新下载");
  assert.notStrictEqual(second, first);
});

test("同一张图并发请求只下载一次", async () => {
  installWx();
  const assets = freshAssets();
  let downloads = 0;
  global.wx.downloadFile = (options) => {
    downloads += 1;
    setTimeout(() => options.success({ statusCode: 200, tempFilePath: "wxfile://tmp", totalBytesWritten: 1024 }), 5);
  };
  await Promise.all([
    assets.fetchToLocal("same", "https://cdn.example.com/same.jpg"),
    assets.fetchToLocal("same", "https://cdn.example.com/same.jpg"),
    assets.fetchToLocal("same", "https://cdn.example.com/same.jpg")
  ]);
  assert.strictEqual(downloads, 1, `并发下载了 ${downloads} 次`);
});

test("下载失败时 reject，由调用方走「素材未就绪」路径", async () => {
  installWx();
  const assets = freshAssets();
  global.wx.downloadFile = (options) => options.fail({ errMsg: "request:fail" });
  await assert.rejects(() => assets.fetchToLocal("x", "https://cdn.example.com/x.jpg"));
});

test("preload 逐张独立成败：底图失败不拖垮立绘", async () => {
  installWx();
  const assets = freshAssets();
  global.wx.downloadFile = (options) => {
    if (options.url.indexOf("scene") >= 0) return options.fail({ errMsg: "request:fail" });
    options.success({ statusCode: 200, tempFilePath: "wxfile://tmp-" + options.url, totalBytesWritten: 1024 });
  };
  const canvas = { createImage: () => ({ set src(value) { void value; setTimeout(() => this.onload && this.onload(), 1); } }) };
  const map = await assets.preload(canvas, [
    { key: "scene-yard", url: "https://cdn.example.com/scene.jpg" },
    { key: "pet-avatar", url: "https://cdn.example.com/pet.png" }
  ]);
  assert.ok(!map["scene-yard"], "失败的图不该出现在结果里");
  assert.ok(map["pet-avatar"], "成功的图丢了 —— 立绘是情感主体，必须能单独画出来");
});

test("解码失败时连带删掉缓存条目 —— 否则每次都从同一份坏字节解码", async () => {
  const env = installWx();
  const assets = freshAssets();
  const canvas = { createImage: () => ({ set src(value) { void value; setTimeout(() => this.onerror && this.onerror(), 1); } }) };
  await assert.rejects(() => assets.loadImage(canvas, "bad", "https://cdn.example.com/bad.png"));
  assert.strictEqual(assets.inspect().count, 0, "坏字节仍留在缓存里");
  assert.ok(env.removed.length > 0, "没有真删坏文件");
});

test("clear 真删全部文件", async () => {
  const env = installWx();
  const assets = freshAssets();
  await assets.fetchToLocal("a", "https://cdn.example.com/a.jpg");
  await assets.fetchToLocal("b", "https://cdn.example.com/b.jpg");
  assets.clear();
  assert.strictEqual(assets.inspect().count, 0);
  assert.strictEqual(env.removed.length, 2);
});

/* ------------------------------------------------------------------ *
 * 帧循环
 * ------------------------------------------------------------------ */

/** Canvas 2D 替身：记录 rAF 调用次数，手动驱动帧 */
function fakeCanvas() {
  const pending = [];
  return {
    requestAnimationFrame(callback) { pending.push(callback); return pending.length; },
    cancelAnimationFrame() { pending.length = 0; },
    createImage: () => ({}),
    /** 驱动一帧。返回是否还有排队的帧 */
    tick() {
      const callbacks = pending.slice();
      pending.length = 0;
      for (const callback of callbacks) callback();
      return pending.length > 0;
    },
    pendingCount() { return pending.length; }
  };
}

function fakeContext() {
  const calls = [];
  const stops = [];
  const noop = (name) => function () { calls.push(name); };
  /** 渐变替身：把每个色标记下来，供用例读出 alpha 判断淡入淡出的强弱 */
  function gradient(kind) {
    return {
      addColorStop(offset, color) { stops.push({ kind: kind, offset: offset, color: String(color) }); }
    };
  }
  return {
    calls: calls,
    clearRect: noop("clearRect"),
    fillRect: noop("fillRect"),
    drawImage: noop("drawImage"),
    beginPath: noop("beginPath"),
    arc: noop("arc"),
    fill: noop("fill"),
    stroke: noop("stroke"),
    moveTo: noop("moveTo"),
    lineTo: noop("lineTo"),
    save: noop("save"),
    restore: noop("restore"),
    translate: noop("translate"),
    scale: noop("scale"),
    fillText: noop("fillText"),
    /*
     * 渐变工厂**要记进 calls，且要留下色标**。
     *
     * 窗户暖光与地面反光是纯渐变绘制（没有 arc/stroke），不记的话「暖光画了没有」
     * 无从断言 —— 早先这两个方法没走 noop()，任何基于 createRadialGradient 的计数
     * 都恒为 0，看起来像功能没实现。
     *
     * **色标也要留**：只数「画了几次」证不出淡入 —— 瞬间点亮同样画一次。
     * 判据在不透明度上，所以把 `addColorStop` 的入参收进 `stops`，
     * 由用例读出 alpha 比较两个时刻的强弱。
     */
    stops: stops,
    createLinearGradient: function () { calls.push("createLinearGradient"); return gradient("linear"); },
    createRadialGradient: function () { calls.push("createRadialGradient"); return gradient("radial"); },
    globalAlpha: 1,
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textAlign: "left"
  };
}

function makeRenderer() {
  const target = require.resolve("../island/scene/renderer");
  delete require.cache[target];
  const factory = require(target);
  const canvas = fakeCanvas();
  const context = fakeContext();
  const renderer = factory.createRenderer({
    canvas: canvas,
    context: context,
    view: { width: 375, height: 667, dpr: 2 }
  });
  return { renderer: renderer, canvas: canvas, context: context, factory: factory };
}

test("晴天档静止后停帧 —— 「静止即停帧」是硬约束", async () => {
  installWx();
  const harness = makeRenderer();
  // 晴昼：无粒子
  harness.renderer.setAmbient({ phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 });
  // 近景档没有待机动画（那一档宠物占满画面，纵向位移会读作抖动）
  harness.renderer.setCamera("close");
  /*
   * **必须等真实时间过去**，不能靠空转 tick：渲染器的计时一律取 `Date.now()`
   * （刻意不用 rAF 时间戳，见 renderer.js 的 frame 注释），而 tick 只是驱动回调、
   * 不推进时钟。镜头过渡 420ms，等 600ms 有余量。
   */
  const deadline = Date.now() + 600;
  while (Date.now() < deadline) {
    harness.canvas.tick();
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  harness.canvas.tick();
  assert.strictEqual(harness.canvas.pendingCount(), 0, "静止后仍在排帧 —— 岛开着就会烫");
});

test("雨雪档持续跑帧 —— 天气是唯一持续动画的图层，停帧在此不成立", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient({
    phase: "day", weather: "rain",
    overlays: [{ color: "#8C93A0", opacity: 0.3 }],
    particles: { kind: "rain", count: 120, degradedCount: 40 },
    windowGlow: false, shelter: true, nextSegmentHour: 13
  });
  for (let index = 0; index < 50; index += 1) harness.canvas.tick();
  assert.ok(harness.canvas.pendingCount() > 0, "雨档竟然停帧了");
});

test("全景档待机动画持续跑（呼吸与浮动），近景档不跑", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient({ phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 });
  for (let index = 0; index < 50; index += 1) harness.canvas.tick();
  assert.ok(harness.canvas.pendingCount() > 0, "全景档应持续跑待机动画");
});

test("setIdle(false) 后停帧 —— 页面不可见时不该继续耗电", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient({
    phase: "night", weather: "snow",
    overlays: [{ color: "#3D4470", opacity: 0.55 }],
    particles: { kind: "snow", count: 80, degradedCount: 40 },
    windowGlow: true, shelter: true, nextSegmentHour: 5
  });
  for (let index = 0; index < 5; index += 1) harness.canvas.tick();
  assert.ok(harness.canvas.pendingCount() > 0, "雪档应在跑帧");
  harness.renderer.setIdle(false);
  for (let index = 0; index < 5; index += 1) harness.canvas.tick();
  assert.strictEqual(harness.canvas.pendingCount(), 0, "onHide 后仍在跑帧");
});

test("帧率上限 30fps：MIN_FRAME_MS 不低于 33ms", () => {
  installWx();
  const harness = makeRenderer();
  assert.ok(harness.factory.MIN_FRAME_MS >= 1000 / 30 - 0.001, `MIN_FRAME_MS = ${harness.factory.MIN_FRAME_MS}`);
});

test("同档位重复 setAmbient 不重启过渡 —— 每分钟轮询不该让画面永远在淡入", () => {
  installWx();
  const harness = makeRenderer();
  const env = { phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 };
  harness.renderer.setAmbient(env);
  harness.canvas.tick();
  const before = harness.context.calls.length;
  // 同档位再设 10 次
  for (let index = 0; index < 10; index += 1) harness.renderer.setAmbient({ phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 });
  harness.canvas.tick();
  const after = harness.context.calls.length;
  // 只应多出一帧的绘制量，而不是十一帧
  assert.ok(after - before < (before || 20) * 3, "同档位重复设置引发了额外重绘");
});

test("镜头切换在两档之间来回，getCamera 如实反映", () => {
  installWx();
  const harness = makeRenderer();
  assert.strictEqual(harness.renderer.getCamera(), "wide");
  harness.renderer.setCamera("close");
  assert.strictEqual(harness.renderer.getCamera(), "close");
  harness.renderer.setCamera("wide");
  assert.strictEqual(harness.renderer.getCamera(), "wide");
  // 非法值按 wide 处理，不抛异常
  harness.renderer.setCamera("weird");
  assert.strictEqual(harness.renderer.getCamera(), "wide");
});

/* ------------------------------------------------------------------ *
 * 跨段过渡：粒子与两处光效也要跟着淡，不能瞬间切
 * ------------------------------------------------------------------ */

const RAIN_ENV = {
  phase: "day", weather: "rain",
  overlays: [{ color: "#8C93A0", opacity: 0.3 }],
  particles: { kind: "rain", count: 120, degradedCount: 40 },
  windowGlow: false, shelter: true, nextSegmentHour: 13
};

const CLEAR_ENV = {
  phase: "day", weather: "clear",
  overlays: [], particles: null,
  windowGlow: false, shelter: false, nextSegmentHour: 17
};

/**
 * 数一帧里各类绘制调用的次数。
 *
 * **没有素材时 `arc` 只可能来自雪花粒子**（`paintGroundShadow` 要有 image 才画，
 * `paintCloseBackdrop` 用的是渐变矩形）—— 所以 arc/stroke 的计数足以区分两种粒子层。
 */
function countCalls(harness, now) {
  harness.context.calls.length = 0;
  harness.renderer.paintOnce(now);
  const tally = {};
  for (const name of harness.context.calls) tally[name] = (tally[name] || 0) + 1;
  return tally;
}

/**
 * 过渡进行到一半的时刻。
 *
 * **必须取中途而不是切档那一瞬**：`fade` 在 `now === fadeStart` 时恰好是 0，
 * 于是淡入档的系数也是 0 —— 那是正确行为（新档从全透明开始），但用它断言
 * 「新档画了」会永远失败。时钟一律 `Date.now()`（渲染器刻意不用 rAF 时间戳），
 * 所以给 `paintOnce` 一个未来时刻即可，不必真的等 1.2 秒。
 */
function midFade(harness) {
  return Date.now() + harness.factory.AMBIENT_FADE_MS / 2;
}

test("雨停时雨丝跟着过渡淡出，不是整片凭空消失", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(RAIN_ENV);
  assert.ok(countCalls(harness, Date.now()).stroke > 0, "雨档本身没画雨丝");

  // 切到晴档：新档没有粒子，但旧档的雨丝要在过渡期间继续画
  harness.renderer.setAmbient(CLEAR_ENV);
  assert.ok(countCalls(harness, midFade(harness)).stroke > 0, "切档那一刻雨丝就没了 —— 天空还在转亮，雨却已经停干净");
});

test("过渡结束后旧档粒子不再画 —— 淡出不能变成常驻", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(RAIN_ENV);
  harness.renderer.setAmbient(CLEAR_ENV);
  /*
   * 时钟一律 `Date.now()`（渲染器刻意不用 rAF 时间戳），所以这里给 paintOnce 一个
   * 未来时刻即可跨过 2.4 秒，不必真的等。
   */
  const after = Date.now() + harness.factory.AMBIENT_FADE_MS + 100;
  assert.strictEqual(countCalls(harness, after).stroke, undefined, "过渡早该结束了，雨丝还在画");
});

test("雨转雪时两档粒子同时在场，各自淡入淡出", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(RAIN_ENV);
  harness.renderer.setAmbient({
    phase: "day", weather: "snow",
    overlays: [{ color: "#E8EAF2", opacity: 0.35 }],
    particles: { kind: "snow", count: 80, degradedCount: 40 },
    windowGlow: false, shelter: true, nextSegmentHour: 17
  });
  const tally = countCalls(harness, midFade(harness));
  assert.ok(tally.stroke > 0, "淡出中的雨丝没画");
  assert.ok(tally.arc > 0, "淡入中的雪花没画");
});

test("降级机型不画淡出的旧档粒子 —— 峰值 40+40 会抹掉降级省下的那一半", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setDegraded(true);
  harness.renderer.setAmbient(RAIN_ENV);
  assert.ok(countCalls(harness, Date.now()).stroke > 0, "降级档也该画雨（只是粒子更少）");
  harness.renderer.setAmbient(CLEAR_ENV);
  assert.strictEqual(countCalls(harness, midFade(harness)).stroke, undefined, "降级机型在过渡期间多画了一层粒子");
});

test("切到降级时丢掉正在淡出的旧档粒子", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(RAIN_ENV);
  harness.renderer.setAmbient(CLEAR_ENV);
  harness.renderer.setDegraded(true);
  assert.strictEqual(countCalls(harness, midFade(harness)).stroke, undefined, "降级后仍在画淡出的旧粒子");
});

test("同档位重复设置不清掉淡出中的粒子 —— 每分钟轮询不该打断过渡", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(RAIN_ENV);
  harness.renderer.setAmbient(CLEAR_ENV);
  // 同档位再设一次（轮询的常态），过渡应当照常进行
  harness.renderer.setAmbient(CLEAR_ENV);
  assert.ok(countCalls(harness, midFade(harness)).stroke > 0, "轮询把正在淡出的雨丝抹掉了");
});

const DAY_ENV = { phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 17 };
const DUSK_ENV = { phase: "dusk", weather: "clear", overlays: [{ color: "#E8905A", opacity: 0.32 }], particles: null, windowGlow: true, shelter: false, nextSegmentHour: 21 };
const NIGHT_ENV = { phase: "night", weather: "clear", overlays: [{ color: "#3D4470", opacity: 0.55 }], particles: null, windowGlow: true, shelter: false, nextSegmentHour: 5 };

/**
 * 画一帧，返回暖光渐变**中心色标**的不透明度（没画则 null）。
 *
 * 只数 `createRadialGradient` 的次数证不出淡入 —— 瞬间点亮同样画一次。
 * 判据必须落在 alpha 上，所以读色标。中心色标是 offset 0 的那个（边缘恒为全透明）。
 */
function glowAlpha(harness, now) {
  harness.context.stops.length = 0;
  harness.renderer.paintOnce(now);
  const center = harness.context.stops.filter((stop) => stop.kind === "radial" && stop.offset === 0);
  if (!center.length) return null;
  const match = center[center.length - 1].color.match(/rgba?\([^,]+,[^,]+,[^,]+,\s*([0-9.]+)\)/);
  return match ? parseFloat(match[1]) : null;
}

test("窗户暖光跨档淡入，不是瞬间点亮", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(DAY_ENV);
  assert.strictEqual(glowAlpha(harness, Date.now()), null, "昼档不该有窗户暖光");

  harness.renderer.setAmbient(DUSK_ENV);
  const early = glowAlpha(harness, Date.now() + harness.factory.AMBIENT_FADE_MS * 0.25);
  const late = glowAlpha(harness, Date.now() + harness.factory.AMBIENT_FADE_MS * 0.75);
  assert.ok(early !== null && late !== null, "暮档的窗户暖光没画");
  // 灯要逐渐亮起来：过渡后段必须比前段强，否则就是瞬间点亮
  assert.ok(late > early, `暖光没有淡入：25% 处 ${early}、75% 处 ${late}`);
});

test("暖光淡入到满档后不再变化 —— 过渡结束就该稳定", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(DAY_ENV);
  harness.renderer.setAmbient(DUSK_ENV);
  const settled = glowAlpha(harness, Date.now() + harness.factory.AMBIENT_FADE_MS + 200);
  assert.ok(Math.abs(settled - 0.55) < 0.001, `过渡结束后暖光应为 WINDOW_GLOW.opacity(0.55)，实际 ${settled}`);
});

test("暮转夜时暖光不中途暗一下 —— 两档都有暖光，权重相加仍是满档", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient(DUSK_ENV);
  harness.renderer.setAmbient(NIGHT_ENV);
  /*
   * 只按 `current` 算的实现会在过渡中途只给 fade 倍（中点掉到 0.275），
   * 表现是「暮转夜时屋里的灯闪了一下」。两档权重相加后恒为满档。
   */
  const mid = glowAlpha(harness, midFade(harness));
  assert.ok(Math.abs(mid - 0.55) < 0.001, `暮转夜的中途暖光掉到了 ${mid}，应恒为 0.55`);
});

test("setImages 逐键合并：底图后到时不冲掉已加载的立绘", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setImages({ "pet-avatar": { tag: "pet" } });
  harness.renderer.setImages({ "scene-yard": { tag: "scene" } });
  // 两张都在的话这一帧会有两次 drawImage（立绘 + 底图）
  harness.context.calls.length = 0;
  harness.renderer.paintOnce(Date.now());
  const draws = harness.context.calls.filter((name) => name === "drawImage").length;
  assert.ok(draws >= 2, `只画了 ${draws} 次 drawImage —— 说明有一张被冲掉了`);
});

test("素材全缺时仍能画出一帧（纯色底），不抛异常", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient({ phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 });
  harness.context.calls.length = 0;
  assert.doesNotThrow(() => harness.renderer.paintOnce(Date.now()));
  // 纯色底走 fillRect（天空 + 草地两段），不走 drawImage
  assert.ok(harness.context.calls.indexOf("fillRect") >= 0, "没有画纯色底");
  assert.strictEqual(harness.context.calls.indexOf("drawImage"), -1, "没有素材却调了 drawImage");
});

test("情绪粒子会在存活期后自行消失，不无限累积", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.setAmbient({ phase: "day", weather: "clear", overlays: [], particles: null, windowGlow: false, shelter: false, nextSegmentHour: 13 });
  harness.renderer.emote("love", 4);
  harness.renderer.paintOnce(Date.now());
  const during = harness.context.calls.filter((name) => name === "fillText").length;
  assert.ok(during > 0, "情绪粒子没画出来");
  harness.context.calls.length = 0;
  // 跳到存活期之后
  harness.renderer.paintOnce(Date.now() + 5000);
  assert.strictEqual(harness.context.calls.filter((name) => name === "fillText").length, 0, "粒子没有消失");
});

test("emote 数量有上界，避免连点堆出上百个粒子", () => {
  installWx();
  const harness = makeRenderer();
  harness.renderer.emote("love", 999);
  harness.renderer.paintOnce(Date.now());
  const drawn = harness.context.calls.filter((name) => name === "fillText").length;
  assert.ok(drawn <= 6, `一次 emote 画了 ${drawn} 个粒子`);
});

test("模块路径解析正常（防止用例里的 require 写错却静默跳过）", () => {
  assert.ok(Module, "node:module 不可用");
  assert.ok(path.isAbsolute(require.resolve("../island/scene/renderer")));
});
