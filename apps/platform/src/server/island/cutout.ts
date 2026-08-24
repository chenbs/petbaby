import "server-only";

import sharp from "sharp";

/*
 * 立绘去背：把生图返回的不透明画面抠成透明底 PNG。
 *
 * **立绘必须是透明底 PNG**（22 号文 2.6）：它要叠在四档光照 × 四档天气之上，
 * 带背景的图叠上去就是一张贴纸。而生图接口**不产出 alpha** —— 两代代理站都不给，
 * 只是拒绝方式不同：packy 以 400 `Transparent background is not supported for this
 * model` 明说，lingsuan **返 200 却仍给不透明产物**（`alpha=false`，2026-08-06 实测）。
 * 后者更危险，因为「成功」的响应会让调用方以为拿到了透明图。所以约定让模型画纯品红底，
 * 再在这里色键抠除 —— 与离线素材同一条路线（`tools/imagegen/generate.mjs` 的回落判据
 * 因此是回读产物 alpha，不是捕获异常）。
 *
 * 品红 `#FF00FF` 的选择依据：**猫狗毛色里不存在这个色相**。白底会把白猫和奶白器物
 * 一起抠掉，而样板宠物摩奇正是橘白猫、有白胸兜。
 *
 * ── 与 `tools/imagegen/upload-island.mjs` 的关系 ────────────────────────────
 * 那是同一算法的第二份实现，不是同一份代码。理由与 `island-weather.ts` 没复用
 * `health-service.asDateString` 相同（22 号文 11.4）：那个工具是仓库根下的独立 `.mjs`，
 * 在 `apps/platform` 的 tsconfig 根之外，跨过去 import 会把工具链拖进应用构建。
 * **两份的阈值必须逐字相同**，所以取值集中在下面四个常量里，`cutout.test.ts`
 * 逐个钉住 —— 改一边不改另一边，表现是「离线素材干净、运行时立绘带粉边」。
 *
 * 抠图可行性已在第 0b 步实测通过（24 号文 6.1）：前景残留品红 0.07–0.08%、
 * 叠草地无色环、白胸兜与耳内绒毛完整。方案 2.7 点名的「唯一技术风险」已解除。
 */

/**
 * 「品红度」= `min(R,B) - G`。取值域 -255…255，纯品红得 255。
 *
 * **不按 `#FF00FF` 逐像素等值比对**（24 号文 6.1 实测约束 1）：实测背景带轻微噪声
 * 与渐变，**没有任何一个像素恰好是 `255,0,255`**（背景均值 `rgb(252,3,245)`），
 * 等值比对会漏掉整片背景。
 *
 * 选这个量而不是 RGB 距离，是因为它同时是**溢色的度量**：品红的绿通道为 0，
 * 边缘上混入品红的像素必然红蓝同高、绿偏低，`min(R,B) - G` 正好量出混了多少。
 * 一个量既做抠除判据又做去溢色强度，两者不会打架。
 */
export function magentaness(r: number, g: number, b: number): number {
  return Math.min(r, b) - g;
}

/** 品红度低于此值判前景（24 号文 6.1 实测） */
export const KEY_OPAQUE_BELOW = 30;
/** 品红度高于此值判全透明 */
export const KEY_CLEAR_ABOVE = 110;
/** 去溢色系数，实测 0.8 */
export const DESPILL_FACTOR = 0.8;

/**
 * 算「残留」时的可见性下限。**不能取 0。**
 *
 * 品红度是 `min(R,B) - G`，任何略偏冷的中性像素（R≈B≈G+1）都会得到正值，
 * 而那不是品红残留、肉眼也看不出来。取 10 是对齐 24 号文 6.1 的实测口径：
 * 该文报告占前景 0.07–0.08%，取 `>10` 复现得 0.075%，取 `>0` 得 0.126% ——
 * 会把一张已验收通过的图判成超标。**判据的阈值也是口径的一部分。**
 */
export const RESIDUE_VISIBLE_LEVEL = 10;

/**
 * 判定「这张图是品红底」的覆盖率下限。
 *
 * **不做四角采样**（24 号文 6.1 已把那条判据废止）：实测四角必然不一致
 * （编码环节在极端像素上的振铃），按四角严格判定会把可用的图全部退掉。
 *
 * 取 25%：实测主体占画面 32–43%，背景因此有 57–68%，25% 留了足够余量，
 * 同时高到不会把「主体自带大片粉色」误判成品红底。
 */
export const MAGENTA_COVERAGE_MIN = 0.25;

/** 立绘目标尺寸（24 号文 7.4）。近景是同一张图放大，所以分辨率不能低 */
export const SPRITE_WIDTH = 1200;
export const SPRITE_HEIGHT = 1600;

export interface CutoutResult {
  body: Uint8Array;
  /** 是否真的抠了。false 表示图本身已带 alpha，或不是品红底（原样透传） */
  keyed: boolean;
  /** 判为透明的像素占比，% */
  clearedPercent: number;
  /** 前景内残留可见品红的占比，%。>0.1 说明抠不干净，叠绿草地会看到色环 */
  residuePercent: number;
}

/** 图里是否已有有效 alpha（存在任何明显非不透明的像素）。已透明的图不再抠 */
async function hasUsableAlpha(body: Uint8Array): Promise<boolean> {
  const meta = await sharp(Buffer.from(body)).metadata();
  if (!meta.hasAlpha) return false;
  const { data, info } = await sharp(Buffer.from(body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
    if (data[offset] < 250) return true;
  }
  return false;
}

/**
 * 抠掉品红底并归一到立绘尺寸。
 *
 * 两步（顺序不能换）：① 按品红度给 alpha（含羽化带）；② **羽化带内去溢色**。
 *
 * 第二步不能省（24 号文 6.1 实测约束 2）：不做的话过渡带残留品红，
 * **叠在绿色草地上是最刺眼的组合** —— 品红与草绿接近互补色，一圈粉边在绿底上
 * 比在任何其他底色上都明显，而岛的画面 60% 以上是绿。
 *
 * 去溢色**只在羽化带内做**：全图做会把主体本身的暖色削掉（橘猫的毛正是红高蓝低）。
 *
 * 缩放用 `fit: "contain"` + 透明填充而不是 `cover`：`cover` 会裁掉四肢或耳尖，
 * 而 24 号文 2.4 的验收标准要求「全身完整不裁切」。letterbox 出来的透明边
 * 对精灵图没有代价 —— 端上按 `PET_ASPECT` 定位，多出来的透明区不占视觉。
 */
export async function cutoutSprite(body: Uint8Array): Promise<CutoutResult> {
  // 类型取自 sharp() 的返回值：`import sharp` 是默认导入，`sharp.Sharp` 这个命名空间不存在
  const toSprite = (input: ReturnType<typeof sharp>) =>
    input
      .resize(SPRITE_WIDTH, SPRITE_HEIGHT, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
      .png({ compressionLevel: 9 })
      .toBuffer();

  if (await hasUsableAlpha(body)) {
    // 已带 alpha：不要再走色键，那会把主体里恰好偏品红的像素打穿
    return { body: new Uint8Array(await toSprite(sharp(Buffer.from(body)))), keyed: false, clearedPercent: 0, residuePercent: 0 };
  }

  const { data, info } = await sharp(Buffer.from(body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const channels = info.channels;
  const width = info.width;
  const height = info.height;
  let cleared = 0;
  let total = 0;
  /** 透明掩膜，供残留统计排除描边那一圈用（见下方 residuePercent 的说明） */
  const clearMask = new Uint8Array(width * height);

  for (let offset = 0; offset < data.length; offset += channels) {
    const r = data[offset];
    const g = data[offset + 1];
    const b = data[offset + 2];
    const level = magentaness(r, g, b);
    total += 1;
    if (level > KEY_CLEAR_ABOVE) {
      data[offset + channels - 1] = 0;
      clearMask[offset / channels] = 1;
      cleared += 1;
      continue;
    }
    if (level >= KEY_OPAQUE_BELOW) {
      // 羽化带：alpha 随品红度线性下降（越像品红越透）
      const ratio = (level - KEY_OPAQUE_BELOW) / (KEY_CLEAR_ABOVE - KEY_OPAQUE_BELOW);
      data[offset + channels - 1] = Math.round(255 * (1 - ratio));
      const spill = Math.round(level * DESPILL_FACTOR);
      data[offset] = Math.max(0, r - spill);
      data[offset + 2] = Math.max(0, b - spill);
      continue;
    }
  }

  /*
   * 残留统计**排除紧贴透明区的一圈**（2026-08-06 修正口径，与
   * `tools/imagegen/upload-island.mjs` 逐字一致 —— 两份实现有比对测试钉住）。
   *
   * 原先算「全部前景里品红度 >10 的占比」，而这套画风有**闭合描边**，
   * 描边与背景之间必然有一圈抗锯齿过渡像素，品红度落在 10–29：
   * 既不够进羽化带（≥30）又高于可见下限（>10），于是全部被记成「残留」。
   *
   * 实测样板宠物：858 个残留里 856 个（99.8%）贴在边缘 3px 内，内部只有 2 个
   * 且是中性灰粉（肉眼不可见）。排除 1px 后从 0.319% 降到 0.034%，
   * 而产物叠在真实草地色上目视无粉边、白胸兜与耳内绒毛完整。
   *
   * **不靠调低 `KEY_OPAQUE_BELOW` 来凑这个数**：那是实测定的抠除阈值，
   * 降它会把更多描边像素拉进羽化带并去溢色 —— 指标好看了，主体被削了。
   * 判据错了就修判据。
   */
  const RESIDUE_EDGE_SKIP = 1;
  let foreground = 0;
  let residue = 0;
  for (let index = 0; index < width * height; index += 1) {
    const offset = index * channels;
    const level = magentaness(data[offset], data[offset + 1], data[offset + 2]);
    if (level > KEY_CLEAR_ABOVE || level >= KEY_OPAQUE_BELOW) continue;
    const x = index % width;
    const y = (index - x) / width;
    let nearEdge = false;
    for (let dy = -RESIDUE_EDGE_SKIP; dy <= RESIDUE_EDGE_SKIP && !nearEdge; dy += 1) {
      for (let dx = -RESIDUE_EDGE_SKIP; dx <= RESIDUE_EDGE_SKIP; dx += 1) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (clearMask[ny * width + nx]) { nearEdge = true; break; }
      }
    }
    if (nearEdge) continue;
    foreground += 1;
    if (level > RESIDUE_VISIBLE_LEVEL) residue += 1;
  }

  const clearedPercent = total ? (cleared / total) * 100 : 0;
  /*
   * 覆盖率不够说明这张不是品红底（模型没照指令画）。此时**原样透传而不是硬抠**：
   * 硬抠会把主体上偏品红的部分打出洞，而带背景的立绘虽然观感差，至少是完整的。
   * 判断留给调用方 —— `keyed: false` 会被记进日志，重生成能解决。
   */
  if (clearedPercent < MAGENTA_COVERAGE_MIN * 100) {
    return { body: new Uint8Array(await toSprite(sharp(Buffer.from(body)))), keyed: false, clearedPercent, residuePercent: 0 };
  }

  const keyedBuffer = await toSprite(
    sharp(data, { raw: { width: info.width, height: info.height, channels: channels as 4 } }),
  );
  return {
    body: new Uint8Array(keyedBuffer),
    keyed: true,
    clearedPercent,
    residuePercent: foreground ? (residue / foreground) * 100 : 0,
  };
}
