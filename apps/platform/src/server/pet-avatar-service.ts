import "server-only";

import sharp from "sharp";

import { AppError } from "@/server/errors";
import { getPhoto } from "@/server/photo-library-service";
import { updatePetAvatar } from "@/server/platform-service";
import { objectStorage } from "@/server/storage";

/**
 * 用照片库里已收好的一张照片做头像（2026-10 新用户引导：建档后「上传一张照片做头像」）。
 *
 * 照片先走正常上传链路（幂等回执、魔数校验）进照片库，这里只把它**复制**成独立的 512px 头像对象，
 * 不让 `avatar_key` 直接指向照片原图：`updatePetAvatar` 换头像时会删除旧头像对象，
 * 共用 key 会把用户的原照一起删掉。照片必须属于这只宠物，跨用户 / 跨宠物 / 已删除一律 404。
 */
export async function setPetAvatarFromPhoto(userId: string, petId: string, photoId: string) {
  const photo = await getPhoto(userId, photoId);
  if (photo.petId !== petId) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
  const object = await objectStorage.get(photo.storageKey);
  if (!object) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
  const normalized = new Uint8Array(await sharp(Buffer.from(object.body)).rotate().resize(512, 512, { fit: "cover" }).webp({ quality: 82 }).toBuffer());
  const key = `private/${userId}/avatars/${crypto.randomUUID()}.webp`;
  await objectStorage.put(key, normalized, "image/webp");
  try {
    return await updatePetAvatar(userId, petId, key);
  } catch (error) {
    await objectStorage.delete(key).catch(() => undefined);
    throw error;
  }
}
