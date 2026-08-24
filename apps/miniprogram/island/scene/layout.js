/**
 * 场景几何：底图投影、两档镜头、触摸命中表。
 *
 * **Canvas 内没有节点，所以热区必须自己维护**（22 号文 5.1）。这是本文件存在的理由：
 * 一张图上哪里可点、点了算哪个，全靠这张表，没有任何浏览器/框架帮忙。
 *
 * 坐标一律用**底图归一化坐标**（0..1，相对底图本身而非屏幕），再由 `project()`
 * 换算到屏幕像素。理由是热区要跟着画面里的物件走：底图按 cover 铺满时不同机型
 * 裁掉的边不一样，写死屏幕坐标会让草丛在窄屏上落到屋子里去。
 *
 * **最小热区 88 设计单位**（= 750 宽设计坐标下的 88rpx，与 `app.wxss` 的 `.hit-area`
 * 同一口径，也是 22 号文 2.2 的取值）。Canvas 里没有 rpx 概念，所以判据在设计坐标系
 * 里成立、再随屏幕宽度等比放大 —— 换算成物理像素后只会更大不会更小。
 * `scripts/island-layout.test.js` 逐个热区钉住这条。
 */

const ambient = require("./ambient");

/** 底图原始尺寸（24 号文 7.4：`scene-yard.jpg` 1200×1800，2:3） */
const SCENE_WIDTH = 1200;
const SCENE_HEIGHT = 1800;

/** 设计坐标系宽度，与小程序 rpx 一致 */
const DESIGN_WIDTH = 750;

/** 最小热区边长（设计单位）。低于这个值的热区由 `inflate()` 自动撑开 */
const MIN_HIT = 88;

/**
 * 底图上的三组关键坐标（24 号文 7.3）。
 *
 * **与底图强耦合：换底图必须重量。** 当前取值是按 2.1 的构图约束推的预设值
 * （中左侧空草地作站位、右侧屋墙带一扇窗、顶部 15% 纯天空），素材定稿后由
 * `island/assets.ts` 下发覆盖 —— `applyAnchors()` 就是那个覆盖入口。
 * 服务端下发缺失时用这里的预设，首屏不至于因为少一组坐标而画不出来。
 */
const DEFAULT_ANCHORS = {
  /** 晴档站位：中左侧空草地。x/y 是宠物**脚底中心** */
  petClear: { x: 0.38, y: 0.74 },
  /** 雨雪档站位：屋檐下（2.5.2「一起躲雨」而不是「淋雨的宠物」） */
  petShelter: { x: 0.72, y: 0.68 },
  /** 窗户矩形：夜间暖光径向渐变的绘制位置 */
  window: { x: 0.70, y: 0.42, w: 0.13, h: 0.11 },
  /** 地平线：天空向上延伸的接缝位置，也是物件层级排序基线 */
  horizonY: 0.46,
  /** 可交互物件的落点 */
  grass: { x: 0.20, y: 0.80 },
  bowl: { x: 0.56, y: 0.84 },
  bed: { x: 0.80, y: 0.80 }
};

/** 物件在底图上的绘制宽度（归一化）。高度按素材比例 1:1 推算 */
const PROP_SIZE = { grass: 0.16, bowl: 0.14, bed: 0.18 };

/** 立绘绘制高度（归一化于底图高）。近景档另有放大系数 */
const PET_HEIGHT = { wide: 0.30, close: 0.86 };

/** 立绘原始比例（24 号文 7.4：`pet-sample.png` 1200×1600，3:4） */
const PET_ASPECT = 1200 / 1600;

/**
 * 近景放大后的取景重心。
 *
 * **近景是「同一张图放大」，不是另一个角度**（22 号文 2.4 更正）：运行时只生成一张
 * 三分之四侧身立绘，程序无法把它转成正脸。所以近景 = 裁掉下半身 + 放大 + 背景虚化。
 * 取值 0.34 是「头顶往下三分之一」，让脸落在屏幕中上部而不是正中 —— 正中会把
 * 下颌以下也塞进画面，脸反而变小。
 */
const CLOSE_FOCUS_Y = 0.34;

/**
 * 底图投影：底图按屏幕宽度铺满，返回绘制矩形。
 *
 * **一律底边对齐，不居中、不拉伸。** 底图 2:3（1.5）比手机屏（多在 1.78 上下）矮，
 * 按宽度铺满后垂直方向通常还差一截。三种对齐方式里只有底边对齐是对的：
 *
 * - 居中 → 上下各缺一半，底边那半是草地与物件落点，补不出来；
 * - 顶边对齐 → 缺口落在屏幕底部，同样是草地；
 * - **底边对齐 → 草地与全部物件完整，缺口落在顶部天空**，而天空本就是渐变色，
 *   用代码渐变向上延伸接缝看不出来（24 号文：底图上边缘 15% 要求是纯净天空，
 *   正是为这一步留的）。
 *
 * 反过来底图比屏幕高时（宽屏平板）多出来的也从顶部裁，裁掉的还是天空。
 * 两个方向都只动天空，是同一条判断的两面，所以不分支。
 */
function project(view) {
  const width = view.width;
  const height = view.height;
  const scale = width / SCENE_WIDTH;
  const drawHeight = SCENE_HEIGHT * scale;
  const top = height - drawHeight;
  return {
    x: 0,
    y: top,
    width: width,
    height: drawHeight,
    scale: scale,
    /** 顶部要用渐变补的高度。底图不够高时为正，够高时为 0（那种情况是裁而不是补） */
    skyExtend: top > 0 ? top : 0
  };
}

/**
 * 归一化坐标 → 屏幕像素。`rect` 是 `project()` 的结果。
 */
function toScreen(rect, point) {
  return { x: rect.x + point.x * rect.width, y: rect.y + point.y * rect.height };
}

/**
 * 设计单位 → 屏幕像素。
 * 屏幕越宽同一个设计值换算出的像素越多，所以 88 设计单位在任何机型上都 ≥88rpx 的观感尺寸。
 */
function designToPx(view, value) {
  return value * view.width / DESIGN_WIDTH;
}

/**
 * 把矩形撑到最小热区尺寸（围绕中心撑开）。
 *
 * 撑开而不是报错：草丛的**视觉**尺寸由美术决定，不该为了可点而画大；
 * 可点区域比图形大一圈是对的，用户点到草叶边上也算点中。
 */
function inflate(view, rect) {
  const min = designToPx(view, MIN_HIT);
  const width = Math.max(rect.width, min);
  const height = Math.max(rect.height, min);
  return {
    x: rect.x - (width - rect.width) / 2,
    y: rect.y - (height - rect.height) / 2,
    width: width,
    height: height
  };
}

/** 物件的屏幕矩形。锚点是**底边中心**（物件立在地上） */
function propRect(view, rect, anchor, sizeRatio) {
  const center = toScreen(rect, anchor);
  const size = sizeRatio * rect.width;
  return { x: center.x - size / 2, y: center.y - size, width: size, height: size };
}

/**
 * 立绘的屏幕矩形。锚点是**脚底中心**，与 `DEFAULT_ANCHORS.pet*` 的语义一致。
 *
 * 近景档不吃站位坐标：那一档整只宠物就是画面，站在院子哪里已无意义。
 */
function petRect(view, rect, anchors, camera, isShelter) {
  if (camera === "close") {
    const height = view.height * PET_HEIGHT.close;
    const width = height * PET_ASPECT;
    return {
      x: view.width / 2 - width / 2,
      y: view.height * CLOSE_FOCUS_Y - height * CLOSE_FOCUS_Y,
      width: width,
      height: height
    };
  }
  const anchor = isShelter ? anchors.petShelter : anchors.petClear;
  const foot = toScreen(rect, anchor);
  const height = rect.height * PET_HEIGHT.wide;
  const width = height * PET_ASPECT;
  return { x: foot.x - width / 2, y: foot.y - height, width: width, height: height };
}

/**
 * 构建当前视图下的完整命中表。
 *
 * **单屏可交互元素 ≤8**（22 号文 2.2）：全景档 4 个（宠物 / 草丛 / 食盆 / 窝），
 * 近景档 1 个（宠物本体，点它退回全景）。远低于上限，留白因此成立。
 *
 * 顺序即命中优先级 —— 前面的先判，所以宠物排在物件之前：立绘与食盆有重叠时
 * 用户想点的几乎总是宠物。
 */
function buildHitZones(view, anchors, camera, isShelter) {
  const rect = project(view);
  const pet = petRect(view, rect, anchors, camera, isShelter);
  if (camera === "close") {
    return [{ id: "pet", kind: "pet", rect: inflate(view, pet) }];
  }
  return [
    { id: "pet", kind: "pet", rect: inflate(view, pet) },
    { id: "grass", kind: "gather", rect: inflate(view, propRect(view, rect, anchors.grass, PROP_SIZE.grass)) },
    { id: "bowl", kind: "feed", rect: inflate(view, propRect(view, rect, anchors.bowl, PROP_SIZE.bowl)) },
    { id: "bed", kind: "rest", rect: inflate(view, propRect(view, rect, anchors.bed, PROP_SIZE.bed)) }
  ];
}

function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** 命中判定。返回最先命中的热区，没命中返回 null（点空地不该有任何反应） */
function hitTest(zones, x, y) {
  for (const zone of zones) if (contains(zone.rect, x, y)) return zone;
  return null;
}

/**
 * 合并服务端下发的坐标。
 *
 * 逐键合并而不是整体替换：服务端只量了其中几组时，其余仍用预设 ——
 * 整体替换会因为少一个键让站位变成 undefined，画面上宠物直接消失。
 * 这与「老库回填逐键合并」是同一个判断（CLAUDE.md）。
 */
function applyAnchors(overrides) {
  const merged = {};
  for (const key of Object.keys(DEFAULT_ANCHORS)) {
    const value = overrides && overrides[key];
    merged[key] = value && typeof value === "object" ? Object.assign({}, DEFAULT_ANCHORS[key], value) : (typeof value === "number" ? value : DEFAULT_ANCHORS[key]);
  }
  return merged;
}

/**
 * 天空延伸渐变的两个色标。
 *
 * 底图顶边那一条天空的色值我们并不知道（素材未定稿），所以取调色板的 `sky`
 * 作上端、透明作下端，靠 20% 的重叠区把接缝糊掉。素材到位后若发现接缝可见，
 * 修正点是量出底图顶边实际色值写进 anchors，而不是加不透明的色块盖住。
 */
function skyGradientStops() {
  return [
    { offset: 0, color: ambient.ISLAND_PALETTE.sky },
    { offset: 1, color: ambient.toRgba(ambient.ISLAND_PALETTE.sky, 0) }
  ];
}

module.exports = {
  SCENE_WIDTH: SCENE_WIDTH,
  SCENE_HEIGHT: SCENE_HEIGHT,
  DESIGN_WIDTH: DESIGN_WIDTH,
  MIN_HIT: MIN_HIT,
  DEFAULT_ANCHORS: DEFAULT_ANCHORS,
  PROP_SIZE: PROP_SIZE,
  PET_HEIGHT: PET_HEIGHT,
  PET_ASPECT: PET_ASPECT,
  CLOSE_FOCUS_Y: CLOSE_FOCUS_Y,
  project: project,
  toScreen: toScreen,
  designToPx: designToPx,
  inflate: inflate,
  propRect: propRect,
  petRect: petRect,
  buildHitZones: buildHitZones,
  contains: contains,
  hitTest: hitTest,
  applyAnchors: applyAnchors,
  skyGradientStops: skyGradientStops
};
