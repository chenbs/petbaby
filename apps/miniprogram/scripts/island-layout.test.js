/**
 * 触摸命中表与场景几何的测试。
 *
 * 这些是**只有测试能守住的判据**：Canvas 内没有节点，热区尺寸与位置全靠代码算，
 * 而算错的表现是「点不到」或「点了别的东西」—— 两者在开发者工具里都很难发现，
 * 因为鼠标比手指准得多。
 */

const test = require("node:test");
const assert = require("node:assert");

const layout = require("../island/scene/layout");

/** 几种真实机型的窗口尺寸（逻辑像素）。窄屏 → 大屏 */
const VIEWS = [
  { name: "iPhone SE", width: 320, height: 568 },
  { name: "iPhone 8", width: 375, height: 667 },
  { name: "iPhone 14 Pro Max", width: 430, height: 932 },
  { name: "低端安卓 720p", width: 360, height: 780 },
  { name: "平板", width: 768, height: 1024 }
];

const ANCHORS = layout.applyAnchors(null);

test("每个热区都不小于 88 设计单位 —— 22 号文 2.2 的硬要求", () => {
  for (const view of VIEWS) {
    const min = layout.designToPx(view, layout.MIN_HIT);
    for (const camera of ["wide", "close"]) {
      for (const shelter of [false, true]) {
        const zones = layout.buildHitZones(view, ANCHORS, camera, shelter);
        assert.ok(zones.length > 0, `${view.name}/${camera} 没有任何热区`);
        for (const zone of zones) {
          assert.ok(zone.rect.width >= min - 0.01, `${view.name}/${camera} 热区 ${zone.id} 宽 ${zone.rect.width.toFixed(1)} < ${min.toFixed(1)}`);
          assert.ok(zone.rect.height >= min - 0.01, `${view.name}/${camera} 热区 ${zone.id} 高 ${zone.rect.height.toFixed(1)} < ${min.toFixed(1)}`);
        }
      }
    }
  }
});

test("单屏可交互元素 ≤8 —— 超过就不再是留白版式（2.2）", () => {
  for (const view of VIEWS) {
    for (const camera of ["wide", "close"]) {
      const zones = layout.buildHitZones(view, ANCHORS, camera, false);
      assert.ok(zones.length <= 8, `${view.name}/${camera} 有 ${zones.length} 个热区`);
    }
  }
});

test("热区 id 唯一 —— 重名会让 hitTest 永远命中前一个", () => {
  for (const camera of ["wide", "close"]) {
    const zones = layout.buildHitZones(VIEWS[1], ANCHORS, camera, false);
    const ids = zones.map((zone) => zone.id);
    assert.strictEqual(new Set(ids).size, ids.length, `${camera} 档热区 id 重复：${ids.join(",")}`);
  }
});

test("宠物热区排在物件之前 —— 重叠时用户想点的几乎总是宠物", () => {
  const zones = layout.buildHitZones(VIEWS[1], ANCHORS, "wide", false);
  assert.strictEqual(zones[0].kind, "pet");
});

test("近景档只有宠物一个热区 —— 那一档是看表情的，不该有别的可点", () => {
  const zones = layout.buildHitZones(VIEWS[1], ANCHORS, "close", false);
  assert.strictEqual(zones.length, 1);
  assert.strictEqual(zones[0].kind, "pet");
});

test("hitTest 命中矩形内、不命中矩形外；点空地返回 null", () => {
  const view = VIEWS[1];
  const zones = layout.buildHitZones(view, ANCHORS, "wide", false);
  for (const zone of zones) {
    const cx = zone.rect.x + zone.rect.width / 2;
    const cy = zone.rect.y + zone.rect.height / 2;
    assert.ok(layout.hitTest(zones, cx, cy), `${zone.id} 中心点没命中`);
  }
  // 左上角必定是天空（底图顶部 15% 是纯天空且无热区落在那里）
  assert.strictEqual(layout.hitTest(zones, 2, 2), null);
});

test("底图一律底边对齐：草地与物件完整，缺口只落在天空", () => {
  for (const view of VIEWS) {
    const rect = layout.project(view);
    // 底边永远贴着屏幕底 —— 草地与物件落点因此完整
    assert.ok(Math.abs(rect.y + rect.height - view.height) < 0.01, `${view.name} 底边没对齐`);
    // 缺口（skyExtend）等于顶部空出来的高度，且非负
    assert.ok(rect.skyExtend >= 0);
    if (rect.y > 0) assert.ok(Math.abs(rect.skyExtend - rect.y) < 0.01, `${view.name} skyExtend 与实际缺口不符`);
  }
});

test("手机屏上底图不够高，必须有天空延伸 —— 否则顶部是一条空白", () => {
  // 底图 2:3（1.5），手机屏多在 1.7 以上，按宽度铺满后必然差一截
  for (const view of VIEWS.filter((item) => item.height / item.width > 1.5)) {
    const rect = layout.project(view);
    assert.ok(rect.skyExtend > 0, `${view.name} 竟然不需要天空延伸`);
  }
});

test("雨雪档站位切到屋檐下，与晴档不是同一处", () => {
  const view = VIEWS[1];
  const rect = layout.project(view);
  const clear = layout.petRect(view, rect, ANCHORS, "wide", false);
  const shelter = layout.petRect(view, rect, ANCHORS, "wide", true);
  assert.notStrictEqual(clear.x, shelter.x, "躲雨站位与晴档站位相同 —— 那就成了淋雨的宠物");
});

test("近景是同一张立绘放大，不是另一个角度：尺寸更大、比例不变", () => {
  const view = VIEWS[1];
  const rect = layout.project(view);
  const wide = layout.petRect(view, rect, ANCHORS, "wide", false);
  const close = layout.petRect(view, rect, ANCHORS, "close", false);
  assert.ok(close.height > wide.height * 2, "近景没有明显放大");
  // 比例必须一致 —— 变了就说明在拉伸而不是放大裁切
  const wideRatio = wide.width / wide.height;
  const closeRatio = close.width / close.height;
  assert.ok(Math.abs(wideRatio - closeRatio) < 0.001, "两档比例不同，说明在拉伸立绘");
  assert.ok(Math.abs(wideRatio - layout.PET_ASPECT) < 0.001, "立绘比例偏离素材比例");
});

test("近景档立绘的脸落在屏幕中上部，不是正中", () => {
  const view = VIEWS[1];
  const rect = layout.project(view);
  const close = layout.petRect(view, rect, ANCHORS, "close", false);
  // 取景重心（头往下三分之一）应落在屏幕上半
  const focus = close.y + close.height * layout.CLOSE_FOCUS_Y;
  assert.ok(focus < view.height * 0.5, `取景重心在 ${(focus / view.height).toFixed(2)}，应在上半屏`);
});

test("applyAnchors 逐键合并：只给一个键时其余仍用预设", () => {
  const merged = layout.applyAnchors({ grass: { x: 0.9 } });
  assert.strictEqual(merged.grass.x, 0.9);
  // y 必须从预设补上 —— 整体替换会让它变 undefined，画面上物件直接消失
  assert.strictEqual(merged.grass.y, layout.DEFAULT_ANCHORS.grass.y);
  assert.deepStrictEqual(merged.bowl, layout.DEFAULT_ANCHORS.bowl);
  assert.strictEqual(merged.horizonY, layout.DEFAULT_ANCHORS.horizonY);
});

test("applyAnchors 收到 null / 空对象时给出完整预设", () => {
  for (const input of [null, undefined, {}]) {
    const merged = layout.applyAnchors(input);
    for (const key of Object.keys(layout.DEFAULT_ANCHORS)) {
      assert.ok(merged[key] !== undefined, `${key} 缺失`);
    }
  }
});

test("预设锚点都在底图范围内，且宠物站位在地平线以下", () => {
  const inRange = (value) => value >= 0 && value <= 1;
  for (const key of ["petClear", "petShelter", "grass", "bowl", "bed"]) {
    const point = layout.DEFAULT_ANCHORS[key];
    assert.ok(inRange(point.x) && inRange(point.y), `${key} 超出底图范围`);
    // 站位与物件都在地面上：落到地平线以上就是浮在天上
    assert.ok(point.y > layout.DEFAULT_ANCHORS.horizonY, `${key} 落在地平线以上`);
  }
});

test("窗户矩形完整落在底图内，且在地平线以上（窗户在墙上不在地上）", () => {
  const win = layout.DEFAULT_ANCHORS.window;
  assert.ok(win.x >= 0 && win.x + win.w <= 1);
  assert.ok(win.y >= 0 && win.y + win.h <= 1);
  assert.ok(win.y + win.h < layout.DEFAULT_ANCHORS.horizonY + 0.15, "窗户位置偏低，暖光会打在草地上");
});

test("热区随屏幕等比放大：宽屏上的热区不会比窄屏小", () => {
  const narrow = layout.buildHitZones(VIEWS[0], ANCHORS, "wide", false);
  const wide = layout.buildHitZones(VIEWS[4], ANCHORS, "wide", false);
  for (let index = 0; index < narrow.length; index += 1) {
    assert.ok(wide[index].rect.width >= narrow[index].rect.width, `${narrow[index].id} 在宽屏上反而更小`);
  }
});

test("inflate 围绕中心撑开，不改变中心点", () => {
  const view = VIEWS[1];
  const small = { x: 100, y: 100, width: 10, height: 10 };
  const grown = layout.inflate(view, small);
  assert.ok(Math.abs((grown.x + grown.width / 2) - (small.x + small.width / 2)) < 0.01);
  assert.ok(Math.abs((grown.y + grown.height / 2) - (small.y + small.height / 2)) < 0.01);
});

test("inflate 不会缩小已经够大的矩形", () => {
  const view = VIEWS[1];
  const big = { x: 0, y: 0, width: 300, height: 300 };
  const kept = layout.inflate(view, big);
  assert.strictEqual(kept.width, 300);
  assert.strictEqual(kept.height, 300);
});
