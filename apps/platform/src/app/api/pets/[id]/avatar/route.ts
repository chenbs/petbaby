import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { assertTrustedMutation, assertTrustedOrigin } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { setPetAvatarFromPhoto } from "@/server/pet-avatar-service";
import { updatePetAvatar } from "@/server/platform-service";
import { enforceRateLimit } from "@/server/risk/controls";
import { inspectImage, objectStorage } from "@/server/storage";

const photoBodySchema = z.object({ photoId: z.string().uuid() }).strict();

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  let key: string | undefined;
  try {
    assertTrustedOrigin(request);
    const userId = await requireUserId(request);
    const { id } = await context.params;
    const file = (await request.formData()).get("file");
    if (!(file instanceof File)) throw new AppError("FILE_REQUIRED", "请选择头像", 422);
    if (file.size <= 0 || file.size > 5_000_000) throw new AppError("FILE_SIZE_INVALID", "头像不能超过 5MB", 413);
    const body = new Uint8Array(await file.arrayBuffer());
    if (!inspectImage(body, file.type)) throw new AppError("FILE_TYPE_INVALID", "仅支持 JPG、PNG 或 WebP", 415);
    const normalized = new Uint8Array(await sharp(body).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toBuffer());
    key = `private/${userId}/avatars/${crypto.randomUUID()}.webp`;
    await objectStorage.put(key, normalized, "image/webp");
    return NextResponse.json({ data: await updatePetAvatar(userId, z.string().uuid().parse(id), key) });
  } catch (error) {
    if (key) await objectStorage.delete(key).catch(() => undefined);
    return routeError(error);
  }
}

/**
 * 用照片库里已收好的一张照片做头像（JSON：{ photoId }）。
 * 新用户建档后的「上传一张照片做头像」走这里：照片先经 /api/uploads 进照片库，再设为头像，不另传一份文件。
 */
export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await enforceRateLimit("pet-avatar", userId, 20, 60);
    const { id } = await context.params;
    const { photoId } = photoBodySchema.parse(await request.json());
    return NextResponse.json({ data: await setPetAvatarFromPhoto(userId, z.string().uuid().parse(id), photoId) });
  } catch (error) { return routeError(error); }
}
