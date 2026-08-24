import "server-only";

import { getDatabase } from "@/server/db/client";
import { mapOwnerPhoto } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

export async function listOwnerPhotos(userId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT * FROM owner_photos WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC",
    [userId],
  );
  return rows.map(mapOwnerPhoto);
}

export async function saveOwnerPhoto(userId: string, input: {
  filename: string;
  mimeType: string;
  size: number;
  storageKey: string;
  quality: "clear" | "blurry";
}) {
  const id = crypto.randomUUID();
  const now = new Date();
  const rows = await (await getDatabase()).query(
    "INSERT INTO owner_photos (id,user_id,filename,mime_type,size,storage_key,quality,authorization_confirmed_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$8) RETURNING *",
    [id, userId, input.filename, input.mimeType, input.size, input.storageKey, input.quality, now],
  );
  return mapOwnerPhoto(rows[0]);
}

export async function getOwnerPhotoObject(userId: string, id: string) {
  const rows = await (await getDatabase()).query(
    "SELECT storage_key,mime_type FROM owner_photos WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [id, userId],
  );
  if (!rows[0]) throw new AppError("OWNER_PHOTO_NOT_FOUND", "主人照片不存在", 404);
  const storageKey = String(rows[0].storage_key);
  if (!storageKey.startsWith(`private/${userId}/owner/`)) throw new AppError("OWNER_PHOTO_NOT_FOUND", "主人照片不存在", 404);
  const object = await objectStorage.get(storageKey);
  if (!object) throw new AppError("OWNER_PHOTO_FILE_MISSING", "主人照片文件不存在，请重新上传", 404);
  return object;
}

export async function deleteOwnerPhoto(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query(
    "UPDATE owner_photos SET deleted_at=now() WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL RETURNING storage_key",
    [id, userId],
  );
  if (!rows[0]) throw new AppError("OWNER_PHOTO_NOT_FOUND", "主人照片不存在", 404);
  await objectStorage.delete(String(rows[0].storage_key)).catch(() => undefined);
  return { deleted: true };
}
