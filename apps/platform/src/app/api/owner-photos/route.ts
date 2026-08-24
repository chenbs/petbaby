import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { assertTrustedOrigin } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";
import { listOwnerPhotos, saveOwnerPhoto } from "@/server/owner-photo-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import { inspectImage, objectStorage } from "@/server/storage";

const metadataSchema = z.object({
  filename: z.string().trim().min(1).max(120),
  authorizationConfirmed: z.literal("true"),
});

export async function GET(request: Request) {
  try {
    return NextResponse.json({ data: await listOwnerPhotos(await requireUserId(request)) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  let storageKey: string | undefined;
  try {
    assertTrustedOrigin(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("owner-upload:user", userId, 20, 60),
      enforceRateLimit("owner-upload:ip", clientAddress(request), 40, 60),
    ]);
    const form = await request.formData();
    const metadata = metadataSchema.parse({
      filename: form.get("filename"),
      authorizationConfirmed: form.get("authorizationConfirmed"),
    });
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "请选择主人照片", 422);
    if (file.size <= 0 || file.size > 2_500_000) throw new AppError("FILE_SIZE_INVALID", "每张照片不能超过 2.5MB", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectImage(body, file.type);
    if (!inspected) throw new AppError("FILE_TYPE_INVALID", "仅支持真实的 JPG、PNG 或 WebP 图片", 415);
    const imageMetadata = await sharp(body).metadata();
    if (!imageMetadata.width || !imageMetadata.height) throw new AppError("IMAGE_INVALID", "无法读取照片尺寸", 415);
    if (imageMetadata.width * imageMetadata.height > 40_000_000) throw new AppError("IMAGE_DIMENSIONS_TOO_LARGE", "照片像素过大，请压缩后上传", 413);
    storageKey = `private/${userId}/owner/${crypto.randomUUID()}.${inspected.extension}`;
    await objectStorage.put(storageKey, body, inspected.mime);
    const quality = Math.min(imageMetadata.width, imageMetadata.height) < 720 ? "blurry" as const : "clear" as const;
    const photo = await saveOwnerPhoto(userId, {
      filename: metadata.filename,
      mimeType: inspected.mime,
      size: body.byteLength,
      storageKey,
      quality,
    });
    return NextResponse.json({ data: photo }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      const rows = await (await getDatabase()).query("SELECT id FROM owner_photos WHERE storage_key=$1", [storageKey]);
      if (!rows.length) await objectStorage.delete(storageKey).catch(() => undefined);
    }
    return routeError(error);
  }
}
