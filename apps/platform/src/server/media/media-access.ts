import "server-only";

import { getDatabase } from "@/server/db/client";

/** 对象键字符白名单，与 LocalObjectStorage.safePath 同一套，顺带挡掉 ../ 穿越。 */
export const MEDIA_KEY_PATTERN = /^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/;

/**
 * `/api/media/*` 的归属校验：本人的照片、头像、作品预览、已解锁作品原图与交付物。
 * 锁定作品的原图（output_key 且 locked=true）不放行；已删除照片的键即使仍被作品引用也不放行。
 * `/api/media` 与预签名直连（media/direct-links.ts）共用这一份，两处口径不能分叉。
 */
export async function canReadMediaKey(userId: string, key: string) {
  if (!MEDIA_KEY_PATTERN.test(key)) return false;
  const rows = await (await getDatabase()).query(
    `SELECT ph.id FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.storage_key=$1 AND ph.user_id=$2 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
     UNION SELECT p.id FROM pets p WHERE p.avatar_key=$1 AND p.user_id=$2 AND p.deleted_at IS NULL
       AND NOT EXISTS(SELECT 1 FROM photos ph WHERE ph.storage_key=$1 AND ph.deleted_at IS NOT NULL)
     UNION SELECT w.id FROM works w JOIN pets p ON p.id=w.pet_id WHERE w.user_id=$2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL
       AND (w.preview_key=$1 OR (w.output_key=$1 AND w.locked=false))
       AND NOT EXISTS(SELECT 1 FROM photos ph WHERE ph.storage_key=$1)
     UNION SELECT a.id FROM photo_deliverable_assets a JOIN works w ON a.kind='work' AND w.id=a.resource_id JOIN pets p ON p.id=w.pet_id
       WHERE a.storage_key=$1 AND a.user_id=$2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL`, [key, userId],
  );
  return rows.length > 0;
}
