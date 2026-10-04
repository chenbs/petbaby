import sharp from "sharp";

import { getImageTemplate } from "@/server/image-template-registry";
import { objectStorage } from "@/server/storage";

/**
 * 模板公开样片。存储里是 WebP；`?format=jpeg` 转成 JPEG 输出 ——
 * 小程序 <image> 默认不解 WebP（真机不显示、模拟器正常），如果我是人 40 款没有端上 manifest 映射，
 * 只能走这个地址，所以端上统一带 format=jpeg。Web 端不带参数，仍直出原文件。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const template = getImageTemplate(id);
  if (!template?.sampleStorageKey) return new Response("Not found", { status: 404 });
  const object = await objectStorage.get(template.sampleStorageKey);
  if (!object) return new Response("Not found", { status: 404 });
  const headers = { "Cache-Control": "public, max-age=86400, immutable" };
  if (new URL(request.url).searchParams.get("format") === "jpeg" && object.contentType !== "image/jpeg") {
    const jpeg = await sharp(Buffer.from(object.body)).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
    return new Response(new Uint8Array(jpeg), { headers: { ...headers, "Content-Type": "image/jpeg" } });
  }
  return new Response(Buffer.from(object.body), { headers: { ...headers, "Content-Type": object.contentType } });
}
