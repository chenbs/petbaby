import sharp from "sharp";
import { describe, expect, it } from "vitest";

import {
  DESPILL_FACTOR,
  KEY_CLEAR_ABOVE,
  KEY_OPAQUE_BELOW,
  MAGENTA_COVERAGE_MIN,
  RESIDUE_VISIBLE_LEVEL,
  SPRITE_HEIGHT,
  SPRITE_WIDTH,
  cutoutSprite,
  magentaness,
} from "@/server/island/cutout";

/*
 * 立绘去背（22 号文 2.6，判据来自 24 号文 6.1 的第 0b 步实测）。
 *
 * **立绘必须是透明底 PNG**：它要叠在四档光照 × 四档天气之上，带背景就是一张贴纸。
 * 而生图不产出 alpha，所以让模型画品红底再色键抠除。
 *
 * 这一组的重点是**阈值口径**：`tools/imagegen/upload-island.mjs` 是同一算法的第二份
 * 实现（跨 tsconfig 根不能共用代码），两份的取值必须逐字相同 ——
 * 改一边不改另一边，表现是「离线素材干净、运行时立绘带粉边」。
 */

/** 画一张品红底 + 中间一块前景的测试图 */
async function magentaCanvas(foreground: { r: number; g: number; b: number } = { r: 230, g: 150, b: 90 }, blockRatio = 0.4) {
  const width = 240;
  const height = 320;
  const blockWidth = Math.round(width * blockRatio);
  const blockHeight = Math.round(height * blockRatio);
  const block = await sharp({ create: { width: blockWidth, height: blockHeight, channels: 3, background: foreground } }).png().toBuffer();
  return new Uint8Array(
    await sharp({ create: { width, height, channels: 3, background: { r: 255, g: 0, b: 255 } } })
      .composite([{ input: block, gravity: "center" }])
      .png()
      .toBuffer(),
  );
}

describe("品红度判据", () => {
  /*
   * **不按 `#FF00FF` 逐像素等值比对**（6.1 实测约束 1）：实测背景带轻微噪声与渐变，
   * **没有任何一个像素恰好是 255,0,255**（均值 `rgb(252,3,245)`），
   * 等值比对会漏掉整片背景。
   */
  it("纯品红得 255，实测背景均值仍判为透明", () => {
    expect(magentaness(255, 0, 255)).toBe(255);
    // 24 号文 6.1 报告的实测背景均值
    expect(magentaness(252, 3, 245)).toBeGreaterThan(KEY_CLEAR_ABOVE);
    // 四角实测值（编码振铃）同样要判为透明 —— 按四角严格判定会把可用的图全部退掉
    expect(magentaness(241, 14, 235)).toBeGreaterThan(KEY_CLEAR_ABOVE);
    expect(magentaness(242, 29, 234)).toBeGreaterThan(KEY_CLEAR_ABOVE);
  });

  /** 橘猫的毛是红高蓝低 —— 这个量对它接近 0，所以不会被误抠 */
  it("橘色前景判为前景，白色也是", () => {
    expect(magentaness(230, 150, 90)).toBeLessThan(KEY_OPAQUE_BELOW);
    expect(magentaness(255, 255, 255)).toBeLessThan(KEY_OPAQUE_BELOW);
    expect(magentaness(58, 44, 44)).toBeLessThan(KEY_OPAQUE_BELOW);
  });

  /** 阈值取值必须与 24 号文 6.1 的实测一致 —— 它们也是 upload-island.mjs 的取值 */
  it("阈值与离线工具逐字相同", () => {
    expect(KEY_OPAQUE_BELOW).toBe(30);
    expect(KEY_CLEAR_ABOVE).toBe(110);
    expect(DESPILL_FACTOR).toBe(0.8);
    expect(MAGENTA_COVERAGE_MIN).toBe(0.25);
  });

  /*
   * 残留统计的可见性下限**不能取 0**：品红度是 `min(R,B) - G`，
   * 任何略偏冷的中性像素（R≈B≈G+1）都会得到正值，而那不是品红残留。
   * 取 `>0` 会把一张已验收通过的图判成超标（实测 0.126% vs 0.075%）。
   */
  it("残留可见性下限取 10，不取 0", () => {
    expect(RESIDUE_VISIBLE_LEVEL).toBe(10);
    // 略偏冷的中性灰：品红度为正但肉眼看不出，不该算残留
    expect(magentaness(128, 127, 128)).toBeGreaterThan(0);
    expect(magentaness(128, 127, 128)).toBeLessThanOrEqual(RESIDUE_VISIBLE_LEVEL);
  });
});

describe("抠图", () => {
  it("品红底被抠成透明，前景保留", async () => {
    const result = await cutoutSprite(await magentaCanvas());
    expect(result.keyed).toBe(true);
    // 背景占 84%（前景块是 0.4×0.4）
    expect(result.clearedPercent).toBeGreaterThan(60);

    const { data, info } = await sharp(Buffer.from(result.body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const at = (x: number, y: number) => {
      const offset = (y * info.width + x) * info.channels;
      return { r: data[offset], g: data[offset + 1], b: data[offset + 2], a: data[offset + info.channels - 1] };
    };
    // 角上是透明的
    expect(at(2, 2).a).toBe(0);
    // 正中是前景，仍不透明
    expect(at(Math.floor(info.width / 2), Math.floor(info.height / 2)).a).toBe(255);
  });

  /** 输出归一到立绘尺寸 —— 近景是同一张图放大，分辨率不能低（2.4 / 24 号文 7.4） */
  it("输出是 1200×1600 的 PNG", async () => {
    const result = await cutoutSprite(await magentaCanvas());
    const meta = await sharp(Buffer.from(result.body)).metadata();
    expect(meta.width).toBe(SPRITE_WIDTH);
    expect(meta.height).toBe(SPRITE_HEIGHT);
    expect(meta.format).toBe("png");
    expect(meta.hasAlpha).toBe(true);
  });

  /*
   * 缩放用 `contain` 而不是 `cover`：`cover` 会裁掉四肢或耳尖，
   * 而 24 号文 2.4 的验收标准要求「全身完整不裁切」。
   */
  it("不同比例的输入不被裁切，四周补透明", async () => {
    // 宽图：contain 会在上下补透明边，cover 会把左右裁掉
    const wide = new Uint8Array(
      await sharp({ create: { width: 400, height: 100, channels: 3, background: { r: 255, g: 0, b: 255 } } })
        .composite([{ input: await sharp({ create: { width: 360, height: 40, channels: 3, background: { r: 230, g: 150, b: 90 } } }).png().toBuffer(), gravity: "center" }])
        .png()
        .toBuffer(),
    );
    const result = await cutoutSprite(wide);
    const { data, info } = await sharp(Buffer.from(result.body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    // 顶边是补出来的透明区
    expect(data[info.channels - 1]).toBe(0);

    /*
     * 判据是**横向占比守恒**：输入里前景横跨 360/400 = 90%，`contain` 之后仍应是 90%，
     * 而 `cover` 会把两侧连同前景一起裁掉，占比升到 100%（贴边）。
     * 不能改成「靠左某一列是否不透明」—— 那一列本来就是背景，前景居中占 90% 而非 100%。
     */
    const midRow = Math.floor(info.height / 2);
    let left = -1;
    let right = -1;
    for (let x = 0; x < info.width; x += 1) {
      const alpha = data[(midRow * info.width + x) * info.channels + info.channels - 1];
      if (alpha > 0) {
        if (left < 0) left = x;
        right = x;
      }
    }
    const span = (right - left + 1) / info.width;
    expect(span).toBeGreaterThan(0.85);
    expect(span).toBeLessThan(0.95);
  });

  /*
   * **已带 alpha 的图不再走色键**：那会把主体里恰好偏品红的像素打穿。
   * 生图当前不产出 alpha，但换模型后可能会 —— 这条是那时的保护。
   */
  it("已带 alpha 的图原样透传，不再抠", async () => {
    const transparent = new Uint8Array(
      await sharp({ create: { width: 200, height: 200, channels: 4, background: { r: 230, g: 150, b: 90, alpha: 0.5 } } }).png().toBuffer(),
    );
    const result = await cutoutSprite(transparent);
    expect(result.keyed).toBe(false);
    expect(result.residuePercent).toBe(0);
  });

  /*
   * 覆盖率不够说明这张不是品红底（模型没照指令画）。
   * **原样透传而不是硬抠**：硬抠会把主体上偏品红的部分打出洞，
   * 而带背景的立绘虽然观感差，至少是完整的。
   */
  it("不是品红底时原样透传并报 keyed=false", async () => {
    const whiteBacked = new Uint8Array(
      await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 250, g: 248, b: 240 } } }).png().toBuffer(),
    );
    const result = await cutoutSprite(whiteBacked);
    expect(result.keyed).toBe(false);
    expect(result.clearedPercent).toBeLessThan(MAGENTA_COVERAGE_MIN * 100);
  });

  /*
   * **羽化带要去溢色**（6.1 实测约束 2）：不做的话过渡带残留品红，
   * **叠在绿色草地上是最刺眼的组合** —— 品红与草绿接近互补色。
   *
   * 造一条半混品红的边：抠完后它的红蓝通道应被拉回，不该还是粉的。
   */
  it("羽化带的品红溢色被拉回", async () => {
    // 一整片「半品红」（品红度落在羽化带内）
    const spill = { r: 200, g: 130, b: 200 };
    expect(magentaness(spill.r, spill.g, spill.b)).toBeGreaterThanOrEqual(KEY_OPAQUE_BELOW);
    expect(magentaness(spill.r, spill.g, spill.b)).toBeLessThanOrEqual(KEY_CLEAR_ABOVE);

    const canvas = new Uint8Array(
      await sharp({ create: { width: 200, height: 200, channels: 3, background: { r: 255, g: 0, b: 255 } } })
        .composite([{ input: await sharp({ create: { width: 60, height: 60, channels: 3, background: spill } }).png().toBuffer(), gravity: "center" }])
        .png()
        .toBuffer(),
    );
    const result = await cutoutSprite(canvas);
    const { data, info } = await sharp(Buffer.from(result.body)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const offset = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    const level = magentaness(data[offset], data[offset + 1], data[offset + 2]);
    // 去溢色后品红度必须掉下来 —— 原值 70，按 0.8 系数拉回后应接近 0 甚至为负
    expect(level).toBeLessThan(KEY_OPAQUE_BELOW);
  });

  /** 残留统计给出百分比，供调用方判断要不要提示重画 */
  it("干净的图残留接近 0", async () => {
    const result = await cutoutSprite(await magentaCanvas());
    expect(result.residuePercent).toBeLessThan(0.1);
  });
});
