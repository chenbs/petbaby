/*
 * 把官网首页「作品样片」用到的已上线样片导出到 apps/website/public/assets/。
 *
 * 不生成新图：每一张都取自已经对外展示的公开样片（写真场景图、人宠/趣味模板的
 * 公开预览、人化效果图），导出前与 apps/platform/.data/objects 里的线上对象核对过
 * 字节一致。换图时改这里的清单并重跑，不要手工往 public/assets 里拷。
 *
 *   node tools/imagegen/export-website-gallery.mjs
 *
 * 输出统一为 720px 宽 JPEG：prepare-assets.mjs 只给 .jpg 生成多档 webp，
 * 而 ResponsiveImage 按固有宽度过滤 srcset，720 宽才能拿到 640w 一档供手机高清屏用。
 */
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(path.resolve(import.meta.dirname, "../../apps/platform/package.json"));
const sharp = require("sharp");

const OUT = path.resolve(import.meta.dirname, "out");
const TARGET = path.resolve(import.meta.dirname, "../../apps/website/public/assets");

/** 官网素材名 → 真源（相对 tools/imagegen/out/）。 */
const GALLERY = {
  "website-gallery-scene-watermelon": "scenes/scene-corgi-sweater-v14.jpg",
  "website-gallery-scene-fan": "scenes/scene-tennis-champion-v14.jpg",
  "website-gallery-scene-gift": "scenes/scene-sailboat-holiday-v14.jpg",
  "website-gallery-scene-beanie": "scenes/scene-shorthair-paper-bag-v14.jpg",
  "website-gallery-scene-basket": "scenes/scene-lakeside-sunset-v14.jpg",
  "website-gallery-duo-tulips": "reference-v1/public-previews/duo-tulips-lap_9x16_v01.webp",
  "website-gallery-duo-fly": "reference-v1/public-previews/duo-denim-fly_9x16_v01.webp",
  "website-gallery-duo-christmas": "reference-v1/public-previews/duo-christmas-kiss_9x16_v01.webp",
  "website-gallery-duo-nose": "reference-v1/public-previews/duo-caramel-nose_9x16_v01.webp",
  "website-gallery-duo-laugh": "reference-v1/public-previews/duo-monochrome-laugh_9x16_v01.webp",
  "website-gallery-human-31": "pet-human-v2/effects/31.webp",
  "website-gallery-human-05": "pet-human-v2/effects/5.webp",
  "website-gallery-human-08": "pet-human-v2/effects/8.webp",
  "website-gallery-human-32": "pet-human-v2/effects/32.webp",
  "website-gallery-human-15": "pet-human-v2/effects/15.webp",
  "website-gallery-fun-barista": "reference-v1/masters/pet-barista_shiba_9x16_v05.webp",
  "website-gallery-fun-selfie": "reference-v1/masters/travel-selfie_devon-kitten_9x16_v05.webp",
  "website-gallery-fun-coaster": "reference-v1/masters/roller-coaster_corgi_9x16_v01.webp",
  "website-gallery-fun-wanted": "reference-v1/masters/pet-wanted-poster_golden-retriever_9x16_v01.webp",
  "website-gallery-fun-faces": "reference-v1/masters/pet-expression-grid_cream-cat_9x16_v01.webp",
};

for (const [name, source] of Object.entries(GALLERY)) {
  const output = path.join(TARGET, `${name}.jpg`);
  const info = await sharp(path.join(OUT, source))
    .resize({ width: 720, withoutEnlargement: true })
    .jpeg({ quality: 82, mozjpeg: true })
    .toFile(output);
  console.log(`${name}.jpg  ${info.width}×${info.height}  ${Math.round(info.size / 1024)}KB`);
}
