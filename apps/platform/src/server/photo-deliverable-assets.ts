import "server-only";
import sharp from "sharp";
import { afterTransactionRollback, getDatabase, inTransaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";
import { compensateUpload } from "@/server/object-cleanup";

type AssetKind = "work" | "interactive" | "memorial";

/** 制作、删除使用相同锁顺序：宠物 → 按 ID 排序的照片。必须在事务中调用。 */
export async function lockPhotoInputs(userId: string, petId: string, photoIds: string[]) {
  const db = await getDatabase();
  const [pet] = await db.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [petId, userId]);
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在，请重新选择", 404);
  const photos = await db.query("SELECT * FROM photos WHERE id=ANY($1::uuid[]) AND user_id=$2 AND pet_id=$3 AND deleted_at IS NULL ORDER BY id FOR UPDATE", [photoIds, userId, petId]);
  if (photos.length !== photoIds.length) throw new AppError("PHOTO_PET_MISMATCH", "照片不存在、已删除或不属于当前宠物", 422);
  return photos;
}

/** 只保存展示用 JPEG，去掉 EXIF；原文件与记录正文从不进入公开出口。 */
export async function ensurePhotoDeliverableAsset(userId: string, petId: string, kind: AssetKind, resourceId: string, photoId: string) {
  return inTransaction(async (db) => {
    const [existing] = await db.query("SELECT storage_key FROM photo_deliverable_assets WHERE user_id=$1 AND kind=$2 AND resource_id=$3 AND photo_id=$4", [userId, kind, resourceId, photoId]);
    if (existing) return String(existing.storage_key);
    const [photo] = await lockPhotoInputs(userId, petId, [photoId]);
    const [raced] = await db.query("SELECT storage_key FROM photo_deliverable_assets WHERE kind=$1 AND resource_id=$2 AND photo_id=$3", [kind, resourceId, photoId]);
    if (raced) return String(raced.storage_key);
    const object = await objectStorage.get(String(photo.storage_key));
    if (!object) throw new AppError("PHOTO_OBJECT_MISSING", "作品封面暂时无法读取，请稍后再试", 409);
    const key = `private/${userId}/deliverables/${kind}/${resourceId}/${photoId}-${crypto.randomUUID()}.jpg`;
    const body = await sharp(Buffer.from(object.body)).rotate().resize({ width: 1200, height: 1200, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 85 }).toBuffer();
    afterTransactionRollback(() => compensateUpload(key));
    await objectStorage.put(key, body, "image/jpeg");
    await db.query("INSERT INTO photo_deliverable_assets (id,user_id,pet_id,photo_id,kind,resource_id,storage_key) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), userId, petId, photoId, kind, resourceId, key]);
    return key;
  });
}

/** 老作品在原照被删除前补齐独立资源；失败则保留原照，让用户重试。 */
export async function preservePhotoDeliverables(userId: string, petId: string, photoId: string, originalKey: string) {
  const db = await getDatabase();
  const references = await db.query(
    `SELECT 'work' kind,id FROM works WHERE user_id=$1 AND deleted_at IS NULL AND (photo_id=$2 OR preview_key=$4 OR output_key=$4)
     UNION ALL SELECT 'interactive',id FROM interactive_sessions WHERE user_id=$1 AND pet_id=$3 AND photo_ids @> $5::jsonb
     UNION ALL SELECT 'memorial',id FROM memorial_spaces WHERE user_id=$1 AND pet_id=$3 AND deleted_at IS NULL AND photo_ids @> $5::jsonb`,
    [userId, photoId, petId, originalKey, JSON.stringify([photoId])],
  );
  for (const ref of references) {
    const key = await ensurePhotoDeliverableAsset(userId, petId, ref.kind as AssetKind, String(ref.id), photoId);
    if (ref.kind === "work") {
      await db.query("UPDATE works SET preview_key=CASE WHEN preview_key=$2 THEN $3 ELSE preview_key END,output_key=CASE WHEN output_key=$2 THEN $3 ELSE output_key END WHERE id=$1", [ref.id, originalKey, key]);
      await db.query("UPDATE work_versions SET preview_key=CASE WHEN preview_key=$2 THEN $3 ELSE preview_key END,output_key=CASE WHEN output_key=$2 THEN $3 ELSE output_key END WHERE work_id=$1", [ref.id, originalKey, key]);
    }
  }
}
