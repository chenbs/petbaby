import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { assertTrustedOrigin } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { saveRecordAttachment } from "@/server/daily-log-service";
import { AppError, routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import { inspectImage, objectStorage } from "@/server/storage";

/**
 * 上传一张记录附图（呕吐物、便便、皮肤、处方单）。
 *
 * **不进照片库**：存到 `private/<userId>/records/`，不会出现在时间线、年度短片或创作选图里。
 * 校验与主人照片同一套：魔数识别真实图片类型、2.5MB 与 4000 万像素上限。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let storageKey: string | undefined;
  try {
    assertTrustedOrigin(request);
    const { id } = await context.params;
    const petId = z.string().uuid().parse(id);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("record-upload:user", userId, 20, 60),
      enforceRateLimit("record-upload:ip", clientAddress(request), 40, 60),
    ]);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "请选择照片", 422);
    if (file.size <= 0 || file.size > 2_500_000) throw new AppError("FILE_SIZE_INVALID", "每张照片不能超过 2.5MB", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    const inspected = inspectImage(body, file.type);
    if (!inspected) throw new AppError("FILE_TYPE_INVALID", "仅支持真实的 JPG、PNG 或 WebP 图片", 415);
    const metadata = await sharp(body).metadata();
    if (!metadata.width || !metadata.height) throw new AppError("IMAGE_INVALID", "无法读取照片尺寸", 415);
    if (metadata.width * metadata.height > 40_000_000) throw new AppError("IMAGE_DIMENSIONS_TOO_LARGE", "照片像素过大，请压缩后上传", 413);
    storageKey = `private/${userId}/records/${crypto.randomUUID()}.${inspected.extension}`;
    await objectStorage.put(storageKey, body, inspected.mime);
    return NextResponse.json({ data: await saveRecordAttachment(userId, petId, { storageKey, mimeType: inspected.mime }) }, { status: 201 });
  } catch (error) {
    if (storageKey) {
      const rows = await (await getDatabase()).query("SELECT id FROM pet_record_attachments WHERE storage_key=$1", [storageKey]);
      if (!rows.length) await objectStorage.delete(storageKey).catch(() => undefined);
    }
    return routeError(error);
  }
}
