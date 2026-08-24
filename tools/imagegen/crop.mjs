/**
 * 比例裁切。
 *
 * 生图接口忽略 size 参数（实测请求 1024x1024 返回 1122x1402），而 UI 方案 2.5 要求
 * 严格固定比例，否则网格会参差。因此比例只能在本地强制：先按目标比例居中裁切，
 * 再缩到目标尺寸。宠物照片主体通常居中偏上，裁切锚点因此取上三分之一而非正中，
 * 避免竖图裁掉头部。
 */
import { createRequire } from "node:module";
import path from "node:path";

// sharp 是 apps/platform 的运行时依赖（生成器用它转 PNG），本工具复用同一份，
// 不再单独安装：ESM 不认 NODE_PATH，故用 createRequire 从该包解析。
const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

/** 既有 UI 素材比例，以及自有参考图库统一使用的竖版/横版尺寸。 */
export const RATIOS = {
  hero: { aspect: 16 / 10, width: 1600, height: 1000 },
  card: { aspect: 3 / 4, width: 900, height: 1200 },
  cover: { aspect: 4 / 3, width: 1600, height: 1200 },
  square: { aspect: 1, width: 1200, height: 1200 },
  source: { aspect: 3 / 4, width: 1200, height: 1600 },
  portrait: { aspect: 9 / 16, width: 720, height: 1280 },
  landscape: { aspect: 16 / 9, width: 1280, height: 720 }
};

/** 回读图片实际尺寸，用于生成完成后的硬校验。 */
export async function dimensions(input) {
  const meta = await sharp(input, { failOn: "error" }).metadata();
  if (!meta.width || !meta.height) throw new Error("读不到原图尺寸");
  return { width: meta.width, height: meta.height };
}

/**
 * 拒绝“容器与尺寸都合法，但画面是全黑/全白/纯色”的静默失败响应。
 * lingsuan 偶发返回全黑 PNG；只做 metadata 宽高校验会把它当成合格图片。
 */
export async function hasUsableVisualContent(input) {
  const stats = await sharp(input, { failOn: "error" }).stats();
  const colourChannels = stats.channels.slice(0, 3);
  if (!colourChannels.length) return false;
  const dynamicRange = Math.max(...colourChannels.map((channel) => channel.max))
    - Math.min(...colourChannels.map((channel) => channel.min));
  return stats.entropy > 0.05 && dynamicRange > 8;
}

/**
 * 按比例**留白装入**而不是裁切，多出来的边补全透明。
 *
 * 透明抠图素材（岛的立绘与物件）不能走 `fit()`：那个函数按目标比例求最大内接矩形后
 * 居中裁切，而立绘的验收标准是「全身完整不裁切，四周留出余量」（`24` 号文 2.4）——
 * 接口返回约 4:5 而目标是 3:4，裁切会削掉耳尖或爪子，正是要避免的。
 *
 * 补的边是**透明**而非白色：这批图后续要叠在场景上，白边会成为一圈可见的白框。
 *
 * @param {Buffer} input 原图（须已带 alpha，否则补的边在 JPG 下会变黑）
 * @param {keyof RATIOS} ratio 目标比例
 */
export async function pad(input, ratio) {
  const spec = RATIOS[ratio];
  if (!spec) throw new Error(`未知比例 ${ratio}`);
  return sharp(input, { failOn: "error" })
    .resize(spec.width, spec.height, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
}

/**
 * 图里是否有**有效**的 alpha —— 存在任何明显非不透明的像素。
 *
 * `metadata().hasAlpha` 单独不够用：PNG 带四通道但整层填满 255 时它也为真，
 * 而那正是接口「接受 `background=transparent` 却不生效」时的产物形态
 * （lingsuan 实测返 200、`hasAlpha=false`；换个模型也可能给出全不透明的 RGBA）。
 * 只看元数据会让透明底的失败静默通过，抠图阶段才发现底是实色。
 *
 * 阈值取 250 而非 255：PNG 编码在极端像素上有振铃（`upload-island.mjs` 的品红
 * 四角实测同一现象），要求严格等于 255 会把编码噪声当成透明。
 * 与 `server/island/cutout.ts` 的 `hasUsableAlpha` 同一口径。
 */
export async function hasAlpha(input) {
  const image = sharp(input, { failOn: "error" });
  const meta = await image.metadata();
  if (!meta.hasAlpha) return false;
  const { data, info } = await sharp(input, { failOn: "error" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  for (let offset = info.channels - 1; offset < data.length; offset += info.channels) {
    if (data[offset] < 250) return true;
  }
  return false;
}

/**
 * @param {Buffer} input 原图
 * @param {keyof RATIOS} ratio 目标比例
 * @param {{ anchor?: number, format?: "png"|"jpeg", quality?: number }} options
 *        anchor 0=顶部 0.5=居中，默认 1/3（宠物头部通常在上部）
 */
export async function fit(input, ratio, options = {}) {
  const spec = RATIOS[ratio];
  if (!spec) throw new Error(`未知比例 ${ratio}`);
  const anchor = options.anchor ?? 1 / 3;
  const format = options.format || "jpeg";

  const image = sharp(input, { failOn: "error" });
  const meta = await image.metadata();
  if (!meta.width || !meta.height) throw new Error("读不到原图尺寸");

  // 按目标比例求最大内接矩形
  const sourceAspect = meta.width / meta.height;
  const cropWidth = sourceAspect > spec.aspect ? Math.round(meta.height * spec.aspect) : meta.width;
  const cropHeight = sourceAspect > spec.aspect ? meta.height : Math.round(meta.width / spec.aspect);
  const left = Math.max(0, Math.round((meta.width - cropWidth) / 2));
  const top = Math.max(0, Math.min(meta.height - cropHeight, Math.round((meta.height - cropHeight) * anchor)));

  let pipeline = image
    .extract({ left, top, width: Math.min(cropWidth, meta.width - left), height: Math.min(cropHeight, meta.height - top) })
    .resize(spec.width, spec.height, { fit: "cover" });
  pipeline = format === "png" ? pipeline.png({ compressionLevel: 9 }) : pipeline.jpeg({ quality: options.quality ?? 82, mozjpeg: true });
  return pipeline.toBuffer();
}
