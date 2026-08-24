/**
 * Canvas 2D 场景渲染器（22 号文 5.1）。
 *
 * 分层：**Canvas 只画场景**（底图 → 光照 → 天气 → 物件 → 立绘 → 粒子），HUD 与弹层
 * 是覆盖在上面的 WXML。这样 UI 层继续复用 token 与既有组件，而 Canvas 内部像素不受
 * token 约束。
 *
 * 三条硬约束，全部来自既有经验：
 *
 * 1. **拖动/交互期间零 `setData`。** 位移与动画只改本文件里的绘制参数，逻辑层只在
 *    动作确定时被回调一次（`components/glass-sheet/` 的既有做法）。
 * 2. **静止即停帧。** 无动画时**不请求下一帧**。待机动画慢一点更对（治愈系不需要高帧率），
 *    上限 30fps 而非 60 —— 低端安卓（骁龙 6xx 级）是基准机型。
 * 3. **天气档不适用「静止即停帧」。** 雨雪粒子是唯一持续跑帧的图层，帧预算要单独算，
 *    粒子数按机型降级（`ambient.PARTICLES` 的 `degradedCount`）。
 *
 * **素材未就绪时先画纯色底 + 立绘**（22 号文 5.3）—— 这是方案要求的**正式路径**
 * 而不是临时兜底，弱网用户永远走它的一部分。**不画占位色块顶替缺失素材**：
 * 抽象色块是方案点名的违例，纯色底 + 真实立绘是「少而准」，色块是「多而假」。
 */

const ambient = require("./ambient");
const layout = require("./layout");

/** 帧间隔下限：30fps。低端安卓是基准机型，60fps 既跑不到也不需要 */
const MIN_FRAME_MS = 1000 / 30;

/** 待机呼吸周期。慢是刻意的 —— 快了像喘气，那会读作健康状态（4.1 #9 禁止项） */
const BREATH_PERIOD_MS = 3600;

/** 呼吸的纵向缩放幅度。1.0↔1.02，单张立绘能做的就这么多（2.6 更正） */
const BREATH_SCALE = 0.02;

/** 浮动幅度（占立绘高度）。与呼吸错频，避免两者叠成一次大起伏 */
const FLOAT_PERIOD_MS = 5200;
const FLOAT_AMPLITUDE = 0.012;

/** 点击挤压：按下瞬间压扁再弹回。时长短于 300ms 才读作「反馈」而不是「动画」 */
const SQUASH_MS = 280;
const SQUASH_AMOUNT = 0.08;

/** 天气跨段过渡时长。2–3 秒交叉淡入而不是瞬间跳变（22 号文 2.5.3） */
const AMBIENT_FADE_MS = 2400;

/** 镜头切换时长 */
const CAMERA_MS = 420;

/** 情绪粒子存活时长 */
const EMOTE_MS = 1400;

/**
 * 情绪粒子规格。**生命感靠粒子补，不靠帧动画**（2.6 的关键取舍）：
 * 眨眼与转头单张立绘做不到，但粒子和整体变换能补回大部分观感，
 * 而且**比眨眼更能读出情绪**。全部代码绘制、零素材。
 *
 * 形状用 emoji 而非贴图：三个粒子各要一张透明底小图的话，素材清单要多三项，
 * 而 `fillText` 在 Canvas 2D 里对 emoji 支持良好，成本是零。
 */
const EMOTE_GLYPH = { love: "♥", crumb: "•", sleep: "z", spark: "✦" };

function easeOut(ratio) {
  return 1 - Math.pow(1 - ratio, 3);
}

function clamp01(value) {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/**
 * 渲染器。一个页面一个实例。
 *
 * @param {object} options
 * @param {object} options.canvas Canvas 2D 实例（由 `wx.createSelectorQuery` 取得）
 * @param {object} options.context 2D 上下文
 * @param {object} options.view { width, height, dpr } —— 逻辑像素尺寸
 */
function createRenderer(options) {
  const canvas = options.canvas;
  const ctx = options.context;
  const view = { width: options.view.width, height: options.view.height };
  const dpr = options.view.dpr || 1;

  /** 素材图对象表，key → Image。缺的就是缺的，不补占位 */
  let images = {};
  let anchors = layout.applyAnchors(null);

  /** 当前环境与上一档环境（跨段过渡用） */
  let current = null;
  let previous = null;
  let fadeStart = 0;

  /**
   * 上一档的粒子。**雨停要跟着淡出，不能整片凭空消失。**
   *
   * 叠加层已经做了 2.4 秒交叉淡入，但粒子若只跟着 `current` 切，
   * 「雨 → 阴」那一刻天空还在缓慢转亮、雨丝却已经一帧不剩 —— 那比瞬间切换整档更突兀，
   * 因为画面其余部分明明还在过渡中。所以旧粒子留到过渡结束，alpha 走同一个系数。
   *
   * **降级机型不画这一层**（`degraded` 时置空）：过渡的 2.4 秒里两档粒子同时在场，
   * 峰值是 40 + 40 = 80 个 —— 正好抹掉降级省下的那一半。低端机是帧预算最紧的那一档，
   * 而少一段淡出只在切档的两秒里看得到。
   */
  let previousParticles = [];

  let camera = "wide";
  let cameraStart = 0;

  let squashStart = 0;
  let emotes = [];
  let particles = [];
  let degraded = false;

  /**
   * 待机动画开关。呼吸与浮动是持续动画，所以「静止即停帧」的**静止**指的是这个开关关掉后 ——
   * 页面 `onHide`、或日记面板盖住整个画面时。那两种情况下继续跑帧是纯浪费电，
   * 而用户根本看不见。开着时帧循环不停，这是设计如此（待机动画本身就是生命感的来源）。
   */
  let idle = true;

  let running = false;
  let lastFrame = 0;
  let frameHandle = null;
  let hitZones = [];
  const onZonesChange = options.onZonesChange || function () {};

  /**
   * 粒子的初始状态用**固定种子**生成，不用 `Math.random()` 逐帧算。
   * 逐帧随机会让粒子闪烁跳变（22 号文 2.5.1 点名了这一条）。
   */
  function seedParticles(spec, seedText) {
    if (!spec) return [];
    const count = degraded ? spec.degradedCount : spec.count;
    const list = [];
    for (let index = 0; index < count; index += 1) {
      const seed = ambient.hash32(seedText + ":" + index);
      list.push({
        x: ambient.unitAt(seed, 1),
        y: ambient.unitAt(seed, 2),
        speed: 0.4 + ambient.unitAt(seed, 3) * 0.6,
        drift: ambient.unitAt(seed, 4),
        size: 0.5 + ambient.unitAt(seed, 5) * 0.5
      });
    }
    return list;
  }

  /**
   * 是否还要排下一帧。
   *
   * **「静止即停帧」的静止在这里是可判定的**：待机动画关掉（页面不可见）、
   * 没有过渡在跑、没有粒子、没有情绪粒子 —— 四条都成立才真正停下来。
   *
   * 天气档下 `current.particles` 恒为真，于是帧循环不停 —— 那是设计如此：
   * 天气是唯一持续跑帧的图层，「静止即停帧」在天气档下不成立（2.5.1 已写明），
   * 帧预算靠 30fps 上限 + 粒子数降级来守，不靠停帧。
   */
  function needsNextFrame(now) {
    if (!idle) return false;
    if (current && current.particles) return true;
    if (previous && now - fadeStart < AMBIENT_FADE_MS) return true;
    if (now - cameraStart < CAMERA_MS) return true;
    if (squashStart && now - squashStart < SQUASH_MS) return true;
    if (emotes.length) return true;
    // 待机呼吸与浮动：全景档跑，近景档不跑 —— 近景下宠物占满画面，
    // 那点纵向位移会读作「画面在抖」而不是「它在呼吸」
    return camera === "wide";
  }

  /**
   * 画一层半透明色。**普通 alpha（默认 `source-over`），不是色乘**（11.2）：
   * 2.5.1 的实算表只在 alpha 下成立，按 multiply 复算整表都对不上。
   */
  function paintOverlay(layer, factor) {
    if (!layer) return;
    ctx.globalAlpha = layer.opacity * factor;
    ctx.fillStyle = layer.color;
    ctx.fillRect(0, 0, view.width, view.height);
    ctx.globalAlpha = 1;
  }

  /** 底图。缺素材时画纯色天空 + 草地两段，这是 5.3 要求的正式路径 */
  function paintBase(rect) {
    const base = images["scene-yard"];
    if (base) {
      ctx.drawImage(base, rect.x, rect.y, rect.width, rect.height);
      // 顶部不足的部分用天空色渐变向上延伸，接缝落在纯净天空区里看不出来
      if (rect.skyExtend > 0) {
        const gradient = ctx.createLinearGradient(0, 0, 0, rect.skyExtend * 1.2);
        for (const stop of layout.skyGradientStops()) gradient.addColorStop(stop.offset, stop.color);
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, view.width, rect.skyExtend * 1.2);
      }
      return;
    }
    /*
     * 素材未就绪路径：两段纯色（天空 + 草地），地平线取 anchors。
     *
     * 这不是占位色块 —— 占位色块是「本该有内容却拿一块颜色顶替」，
     * 而这里天空就是天空色、草地就是草地色，只是没有笔触细节。
     * 立绘照常画在上面，用户看到的是「自家宠物在一片草地上」，信息是真的。
     */
    const horizon = view.height * anchors.horizonY;
    ctx.fillStyle = ambient.ISLAND_PALETTE.sky;
    ctx.fillRect(0, 0, view.width, horizon);
    ctx.fillStyle = ambient.ISLAND_PALETTE.grass;
    ctx.fillRect(0, horizon, view.width, view.height - horizon);
  }

  /** 物件。缺素材就不画 —— 不画比画个方块好 */
  function paintProps(rect) {
    const entries = [
      { key: "prop-bed", anchor: anchors.bed, size: layout.PROP_SIZE.bed },
      { key: "prop-grass", anchor: anchors.grass, size: layout.PROP_SIZE.grass },
      { key: "prop-bowl", anchor: anchors.bowl, size: layout.PROP_SIZE.bowl }
    ];
    // 按 y 排序：靠下的后画，才有前后遮挡关系
    entries.sort((left, right) => left.anchor.y - right.anchor.y);
    for (const entry of entries) {
      const image = images[entry.key];
      if (!image) continue;
      const box = layout.propRect(view, rect, entry.anchor, entry.size);
      paintGroundShadow(box);
      ctx.drawImage(image, box.x, box.y, box.width, box.height);
    }
  }

  /**
   * 物体下方的柔和椭圆阴影（24 号文第 4 章：代码绘制）。
   * **暖褐基色，不是灰黑** —— `SHADOW_HUE = "60,35,20"`，UI 重构方案称这是
   * 「廉价与高级最快的分水岭」（22 号文诊断 9）。
   */
  function paintGroundShadow(box) {
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height;
    const rx = box.width * 0.42;
    const ry = box.height * 0.10;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, rx);
    gradient.addColorStop(0, "rgba(60,35,20,0.28)");
    gradient.addColorStop(1, "rgba(60,35,20,0)");
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(1, ry / rx);
    ctx.translate(-cx, -cy);
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.arc(cx, cy, rx, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  /**
   * 立绘 + 待机动画。
   *
   * **单张立绘只能做整体变换**（2.6 更正）：呼吸（纵向缩放）、浮动（纵向位移）、
   * 挤压拉伸（点击反馈）。**不做眨眼和转头** —— 眨眼要一张闭眼图或眼睛坐标，
   * 转头要另一个角度的图（那是多次生成，一致性拿不到）。
   */
  function paintPet(rect, now) {
    const image = images["pet-avatar"] || images["pet-sample"];
    const box = layout.petRect(view, rect, anchors, camera, current && current.shelter);

    // 呼吸：纵向缩放，锚在脚底（缩放中心在头顶的话宠物会离地）
    const breath = 1 + BREATH_SCALE * (0.5 - 0.5 * Math.cos(now / BREATH_PERIOD_MS * Math.PI * 2));
    // 浮动：与呼吸错频
    const float = FLOAT_AMPLITUDE * Math.sin(now / FLOAT_PERIOD_MS * Math.PI * 2) * box.height;

    // 挤压拉伸：横向撑开 + 纵向压扁，体积守恒才像有弹性
    let squashX = 1;
    let squashY = 1;
    if (squashStart) {
      const ratio = clamp01((now - squashStart) / SQUASH_MS);
      if (ratio >= 1) squashStart = 0;
      else {
        // 先压后弹：半周期正弦
        const amount = SQUASH_AMOUNT * Math.sin(ratio * Math.PI);
        squashY = 1 - amount;
        squashX = 1 + amount;
      }
    }

    const drawWidth = box.width * squashX;
    const drawHeight = box.height * breath * squashY;
    const drawX = box.x + (box.width - drawWidth) / 2;
    const drawY = box.y + box.height - drawHeight + float;

    if (image) {
      paintGroundShadow({ x: drawX, y: drawY, width: drawWidth, height: drawHeight });
      ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    }
    return { x: drawX + drawWidth / 2, y: drawY, width: drawWidth, height: drawHeight };
  }

  /**
   * 夜档与暮档的窗户暖光。**「家」的核心意象**（2.5），径向渐变代码绘制。
   * 画在光照层**之后** —— 暖光是穿过窗户透出来的，不该被夜色压暗。
   */
  function paintWindowGlow(rect, fade) {
    /*
     * 与地面反光同一处理：**灯不能瞬间亮**。暖光只在暮/夜两档有，
     * 昼→暮那一刻整片天空还在缓慢转橙、窗口却已经满亮，是最容易被看出来的一处跳变。
     * 两档权重相加，暮→夜（两档都有暖光）时合计仍是 1，不会中途暗一下。
     */
    const factor = (current && current.windowGlow ? fade : 0)
      + (previous && previous.windowGlow ? 1 - fade : 0);
    if (factor <= 0) return;
    const win = anchors.window;
    const center = layout.toScreen(rect, { x: win.x + win.w / 2, y: win.y + win.h / 2 });
    const radius = Math.max(win.w * rect.width, win.h * rect.height) * 2.2;
    const gradient = ctx.createRadialGradient(center.x, center.y, 0, center.x, center.y, radius);
    gradient.addColorStop(0, ambient.toRgba(ambient.WINDOW_GLOW.color, ambient.WINDOW_GLOW.opacity * factor));
    gradient.addColorStop(1, ambient.toRgba(ambient.WINDOW_GLOW.color, 0));
    ctx.fillStyle = gradient;
    ctx.fillRect(center.x - radius, center.y - radius, radius * 2, radius * 2);
  }

  /**
   * 雨丝与雪花。**Canvas 里画线段和圆点，不用图片序列帧**（2.5.1），零素材成本。
   * 位置由固定种子决定、只有相位随时间推进，所以粒子不会闪烁跳变。
   *
   * @param kind "rain" / "snow"
   * @param list 粒子表（种子生成，不逐帧随机）
   * @param factor 整层不透明度系数，跨段过渡时按 fade 给 —— 与叠加层同一个系数，
   *        这样「天空转亮」与「雨丝变淡」是同步的
   */
  function paintParticleLayer(now, kind, list, factor) {
    if (!kind || !list.length || factor <= 0) return;
    ctx.save();
    if (kind === "rain") {
      ctx.strokeStyle = ambient.toRgba(ambient.ISLAND_PALETTE.water, 0.5 * factor);
      ctx.lineWidth = Math.max(1, layout.designToPx(view, 2));
      ctx.beginPath();
      for (const dot of list) {
        // 雨丝斜向下落，横向偏移与纵向位移固定比例才不会看起来在飘
        const progress = (dot.y + now / 900 * dot.speed) % 1;
        const x = (dot.x + progress * 0.12) % 1 * view.width;
        const y = progress * view.height;
        const length = view.height * 0.035 * dot.size;
        ctx.moveTo(x, y);
        ctx.lineTo(x - length * 0.24, y + length);
      }
      ctx.stroke();
    } else {
      ctx.fillStyle = ambient.toRgba(ambient.ISLAND_PALETTE.cream, 0.85 * factor);
      for (const dot of list) {
        // 雪花缓慢飘落 + 正弦横移
        const progress = (dot.y + now / 5200 * dot.speed) % 1;
        const sway = Math.sin((now / 2600 + dot.drift) * Math.PI * 2) * 0.03;
        const x = ((dot.x + sway) % 1 + 1) % 1 * view.width;
        const y = progress * view.height;
        const radius = layout.designToPx(view, 4) * dot.size;
        ctx.beginPath();
        ctx.arc(x, y, radius, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  /**
   * 两档粒子。新档淡入、旧档淡出，与叠加层共用 `fade` 系数。
   *
   * **旧档先画**：淡出中的雨丝在下、淡入中的雪花在上，视觉上读作「雪盖住了雨」
   * 而不是两层互相穿插。反过来画时旧档会压在新档之上，过渡的两秒里主次颠倒。
   */
  function paintParticles(now, fade) {
    if (previousParticles.length && previous && previous.particles) {
      paintParticleLayer(now, previous.particles.kind, previousParticles, 1 - fade);
    }
    if (current && current.particles) {
      paintParticleLayer(now, current.particles.kind, particles, fade);
    }
  }

  /**
   * 雨档的地面反光。一层半透明贴图而非逐物体计算（2.5.1），成本可忽略。
   *
   * **也跟着过渡淡**：地面由湿变干（或反过来）不该比天空快。系数取两档的加权和 ——
   * 「雨 → 雨」时两边都是雨，权重合起来仍是 1，不会在同档轮询时闪一下。
   */
  function paintWetGround(rect, fade) {
    const factor = (current && current.weather === "rain" ? fade : 0)
      + (previous && previous.weather === "rain" ? 1 - fade : 0);
    if (factor <= 0) return;
    const horizon = rect.y + rect.height * anchors.horizonY;
    const gradient = ctx.createLinearGradient(0, horizon, 0, view.height);
    gradient.addColorStop(0, ambient.toRgba(ambient.ISLAND_PALETTE.water, 0));
    gradient.addColorStop(1, ambient.toRgba(ambient.ISLAND_PALETTE.water, 0.22 * factor));
    ctx.fillStyle = gradient;
    ctx.fillRect(0, horizon, view.width, view.height - horizon);
  }

  /** 情绪粒子。被摸冒心、吃东西溅碎屑、趴窝飘 Z */
  function paintEmotes(now, petBox) {
    if (!emotes.length) return;
    const alive = [];
    ctx.save();
    ctx.textAlign = "center";
    for (const emote of emotes) {
      const ratio = (now - emote.startedAt) / EMOTE_MS;
      if (ratio >= 1) continue;
      alive.push(emote);
      const eased = easeOut(ratio);
      const size = layout.designToPx(view, emote.size);
      const x = petBox.x + (emote.offsetX + Math.sin((ratio + emote.phase) * Math.PI * 2) * 0.18) * petBox.width;
      const y = petBox.y + petBox.height * emote.offsetY - eased * petBox.height * 0.5;
      ctx.globalAlpha = 1 - eased;
      ctx.font = size + "px sans-serif";
      ctx.fillStyle = emote.color;
      ctx.fillText(emote.glyph, x, y);
    }
    ctx.restore();
    ctx.globalAlpha = 1;
    emotes = alive;
  }

  /** 近景档的背景虚化。**背景换成虚化色块**（2.4），不是另画一张图 */
  function paintCloseBackdrop() {
    const gradient = ctx.createRadialGradient(view.width / 2, view.height * 0.36, 0, view.width / 2, view.height * 0.36, view.height * 0.8);
    gradient.addColorStop(0, ambient.ISLAND_PALETTE.grass);
    gradient.addColorStop(1, ambient.ISLAND_PALETTE.canopy);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, view.width, view.height);
  }

  function paintFrame(now) {
    const rect = layout.project(view);
    ctx.clearRect(0, 0, view.width, view.height);

    /*
     * 近景权重 0..1。`cameraStart` 为 0（从未切过镜头）时 progress 直接算满，
     * 于是初始的 wide 档得 1-1=0、close 档得 1 —— 两边都落在稳定态，
     * 不会出现「首帧从近景淡出」这种没人切过的动画。
     */
    const cameraProgress = easeOut(clamp01((now - cameraStart) / CAMERA_MS));
    const closeRatio = camera === "close" ? cameraProgress : 1 - cameraProgress;

    /*
     * 跨段过渡进度。**在近景分支之外算**：粒子层画在近景底衬之上（雨雪要盖住整个画面，
     * 近景档也在下雨），所以两条分支都要用到它。放进 else 里会让近景档的粒子拿不到系数。
     *
     * 旧档按 1-t 衰减、新档按 t 增强，两者都是 alpha 层，叠起来总量不守恒 ——
     * 但那点误差只在过渡的两秒里，肉眼不可辨，换成正确的插值要逐层解合成方程。
     */
    const fade = previous ? clamp01((now - fadeStart) / AMBIENT_FADE_MS) : 1;

    if (closeRatio > 0.98) paintCloseBackdrop();
    else {
      paintBase(rect);
      // 2.5.3 要求 2–3 秒平滑过渡而不是瞬间跳变
      if (previous && fade < 1) for (const layer of previous.overlays) paintOverlay(layer, 1 - fade);
      if (current) for (const layer of current.overlays) paintOverlay(layer, fade);
      paintWindowGlow(rect, fade);
      paintWetGround(rect, fade);
      paintProps(rect);
      // 近景过渡途中用半透明的近景底衬做交叉淡入
      if (closeRatio > 0) { ctx.globalAlpha = closeRatio; paintCloseBackdrop(); ctx.globalAlpha = 1; }
    }

    const petBox = paintPet(rect, now);
    paintParticles(now, fade);
    paintEmotes(now, petBox);

    /*
     * 过渡结束后清掉旧档。**必须放在绘制之后**：早先这一步写在叠加层那一行的
     * `else if` 分支里，于是 fade 满 1 的那一帧先清 `previous` 再画 —— 粒子与暖光
     * 都读 `previous`，等于最后一帧的淡出量凭空丢掉。放到帧尾后，清理只影响下一帧。
     */
    if (previous && fade >= 1) { previous = null; previousParticles = []; }
  }

  /**
   * 一帧。
   *
   * **时钟统一取 `Date.now()`，刻意忽略 rAF 传进来的时间戳。** 两者原点不同
   * （rAF 从页面创建起算，`Date.now()` 是墙上时间），而 `fadeStart` / `cameraStart` /
   * `squashStart` / `emote.startedAt` 全是 `Date.now()` 记的 —— 混用会让
   * `now - fadeStart` 得到一个几万倍的差值，过渡动画表现为「瞬间跳完」，
   * 而且只在真机上出现（开发者工具里两者恰好接近）。
   */
  function frame() {
    frameHandle = null;
    if (!running) return;
    const now = Date.now();
    // 帧率上限 30fps：来得太早的帧只跳过绘制，仍要排下一帧
    if (now - lastFrame >= MIN_FRAME_MS) {
      lastFrame = now;
      paintFrame(now);
    }
    if (needsNextFrame(now)) schedule();
    else running = false;
  }

  function schedule() {
    if (frameHandle !== null) return;
    // rAF 挂在画布实例上而非全局，这是小程序 type="2d" 的约定；取不到时退回定时器
    if (canvas && typeof canvas.requestAnimationFrame === "function") frameHandle = canvas.requestAnimationFrame(frame);
    else frameHandle = setTimeout(frame, MIN_FRAME_MS);
  }

  /**
   * 唤醒帧循环。停帧后任何状态变化都要调它一次，否则改了参数画面不动。
   * `idle` 关着时直接返回 —— 页面不可见，起循环没有意义。
   */
  function wake() {
    if (!idle) return;
    if (running) { schedule(); return; }
    running = true;
    lastFrame = 0;
    schedule();
  }

  function stop() {
    running = false;
    if (frameHandle === null) return;
    if (canvas && typeof canvas.cancelAnimationFrame === "function") canvas.cancelAnimationFrame(frameHandle);
    else clearTimeout(frameHandle);
    frameHandle = null;
  }

  function refreshZones() {
    hitZones = layout.buildHitZones(view, anchors, camera, current && current.shelter);
    onZonesChange(hitZones);
  }

  return {
    /** 设置素材图。**逐键合并**：底图后到时不该把已加载的立绘冲掉 */
    setImages(map) {
      images = Object.assign({}, images, map || {});
      wake();
    },

    setAnchors(overrides) {
      anchors = layout.applyAnchors(overrides);
      refreshZones();
      wake();
    },

    /**
     * 切换环境。同档位重复设置直接忽略 —— 每分钟轮询一次时绝大多数调用都是同档，
     * 不拦的话每次都会重新起一遍 2.4 秒的过渡动画，画面永远在淡入。
     */
    setAmbient(next) {
      if (!next) return;
      if (current && current.phase === next.phase && current.weather === next.weather) return;
      previous = current;
      /*
       * 旧档粒子接管到 `previousParticles` 再换新表。**降级机型直接丢掉**：
       * 过渡的 2.4 秒里两档同时在场，峰值 40+40 会抹掉降级省下的那一半，
       * 而低端机正是帧预算最紧的一档（少一段淡出只在切档的两秒里看得到）。
       */
      previousParticles = degraded ? [] : particles;
      fadeStart = Date.now();
      current = next;
      particles = seedParticles(next.particles, next.phase + ":" + next.weather);
      refreshZones();
      wake();
    },

    /**
     * 待机动画开关。页面 `onHide` 时关掉 —— 用户看不见的时候继续跑 30fps
     * 是纯耗电，而雨雪档下帧循环本来不会自己停（`needsNextFrame` 里粒子恒为真）。
     * 关掉后帧循环在下一帧自然退出，不需要额外的 stop 调用。
     */
    setIdle(value) {
      idle = Boolean(value);
      if (idle) wake();
    },

    /** 低端机降级：粒子数掉到 40 以内（2.5.1） */
    setDegraded(value) {
      if (degraded === Boolean(value)) return;
      degraded = Boolean(value);
      // 降级时连淡出中的旧档一起丢：留着它等于在最该省帧的机型上多画一层
      if (degraded) previousParticles = [];
      if (current) particles = seedParticles(current.particles, current.phase + ":" + current.weather);
      wake();
    },

    /**
     * 两档镜头切换（2.4）。全景看家园，近景看表情。
     * 近景是**同一张立绘放大裁切**，不是另一个角度。
     */
    setCamera(next) {
      const target = next === "close" ? "close" : "wide";
      if (target === camera) return;
      /*
       * 不记「从哪一档来」：`paintFrame` 的 `closeRatio` 由**目标档 + 进度**就能算出
       * （close 档取 progress、wide 档取 1-progress），起点档位是冗余信息。
       * 早先这里有一句 `cameraFrom = camera`，只写不读 —— 而小程序的
       * `es6: true` 编译产物是严格模式，给未声明的变量赋值会抛 ReferenceError，
       * 表现是「点宠物切镜头整页卡住」。
       */
      camera = target;
      cameraStart = Date.now();
      refreshZones();
      wake();
    },

    getCamera() { return camera; },

    /** 点击反馈：挤压拉伸。**乐观动画**，不等服务端（22 号文 5.6 允许） */
    squash() {
      squashStart = Date.now();
      wake();
    },

    /**
     * 冒情绪粒子。`kind` ∈ love / crumb / sleep / spark。
     *
     * **乐观动画但不乐观数据**：粒子立刻播，掉落物要等服务端返回才显示（5.6）。
     */
    emote(kind, count) {
      const glyph = EMOTE_GLYPH[kind] || EMOTE_GLYPH.spark;
      const color = kind === "love" ? "#C4335C" : kind === "crumb" ? ambient.ISLAND_PALETTE.path : ambient.ISLAND_PALETTE.cream;
      const total = Math.max(1, Math.min(6, Number(count) || 3));
      const now = Date.now();
      for (let index = 0; index < total; index += 1) {
        emotes.push({
          glyph: glyph,
          color: color,
          size: 28 + index * 4,
          offsetX: -0.2 + index * 0.16,
          offsetY: 0.12,
          phase: index / total,
          startedAt: now + index * 90
        });
      }
      wake();
    },

    /** 触摸命中。返回热区或 null（点空地不该有任何反应） */
    hitTest(x, y) { return layout.hitTest(hitZones, x, y); },

    getZones() { return hitZones; },

    /** 视图尺寸变化（横竖屏切换）。重算命中表 */
    resize(nextView) {
      view.width = nextView.width;
      view.height = nextView.height;
      if (ctx && typeof ctx.scale === "function" && canvas) {
        canvas.width = view.width * dpr;
        canvas.height = view.height * dpr;
        ctx.scale(dpr, dpr);
      }
      refreshZones();
      wake();
    },

    wake: wake,
    stop: stop,
    /** 只在测试与排查时用：不经帧循环画一帧 */
    paintOnce(now) { paintFrame(typeof now === "number" ? now : Date.now()); }
  };
}

module.exports = {
  MIN_FRAME_MS: MIN_FRAME_MS,
  BREATH_PERIOD_MS: BREATH_PERIOD_MS,
  BREATH_SCALE: BREATH_SCALE,
  SQUASH_MS: SQUASH_MS,
  AMBIENT_FADE_MS: AMBIENT_FADE_MS,
  EMOTE_GLYPH: EMOTE_GLYPH,
  createRenderer: createRenderer
};
