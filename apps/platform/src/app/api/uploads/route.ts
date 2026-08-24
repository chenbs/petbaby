import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError, AppError } from "@/server/errors";
import { readShotAt } from "@/server/media/exif";
import { recordEvent, savePhoto } from "@/server/platform-service";
import { inspectImage, objectStorage } from "@/server/storage";
import { assertTrustedOrigin } from "@/server/auth/request-guard";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import sharp from "sharp";

const metadataSchema = z.object({
  petId: z.string().uuid(),
  filename: z.string().min(1).max(120),
});

export async function POST(request: Request) {
  let storageKey: string | undefined;
  try {
    assertTrustedOrigin(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("upload:user", userId, 40, 60),
      enforceRateLimit("upload:ip", clientAddress(request), 80, 60),
    ]);
    const form = await request.formData();
    const metadata = metadataSchema.parse({ petId: form.get("petId"), filename: form.get("filename") });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "请选择照片", 422);
    if (file.size <= 0 || file.size > 2_500_000) throw new AppError("FILE_SIZE_INVALID", "每张照片不能超过 2.5MB", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectImage(body, file.type);
    if (!inspected) throw new AppError("FILE_TYPE_INVALID", "仅支持真实的 JPG、PNG 或 WebP 图片", 415);
    const imageMetadata = await sharp(body).metadata();
    if (!imageMetadata.width || !imageMetadata.height) throw new AppError("IMAGE_INVALID", "无法读取照片尺寸", 415);
    if (imageMetadata.width * imageMetadata.height > 40_000_000) throw new AppError("IMAGE_DIMENSIONS_TOO_LARGE", "照片像素过大，请压缩后上传", 413);
    storageKey = `private/${userId}/${crypto.randomUUID()}.${inspected.extension}`;
    await objectStorage.put(storageKey, body, inspected.mime);
    const quality = Math.min(imageMetadata.width, imageMetadata.height) < 720 ? "blurry" as const : "clear" as const;
    /*
     * 拍摄时间只从 EXIF 取，取不到就留空（列可空，读取侧回落到 created_at）。
     * 不要拿当前时间顶替：那会让「第 1 天」变成建档那天，成长时间线与年度视频里
     * 的日期全部失真，而且事后无法与真实拍摄时间区分。
     */
    const shotAt = readShotAt(imageMetadata.exif);
    const photo = await savePhoto(userId, { ...metadata, mimeType: inspected.mime, size: body.byteLength, storageKey, quality, shotAt });
    await recordEvent(userId, "upload_completed");
    return NextResponse.json({ data: photo }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      const database = await getDatabase();
      const rows = await database.query("SELECT id FROM photos WHERE storage_key = $1", [storageKey]);
      if (!rows.length) await objectStorage.delete(storageKey);
    }
    return routeError(error);
  }
}
