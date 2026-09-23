import "server-only";
import { preservePhotoDeliverables } from "@/server/photo-deliverable-assets";
import { z } from "zod";
import type { Photo } from "@/domain/models";
import { batchPhotoMetadataSchema, photoMetadataSchema, photoPageSchema } from "@/domain/photo-memory";
import { getDatabase, inTransaction, type Database, type SqlRow } from "@/server/db/client";
import { mapPhoto } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { queueObjectCleanup, processObjectCleanupJob } from "@/server/object-cleanup";

export type SavePhotoInput = {
  petId: string; filename: string; mimeType: string; size: number; storageKey: string;
  quality?: "clear" | "blurry"; shotAt?: Date; uploadRequestId?: string; contentSha256?: string;
  entry?: "create" | "photos" | "index" | "pets" | "timeline" | "me";
};
export type UploadReceipt = { status: "saved"; photo: Photo } | { status: "deleted"; photoId: string };

export async function requirePhotoPet(userId: string, petId: string, db?: Database, lock = false) {
  const database = db || await getDatabase();
  const [pet] = await database.query(`SELECT * FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL${lock ? " FOR UPDATE" : ""}`, [petId, userId]);
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在，请重新选择", 404);
  return pet;
}

function receipt(row: SqlRow): UploadReceipt {
  return row.deleted_at ? { status: "deleted", photoId: String(row.id) } : { status: "saved", photo: mapPhoto(row) };
}

async function requestRow(userId: string, requestId: string, db: Database) {
  const [row] = await db.query(
    "SELECT ph.* FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.user_id=$1 AND ph.upload_request_id=$2 AND p.user_id=$1 AND p.deleted_at IS NULL", [userId, requestId],
  );
  return row;
}

export async function getUploadReceipt(userId: string, requestId: string): Promise<UploadReceipt> {
  const row = await requestRow(userId, z.string().uuid().parse(requestId), await getDatabase());
  if (!row) throw new AppError("NOT_FOUND", "尚未找到这次上传的保存结果", 404);
  return receipt(row);
}

export async function findUploadReplay(userId: string, input: Pick<SavePhotoInput, "petId" | "uploadRequestId" | "contentSha256">, db?: Database) {
  if (!input.uploadRequestId) return undefined;
  const row = await requestRow(userId, input.uploadRequestId, db || await getDatabase());
  if (!row) return undefined;
  if (row.pet_id !== input.petId || row.content_sha256 !== input.contentSha256) {
    throw new AppError("UPLOAD_REQUEST_CONFLICT", "这次上传编号已经用于另一张照片或宠物，请重新选择", 409);
  }
  return receipt(row);
}

export async function savePhotoWithReceipt(userId: string, input: SavePhotoInput) {
  return inTransaction(async (db) => {
    await requirePhotoPet(userId, input.petId, db, true);
    const replay = await findUploadReplay(userId, input, db);
    if (replay) {
      const originalKey = replay.status === "saved" ? replay.photo.storageKey : undefined;
      if (originalKey !== input.storageKey) await queueObjectCleanup(input.storageKey, "upload_replay");
      return { created: false, receipt: replay };
    }
    const [row] = await db.query(
      `INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at,upload_request_id,content_sha256)
       VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT coalesce(max(position),-1)+1 FROM photos WHERE pet_id=$3 AND deleted_at IS NULL),$8,$9,now(),$10,$11)
       ON CONFLICT (user_id,upload_request_id) DO NOTHING RETURNING *`,
      [crypto.randomUUID(), userId, input.petId, input.filename, input.mimeType, input.size, input.storageKey, input.quality || "unknown", input.shotAt || null, input.uploadRequestId || null, input.contentSha256 || null],
    );
    if (!row) {
      const concurrent = await findUploadReplay(userId, input, db);
      if (!concurrent) throw new AppError("UPLOAD_PENDING", "上传结果待核对，请稍后查询", 503);
      await queueObjectCleanup(input.storageKey, "upload_race");
      return { created: false, receipt: concurrent };
    }
    const photo = mapPhoto(row);
    if (input.contentSha256) {
      const [duplicate] = await db.query("SELECT id FROM photos WHERE user_id=$1 AND pet_id=$2 AND content_sha256=$3 AND id<>$4 AND deleted_at IS NULL ORDER BY created_at,id LIMIT 1", [userId, input.petId, input.contentSha256, photo.id]);
      if (duplicate) photo.duplicatePhotoId = String(duplicate.id);
    }
    // 业务事实和记录同事务，只在首次插入发出，不从客户端计数。
    await db.query("INSERT INTO events (id,user_id,name,metadata,created_at) VALUES ($1,$2,'upload_completed',$3::jsonb,now())", [crypto.randomUUID(), userId, JSON.stringify({ photoId: photo.id, petId: input.petId, uploadRequestId: input.uploadRequestId, entry: input.entry || "create" })]);
    return { created: true, receipt: { status: "saved", photo } as UploadReceipt };
  });
}

export async function savePhoto(userId: string, input: SavePhotoInput): Promise<Photo> {
  const result = await savePhotoWithReceipt(userId, input);
  if (result.receipt.status === "deleted") throw new AppError("PHOTO_DELETED", "这次上传的照片已被移除", 410);
  return result.receipt.photo;
}

export async function listPhotos(userId: string, petId?: string) {
  const db = await getDatabase();
  if (petId) await requirePhotoPet(userId, petId, db);
  const rows = await db.query(
    `SELECT ph.* FROM photos ph JOIN pets p ON p.id=ph.pet_id
     WHERE ph.user_id=$1 AND p.user_id=$1 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
     ${petId ? "AND ph.pet_id=$2 ORDER BY ph.position,ph.created_at,ph.id" : "ORDER BY ph.created_at DESC,ph.id DESC"}`, petId ? [userId, petId] : [userId],
  );
  return rows.map(mapPhoto);
}

export async function getPhoto(userId: string, id: string): Promise<Photo> {
  const [row] = await (await getDatabase()).query("SELECT ph.* FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.id=$1 AND ph.user_id=$2 AND p.user_id=$2 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL", [id, userId]);
  if (!row) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
  return mapPhoto(row);
}

const cursorSchema = z.object({
  userId: z.string().uuid(), petId: z.string().uuid(), order: z.enum(["library", "uploaded", "recorded"]), direction: z.enum(["asc", "desc"]),
  id: z.string().uuid(), created: z.string().datetime({ precision: 6 }), position: z.number().int(), date: z.string().date(),
}).strict();

export type PhotoPage = { items: Photo[]; totalCount: number; nextCursor: string | null };

export async function listPhotoPage(userId: string, input: unknown): Promise<PhotoPage> {
  return queryPhotoPage(userId, photoPageSchema.parse(input));
}

/** 旧内部时间线允许 500；HTTP 新分页仍最高 100，不互相截断。 */
export async function listTimelinePhotos(userId: string, petId: string, input: { order: "asc" | "desc"; limit: number; pageSize?: number; cursor?: string }) {
  const size = input.pageSize === undefined ? z.number().int().min(1).max(500).parse(input.limit) : z.number().int().min(1).max(100).parse(input.pageSize);
  return queryPhotoPage(userId, { petId: z.string().uuid().parse(petId), order: "recorded", direction: input.order, pageSize: size, cursor: input.cursor });
}

async function queryPhotoPage(userId: string, options: z.infer<typeof photoPageSchema>): Promise<PhotoPage> {
  const db = await getDatabase();
  await requirePhotoPet(userId, options.petId, db);
  const direction = options.direction || (options.order === "library" ? "asc" : "desc");
  let cursor: z.infer<typeof cursorSchema> | undefined;
  if (options.cursor) {
    try {
      cursor = cursorSchema.parse(JSON.parse(Buffer.from(options.cursor, "base64url").toString("utf8")));
      if (cursor.userId !== userId || cursor.petId !== options.petId || cursor.order !== options.order || cursor.direction !== direction) throw new Error("mismatch");
    } catch { throw new AppError("PHOTO_CURSOR_INVALID", "列表已变化，请重新加载", 422); }
  }
  // 使用服务端现有本地日语义；仅本查询传时区，不修改全仓/数据库时区。
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const params: unknown[] = [userId, options.petId, timezone];
  const dateSql = "coalesce(ph.memory_date,(coalesce(ph.shot_at,ph.created_at) AT TIME ZONE $3)::date)";
  const keys = options.order === "library" ? "ph.position,ph.created_at,ph.id" : options.order === "uploaded" ? "ph.created_at,ph.id" : `${dateSql},ph.created_at,ph.id`;
  let after = "";
  if (cursor) {
    const values = options.order === "library" ? [cursor.position, cursor.created, cursor.id] : options.order === "uploaded" ? [cursor.created, cursor.id] : [cursor.date, cursor.created, cursor.id];
    const types = options.order === "library" ? ["int", "timestamptz", "uuid"] : options.order === "uploaded" ? ["timestamptz", "uuid"] : ["date", "timestamptz", "uuid"];
    const placeholders = values.map((value, index) => { params.push(value); return `$${params.length}::${types[index]}`; });
    after = `AND (${keys}) ${direction === "asc" ? ">" : "<"} (${placeholders.join(",")})`;
  }
  params.push(options.pageSize + 1);
  // keys 中表达式包含逗号，不能 split(',') 拼 ORDER BY。
  const suffix = direction === "asc" ? "ASC" : "DESC";
  const ordering = options.order === "library" ? `ph.position ${suffix},ph.created_at ${suffix},ph.id ${suffix}` : options.order === "uploaded" ? `ph.created_at ${suffix},ph.id ${suffix}` : `${dateSql} ${suffix},ph.created_at ${suffix},ph.id ${suffix}`;
  const rows = await db.query(
    `SELECT ph.*,to_char(ph.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') cursor_created,${dateSql} cursor_date
     FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.user_id=$1 AND ph.pet_id=$2 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
     ${after} ORDER BY ${ordering} LIMIT $${params.length}`, params,
  );
  const [count] = await db.query("SELECT count(*)::int total FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.user_id=$1 AND ph.pet_id=$2 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL", [userId, options.petId]);
  const items = rows.slice(0, options.pageSize).map(mapPhoto);
  const last = rows[options.pageSize - 1];
  const nextCursor = rows.length > options.pageSize ? Buffer.from(JSON.stringify({
    userId, petId: options.petId, order: options.order, direction, id: last.id,
    created: last.cursor_created, position: Number(last.position), date: items[items.length - 1].recordedDate,
  })).toString("base64url") : null;
  return { items, totalCount: Number(count.total), nextCursor };
}

async function updateMetadata(userId: string, id: string, data: z.infer<typeof photoMetadataSchema>, db: Database) {
  const fields = ["metadata_version=metadata_version+1", "metadata_updated_at=now()"];
  const params: unknown[] = [id, userId, data.version];
  for (const [column, value, type] of [["memory_date", data.memoryDate, "date"], ["caption", data.caption, "text"], ["tags", data.tags, "jsonb"]] as const) {
    if (value === undefined) continue;
    params.push(column === "tags" ? JSON.stringify(value) : value);
    fields.push(`${column}=$${params.length}::${type}`);
  }
  const [row] = await db.query(`UPDATE photos SET ${fields.join(",")} WHERE id=$1 AND user_id=$2 AND metadata_version=$3 AND deleted_at IS NULL AND EXISTS(SELECT 1 FROM pets WHERE pets.id=photos.pet_id AND pets.deleted_at IS NULL) RETURNING *`, params);
  if (!row) {
    await getPhoto(userId, id);
    throw new AppError("PHOTO_VERSION_CONFLICT", "这张照片已在别处更新，请重新加载后再修改", 409);
  }
  const photo = mapPhoto(row);
  await db.query("INSERT INTO events (id,user_id,name,metadata,created_at) VALUES ($1,$2,'photo_metadata_saved',$3::jsonb,now())", [crypto.randomUUID(), userId, JSON.stringify({ photoId: id, version: photo.metadataVersion, hasCaption: Boolean(photo.caption), dateSource: photo.memoryDateSource })]);
  return photo;
}

export async function updatePhotoMetadata(userId: string, id: string, input: unknown) {
  const data = photoMetadataSchema.parse(input);
  return inTransaction((db) => updateMetadata(userId, id, data, db));
}

export async function updateBatchPhotoMetadata(userId: string, petId: string, input: unknown) {
  const data = batchPhotoMetadataSchema.parse(input);
  return inTransaction(async (db) => {
    await requirePhotoPet(userId, petId, db, true);
    const photos = [];
    // 固定锁顺序，重叠批次不会以相反顺序持有照片锁。
    for (const item of [...data.photos].sort((a, b) => a.photoId.localeCompare(b.photoId))) {
      const photo = await getPhoto(userId, item.photoId);
      if (photo.petId !== petId) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
      photos.push(await updateMetadata(userId, item.photoId, { version: item.version, caption: data.caption, tags: data.tags }, db));
    }
    return photos;
  });
}

export async function updatePhotoOrder(userId: string, petId: string, photoIds: string[]) {
  return inTransaction(async (db) => {
    await requirePhotoPet(userId, petId, db, true);
    const rows = await db.query("SELECT id FROM photos WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL", [userId, petId]);
    const allowed = new Set(rows.map((row) => String(row.id)));
    if (new Set(photoIds).size !== photoIds.length || photoIds.length !== rows.length || photoIds.some((id) => !allowed.has(id))) throw new AppError("PHOTO_ORDER_INVALID", "照片顺序已变化，请重新加载", 422);
    for (const [position, id] of photoIds.entries()) await db.query("UPDATE photos SET position=$2 WHERE id=$1", [id, position]);
    return listPhotos(userId, petId);
  });
}

export async function deletePhoto(userId: string, id: string) {
  const jobIds = await inTransaction(async (db) => {
    const [owner] = await db.query("SELECT pet_id FROM photos WHERE id=$1 AND user_id=$2", [id, userId]);
    if (!owner) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
    await db.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL FOR UPDATE", [owner.pet_id, userId]);
    const [photo] = await db.query("SELECT ph.* FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.id=$1 AND ph.user_id=$2 AND p.user_id=$2 AND p.deleted_at IS NULL FOR UPDATE OF ph", [id, userId]);
    if (!photo) throw new AppError("NOT_FOUND", "没有找到这张照片", 404);
    if (photo.deleted_at) return [];
    const busy = await db.query(
      `SELECT id FROM generation_tasks WHERE user_id=$2 AND status IN ('queued','processing') AND photo_ids @> $3::jsonb
       UNION ALL SELECT id FROM ai_runs WHERE user_id=$2 AND status IN ('queued','processing','generating') AND photo_ids @> $3::jsonb
       UNION ALL SELECT r.id FROM video_renders r LEFT JOIN video_projects p ON p.id=r.project_id
         WHERE r.user_id=$2 AND r.status IN ('queued','processing','rendering') AND (p.photo_ids @> $3::jsonb OR r.config->'photoIds' @> $3::jsonb OR r.config->'snapshot'->'photoIds' @> $3::jsonb)
       UNION ALL SELECT id FROM pet_human_identities WHERE source_photo_id=$1 AND status='generating' LIMIT 1`, [id, userId, JSON.stringify([id])],
    );
    if (busy.length) throw new AppError("PHOTO_IN_USE", "有制作任务正在使用这张照片，请在任务完成或取消后再删除", 409);
    await preservePhotoDeliverables(userId, String(photo.pet_id), id, String(photo.storage_key));
    await db.query("UPDATE photos SET deleted_at=now() WHERE id=$1", [id]);
    const identities = await db.query("DELETE FROM pet_human_identities WHERE source_photo_id=$1 AND user_id=$2 RETURNING storage_key", [id, userId]);
    const jobs = [];
    for (const identity of identities) jobs.push(await queueObjectCleanup(String(identity.storage_key), "legacy_identity_deleted", id));
    jobs.push(await queueObjectCleanup(String(photo.storage_key), "photo_deleted", id));
    return jobs;
  });
  for (const jobId of jobIds) await processObjectCleanupJob(jobId);
  return { deleted: true };
}
