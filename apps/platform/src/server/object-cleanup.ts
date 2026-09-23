import "server-only";
import { getDatabase, inTransaction } from "@/server/db/client";
import { objectStorage } from "@/server/storage";

export async function queueObjectCleanup(storageKey: string, reason: string, photoId?: string) {
  const db = await getDatabase();
  const [job] = await db.query(
    `INSERT INTO object_cleanup_jobs (id,storage_key,reason,photo_id) VALUES ($1,$2,$3,$4)
     ON CONFLICT (storage_key) DO UPDATE SET reason=EXCLUDED.reason,photo_id=coalesce(EXCLUDED.photo_id,object_cleanup_jobs.photo_id),
       status='pending',next_attempt_at=now(),completed_at=NULL RETURNING id`,
    [crypto.randomUUID(), storageKey, reason, photoId || null],
  );
  return String(job.id);
}

export async function processObjectCleanupJob(id: string) {
  return inTransaction(async (db) => {
    const [job] = await db.query("SELECT * FROM object_cleanup_jobs WHERE id=$1 AND status='pending' AND next_attempt_at<=now() FOR UPDATE SKIP LOCKED", [id]);
    if (!job) return "skipped" as const;
    const key = String(job.storage_key);
    // 只处理已登记的对象；绝不凭对象年龄猜测可删除性。
    const used = await db.query(
      `SELECT 1 FROM photos WHERE storage_key=$1 AND deleted_at IS NULL
       UNION ALL SELECT 1 FROM owner_photos WHERE storage_key=$1 AND deleted_at IS NULL
       UNION ALL SELECT 1 FROM pets WHERE avatar_key=$1 AND deleted_at IS NULL
       UNION ALL SELECT 1 FROM works WHERE (output_key=$1 OR preview_key=$1) AND deleted_at IS NULL
       UNION ALL SELECT 1 FROM photo_deliverable_assets a JOIN pets p ON p.id=a.pet_id WHERE a.storage_key=$1 AND p.deleted_at IS NULL
         AND ((a.kind='work' AND EXISTS(SELECT 1 FROM works w WHERE w.id=a.resource_id AND w.deleted_at IS NULL))
           OR (a.kind='interactive' AND EXISTS(SELECT 1 FROM interactive_sessions s WHERE s.id=a.resource_id))
           OR (a.kind='memorial' AND EXISTS(SELECT 1 FROM memorial_spaces m WHERE m.id=a.resource_id AND m.deleted_at IS NULL))) LIMIT 1`, [key],
    );
    if (used.length) {
      await db.query("UPDATE object_cleanup_jobs SET status='protected',last_error='OBJECT_STILL_REFERENCED' WHERE id=$1", [id]);
      return "protected" as const;
    }
    try {
      await objectStorage.delete(key);
    } catch {
      const attempts = Number(job.attempts) + 1;
      const delaySeconds = Math.min(86_400, 30 * 2 ** Math.min(attempts - 1, 12));
      // 不将供应商异常全文落库（可能含签名 URL 或凭据）。
      await db.query("UPDATE object_cleanup_jobs SET attempts=$2,last_error='STORAGE_DELETE_FAILED',next_attempt_at=now()+$3::int*interval '1 second' WHERE id=$1", [id, attempts, delaySeconds]);
      return "pending" as const;
    }
    await db.query("UPDATE object_cleanup_jobs SET status='completed',attempts=attempts+1,last_error=NULL,completed_at=now() WHERE id=$1", [id]);
    return "completed" as const;
  });
}

export async function processObjectCleanupJobs(limit = 100) {
  const db = await getDatabase();
  const jobs = await db.query("SELECT id FROM object_cleanup_jobs WHERE status='pending' AND next_attempt_at<=now() ORDER BY next_attempt_at,id LIMIT $1", [limit]);
  let completed = 0;
  for (const job of jobs) if (await processObjectCleanupJob(String(job.id)) === "completed") completed++;
  return { examined: jobs.length, completed };
}

export async function compensateUpload(storageKey: string) {
  const id = await queueObjectCleanup(storageKey, "upload_not_committed");
  await processObjectCleanupJob(id);
}
