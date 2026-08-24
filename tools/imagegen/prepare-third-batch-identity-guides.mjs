/**
 * 为装饰艺术肖像准备无摄影纹理的身份导引图。
 *
 * 导引图只保留品种轮廓、耳形、口鼻比例与重点色分布；最终画风仍由效果参考图控制。
 */
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const REFERENCE_ROOT = path.join(import.meta.dirname, "out", "reference-v1");
const CANDIDATES = path.join(REFERENCE_ROOT, "candidates");
const OUT = path.join(REFERENCE_ROOT, "identity-guides");

await mkdir(OUT, { recursive: true });

const decorativeGuide = path.join(OUT, "decorative-art-portrait_ragdoll-cat_flat-guide_v01.png");
await sharp(path.join(CANDIDATES, "decorative-art-portrait_ragdoll-cat_9x16_v04.png"))
  .extract({ left: 155, top: 155, width: 545, height: 720 })
  .resize(720, 900, { fit: "contain", background: "#f6f2ed" })
  .blur(6)
  .modulate({ saturation: 0.45 })
  .png({ compressionLevel: 9, palette: true, colours: 5, dither: 0 })
  .toFile(decorativeGuide);

console.log(decorativeGuide);
