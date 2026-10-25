import "server-only";

import sharp from "sharp";

import { getDatabase, inTransaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { processObjectCleanupJob, queueObjectCleanup } from "@/server/object-cleanup";
import { deleteOwnerPhoto } from "@/server/owner-photo-service";
import { deletePhoto } from "@/server/photo-library-service";
import { objectStorage } from "@/server/storage";
import { PAGE_SIZE, type Page } from "./console";
import { toNumber } from "./sql";
import { setUserSuspension } from "./user-suspension";

/*
 * 运营后台「图片审核」（2026-10-26，迁移 0046）。
 *
 * 队列覆盖用户自己上传的四类图片：宠物照片、宠物头像、主人照片（人宠写真）、日常记录附图。
 * 生成结果不在这里 —— 它们是我们的模板产出，违规的源头是上传的原图。
 * 没有 upload_reviews 记录 = 待审核；移除时业务行随之删除，只在 upload_reviews 留下 removed 痕迹。
 */

export const UPLOAD_KINDS = ["photo", "avatar", "owner", "record"] as const;
export type UploadKind = (typeof UPLOAD_KINDS)[number];
export type UploadStatus = "pending" | "approved" | "removed";

export const UPLOAD_KIND_LABELS: Record<UploadKind, string> = { photo: "宠物照片", avatar: "宠物头像", owner: "主人照片", record: "记录附图" };

/** 四类上传的统一视图：(kind, id, storage_key, user_id, pet_name, created_at) */
const LIVE_UPLOADS = `
  SELECT 'photo'::text kind, ph.id, ph.storage_key, ph.user_id, p.name pet_name, ph.created_at
    FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.deleted_at IS NULL AND p.deleted_at IS NULL
  UNION ALL SELECT 'avatar', p.id, p.avatar_key, p.user_id, p.name, coalesce(p.avatar_updated_at, p.created_at)
    FROM pets p WHERE p.avatar_key IS NOT NULL AND p.deleted_at IS NULL
  UNION ALL SELECT 'owner', o.id, o.storage_key, o.user_id, NULL, o.created_at
    FROM owner_photos o WHERE o.deleted_at IS NULL
  UNION ALL SELECT 'record', a.id, a.storage_key, a.user_id, p.name, a.created_at
    FROM pet_record_attachments a JOIN pets p ON p.id=a.pet_id WHERE p.deleted_at IS NULL`;

export type UploadFilter = { status?: UploadStatus; kind?: UploadKind; userId?: string; page?: number };

export async function listUploads(filter: UploadFilter): Promise<Page<Record<string, unknown>>> {
  const database = await getDatabase();
  const page = Math.max(1, Math.floor(filter.page || 1));
  const pageSize = PAGE_SIZE * 2;
  const status = filter.status || "pending";
  const params = [filter.kind || null, filter.userId || null, pageSize, (page - 1) * pageSize];
  const rows = status === "removed"
    ? await database.query(
      `SELECT r.kind, NULL::uuid id, r.storage_key, r.user_id, NULL pet_name, r.reviewed_at created_at, r.status, r.reason, r.reviewed_at,
         u.display_name, u.admin_suspended_at, u.deleted_at user_deleted_at, count(*) OVER()::int total
       FROM upload_reviews r JOIN users u ON u.id=r.user_id
       WHERE r.status='removed' AND ($1::text IS NULL OR r.kind=$1) AND ($2::uuid IS NULL OR r.user_id=$2)
       ORDER BY r.reviewed_at DESC LIMIT $3 OFFSET $4`, params)
    : await database.query(
      `SELECT x.kind, x.id, x.storage_key, x.user_id, x.pet_name, x.created_at, r.status, r.reason, r.reviewed_at,
         u.display_name, u.admin_suspended_at, u.deleted_at user_deleted_at, count(*) OVER()::int total
       FROM (${LIVE_UPLOADS}) x
       JOIN users u ON u.id=x.user_id
       LEFT JOIN upload_reviews r ON r.storage_key=x.storage_key
       WHERE ($1::text IS NULL OR x.kind=$1) AND ($2::uuid IS NULL OR x.user_id=$2)
         AND ${status === "approved" ? "r.status='approved'" : "r.storage_key IS NULL"}
       ORDER BY x.created_at DESC LIMIT $3 OFFSET $4`, params);
  return { items: rows, total: toNumber(rows[0]?.total), page, pageSize };
}

/** 待审核数（侧栏角标与总览待处理）。被封禁、已注销账号的上传不计：那些账号已经处理过了。 */
export async function pendingUploadCount() {
  const [row] = await (await getDatabase()).query(
    `SELECT count(*)::int pending FROM (${LIVE_UPLOADS}) x JOIN users u ON u.id=x.user_id
     WHERE u.deleted_at IS NULL AND u.admin_suspended_at IS NULL AND NOT EXISTS(SELECT 1 FROM upload_reviews r WHERE r.storage_key=x.storage_key)`,
  );
  return toNumber(row?.pending);
}

async function findUpload(kind: UploadKind, id: string) {
  const rows = await (await getDatabase()).query<{ kind: UploadKind; id: string; storage_key: string; user_id: string }>(
    `SELECT kind, id, storage_key, user_id FROM (${LIVE_UPLOADS}) x WHERE kind=$1 AND id=$2`, [kind, id],
  );
  if (!rows[0]) throw new AppError("UPLOAD_NOT_FOUND", "图片不存在或已被删除", 404);
  return rows[0];
}

/** 后台看图。默认给 480px 缩略图（列表一页 40 张），full=true 给原图。 */
export async function getUploadImage(kind: UploadKind, id: string, full = false) {
  const upload = await findUpload(kind, id);
  const object = await objectStorage.get(upload.storage_key);
  if (!object) throw new AppError("UPLOAD_FILE_MISSING", "图片文件不存在", 404);
  if (full) return { body: Buffer.from(object.body), contentType: object.contentType };
  const body = await sharp(Buffer.from(object.body)).rotate().resize(480, 480, { fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  return { body, contentType: "image/webp" };
}

async function recordReview(actorId: string, upload: { kind: string; storage_key: string; user_id: string }, status: "approved" | "removed", reason: string | null) {
  await (await getDatabase()).query(
    `INSERT INTO upload_reviews (storage_key,kind,user_id,status,reason,reviewed_by,reviewed_at) VALUES ($1,$2,$3,$4,$5,$6,now())
     ON CONFLICT (storage_key) DO UPDATE SET status=EXCLUDED.status,reason=EXCLUDED.reason,reviewed_by=EXCLUDED.reviewed_by,reviewed_at=now()`,
    [upload.storage_key, upload.kind, upload.user_id, status, reason, actorId],
  );
}

async function audit(actorId: string, action: string, userId: string, metadata: Record<string, unknown>) {
  await (await getDatabase()).query(
    "INSERT INTO audit_logs (id,user_id,actor_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,$4,'upload',$5,$6::jsonb,now())",
    [crypto.randomUUID(), userId, actorId, action, String(metadata.id || userId), JSON.stringify(metadata)],
  );
}

/** 批量通过。不写审计：通过是常规动作，审核记录本身就是留痕。 */
export async function approveUploads(actorId: string, items: Array<{ kind: UploadKind; id: string }>) {
  let approved = 0;
  for (const item of items) {
    const upload = await findUpload(item.kind, item.id).catch(() => null);
    if (!upload) continue;
    await recordReview(actorId, upload, "approved", null);
    approved += 1;
  }
  return { approved };
}

/**
 * 移除违规图片：走各自的正常删除链路（照片要检查在途任务、对象进持久清理），再记 removed 与审计。
 * suspend=true 时同时封禁上传者（封禁会关闭全部公开分享）。
 */
export async function removeUpload(actorId: string, input: { kind: UploadKind; id: string; reason: string; suspend?: boolean }) {
  const upload = await findUpload(input.kind, input.id);
  if (upload.kind === "photo") await deletePhoto(upload.user_id, upload.id);
  else if (upload.kind === "owner") await deleteOwnerPhoto(upload.user_id, upload.id);
  else {
    const job = await inTransaction(async (db) => {
      if (upload.kind === "avatar") await db.query("UPDATE pets SET avatar_key=NULL,avatar_updated_at=now() WHERE id=$1 AND avatar_key=$2", [upload.id, upload.storage_key]);
      else await db.query("DELETE FROM pet_record_attachments WHERE id=$1", [upload.id]);
      return queueObjectCleanup(upload.storage_key, "moderation_removed");
    });
    await processObjectCleanupJob(job);
  }
  await recordReview(actorId, upload, "removed", input.reason);
  await audit(actorId, "upload_remove", upload.user_id, { id: upload.id, kind: upload.kind, reason: input.reason });
  if (input.suspend) await setUserSuspension(actorId, { action: "suspend", userId: upload.user_id, reason: input.reason });
  return { removed: true, suspended: Boolean(input.suspend) };
}
