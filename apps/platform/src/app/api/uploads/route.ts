import { NextResponse } from "next/server";
import { z } from "zod";
import { createHash } from "node:crypto";

import { requireUserId } from "@/server/auth/session";
import { routeError, AppError } from "@/server/errors";
import { readShotAt } from "@/server/media/exif";
import { findUploadReplay, getUploadReceipt, requirePhotoPet, savePhotoWithReceipt } from "@/server/photo-library-service";
import { compensateUpload } from "@/server/object-cleanup";
import { inspectImage, objectStorage } from "@/server/storage";
import { assertTrustedOrigin } from "@/server/auth/request-guard";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import sharp from "sharp";

const metadataSchema = z.object({
  petId: z.string().uuid(),
  filename: z.string().min(1).max(120),
  uploadRequestId: z.string().uuid().optional(),
  entry: z.enum(["create", "photos", "index", "me", "pets", "timeline"]).optional(),
});

export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    const requestId = z.string().uuid().parse(new URL(request.url).searchParams.get("requestId"));
    return NextResponse.json({ data: await getUploadReceipt(userId, requestId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}

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
    const metadata = metadataSchema.parse({ petId: form.get("petId"), filename: form.get("filename"), uploadRequestId: form.get("uploadRequestId") ?? undefined, entry: form.get("entry") ?? undefined });
    await requirePhotoPet(userId, metadata.petId);
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "请选择照片", 422);
    if (file.size <= 0 || file.size > 2_500_000) throw new AppError("FILE_SIZE_INVALID", "每张照片不能超过 2.5MB", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectImage(body, file.type);
    if (!inspected) throw new AppError("FILE_TYPE_INVALID", "仅支持真实的 JPG、PNG 或 WebP 图片", 415);
    const imageMetadata = await sharp(body).metadata().catch(() => { throw new AppError("IMAGE_INVALID", "无法读取照片，请重新选择", 415); });
    if (!imageMetadata.width || !imageMetadata.height) throw new AppError("IMAGE_INVALID", "无法读取照片尺寸", 415);
    if (imageMetadata.width * imageMetadata.height > 40_000_000) throw new AppError("IMAGE_DIMENSIONS_TOO_LARGE", "照片像素过大，请压缩后上传", 413);
    const contentSha256 = createHash("sha256").update(body).digest("hex");
    const replay = await findUploadReplay(userId, { ...metadata, contentSha256 });
    if (replay) return NextResponse.json({ data: replay.status === "saved" ? replay.photo : replay }, { status: 200 });
    storageKey = `private/${userId}/${crypto.randomUUID()}.${inspected.extension}`;
    await objectStorage.put(storageKey, body, inspected.mime);
    const quality = Math.min(imageMetadata.width, imageMetadata.height) < 720 ? "blurry" as const : "clear" as const;
    /*
     * 拍摄时间只从 EXIF 取，取不到就留空（列可空，读取侧回落到 created_at）。
     * 不要拿当前时间顶替：那会让「第 1 天」变成建档那天，成长时间线与年度视频里
     * 的日期全部失真，而且事后无法与真实拍摄时间区分。
     */
    const shotAt = readShotAt(imageMetadata.exif);
    const result = await savePhotoWithReceipt(userId, { ...metadata, mimeType: inspected.mime, size: body.byteLength, storageKey, quality, shotAt, contentSha256 });
    const saved = result.receipt;
    return NextResponse.json({ data: saved.status === "saved" ? saved.photo : saved }, { status: result.created ? 201 : 200 });
  } catch (error) {
    if (storageKey) {
      try { await compensateUpload(storageKey); }
      catch { console.error("UPLOAD_COMPENSATION_PENDING", storageKey); }
    }
    return routeError(error);
  }
}
