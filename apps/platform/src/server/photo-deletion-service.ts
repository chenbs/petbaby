import "server-only";
import { getDatabase, inTransaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { queueObjectCleanup, processObjectCleanupJob } from "@/server/object-cleanup";

export async function assertPetNotRendering(userId: string, petId: string) {
  const jobs = await (await getDatabase()).query(
    `SELECT id FROM generation_tasks WHERE user_id=$1 AND pet_id=$2 AND status IN ('queued','processing')
     UNION ALL SELECT id FROM ai_runs WHERE user_id=$1 AND pet_id=$2 AND status IN ('queued','processing','generating')
     UNION ALL SELECT r.id FROM video_renders r LEFT JOIN video_projects p ON p.id=r.project_id WHERE r.user_id=$1
       AND r.status IN ('queued','processing','rendering') AND (p.pet_id=$2 OR r.config->>'petId'=$3 OR r.config->'snapshot'->>'petId'=$3
         OR (r.config ? 'year' AND NOT r.config ? 'petId'))
     UNION ALL SELECT id FROM pet_human_identities WHERE user_id=$1 AND pet_id=$2 AND status='generating' LIMIT 1`, [userId, petId, petId],
  );
  if (jobs.length) throw new AppError("PHOTO_IN_USE", "有制作任务正在使用照片，请在任务完成或取消后再删除", 409);
}

/** 调用方持有宠物锁；软删和持久清理登记必须同事务提交。 */
export async function softDeletePetResources(userId: string, petId: string) {
  const db = await getDatabase();
  await assertPetNotRendering(userId, petId);
  const keys = await db.query(
    `SELECT storage_key FROM photos WHERE user_id=$1 AND pet_id=$2
     UNION SELECT avatar_key FROM pets WHERE id=$2 AND avatar_key IS NOT NULL
     UNION SELECT storage_key FROM pet_human_identities WHERE user_id=$1 AND pet_id=$2
     UNION SELECT storage_key FROM photo_deliverable_assets WHERE user_id=$1 AND pet_id=$2
     UNION SELECT output_key FROM works WHERE user_id=$1 AND pet_id=$2 AND output_key IS NOT NULL
     UNION SELECT preview_key FROM works WHERE user_id=$1 AND pet_id=$2 AND preview_key IS NOT NULL`, [userId, petId],
  );
  await db.query("UPDATE pets SET deleted_at=now(),is_default=false WHERE id=$1", [petId]);
  await db.query("UPDATE photos SET deleted_at=coalesce(deleted_at,now()) WHERE pet_id=$1", [petId]);
  await db.query("UPDATE works SET deleted_at=coalesce(deleted_at,now()),public=false,share_token=NULL WHERE pet_id=$1", [petId]);
  await db.query("UPDATE interactive_sessions SET revoked_at=now(),share_token=NULL WHERE pet_id=$1", [petId]);
  await db.query("UPDATE memorial_spaces SET deleted_at=coalesce(deleted_at,now()),visibility='private',share_token=NULL WHERE pet_id=$1", [petId]);
  await db.query("DELETE FROM pet_human_identities WHERE user_id=$1 AND pet_id=$2", [userId, petId]);
  const ids: string[] = [];
  for (const row of keys) ids.push(await queueObjectCleanup(String(row.storage_key), "pet_deleted"));
  return ids;
}

export async function deletePetWithCleanup(userId: string, petId: string) {
  const jobs = await inTransaction(async (db) => {
    const [pet] = await db.query("SELECT * FROM pets WHERE id=$1 AND user_id=$2 FOR UPDATE", [petId, userId]);
    if (!pet) throw new AppError("NOT_FOUND", "宠物档案不存在", 404);
    if (pet.deleted_at) return [];
    const ids = await softDeletePetResources(userId, petId);
    if (pet.is_default) await db.query("UPDATE pets SET is_default=true WHERE id=(SELECT id FROM pets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1)", [userId]);
    return ids;
  });
  for (const job of jobs) await processObjectCleanupJob(job);
  return { deleted: true };
}
