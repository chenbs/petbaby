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
