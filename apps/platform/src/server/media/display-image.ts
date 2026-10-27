import "server-only";

import sharp from "sharp";

import type { StoredObject } from "@/server/storage/types";

/*
 * 界面展示用的小图（2026-10-27）。
 *
 * 作品原图是 1–2MB 的 PNG，服务器出网带宽有限，列表和详情页逐张下载要好几秒。
 * 小程序展示时带 `?display=1`，这里把图缩到长边不超过 1440、宽不超过 1080 的 JPEG（通常 100–250KB）。
 * 「保存原图」走 /api/works/[id]/download 等独立出口，仍是原文件，不受影响。
 *
 * - **隐式 AI 标识要跟过去**：原图里的 EXIF（`applyAiMetadata` 写的 IFD0）用 keepExif 保留；
 *   rotate() 已按方向转正，sharp 会去掉 Orientation，避免二次旋转。
 * - **缓存只在进程内**：对象键带 uuid、内容不可变，按键缓存即可；鉴权在路由里先做，缓存命中也过不了归属校验这一关。
 *   不落对象存储，免得删除作品时还要追着清理派生文件。
 */
const DISPLAY_WIDTH = 1080;
const DISPLAY_HEIGHT = 1440;
const CACHE_LIMIT_BYTES = 48 * 1024 * 1024;

const RESIZABLE = /^image\/(png|jpeg|webp|svg\+xml)$/;

const cache = new Map<string, Buffer>();
let cachedBytes = 0;

function remember(key: string, body: Buffer) {
  if (body.byteLength > CACHE_LIMIT_BYTES / 8) return;
  cache.set(key, body);
  cachedBytes += body.byteLength;
  for (const [oldest, value] of cache) {
    if (cachedBytes <= CACHE_LIMIT_BYTES) break;
    cache.delete(oldest);
    cachedBytes -= value.byteLength;
  }
}

export function canDisplayResize(contentType: string) {
  return RESIZABLE.test(contentType);
}

export async function displayImage(key: string, object: StoredObject): Promise<Buffer> {
  const hit = cache.get(key);
  if (hit) {
    // 命中后挪到队尾，按最近使用淘汰
    cache.delete(key);
    cache.set(key, hit);
    return hit;
  }
  const body = await sharp(Buffer.from(object.body))
    .rotate()
    .resize(DISPLAY_WIDTH, DISPLAY_HEIGHT, { fit: "inside", withoutEnlargement: true })
    .flatten({ background: "#FFFFFF" })
    .keepExif()
    .jpeg({ quality: 82, mozjpeg: true })
    .toBuffer();
  remember(key, body);
  return body;
}
