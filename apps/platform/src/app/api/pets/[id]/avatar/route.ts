import { NextResponse } from "next/server";
import sharp from "sharp";
import { z } from "zod";

import { assertTrustedOrigin } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { updatePetAvatar } from "@/server/platform-service";
import { inspectImage, objectStorage } from "@/server/storage";

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
