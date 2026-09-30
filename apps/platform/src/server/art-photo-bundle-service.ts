import "server-only";

import { z } from "zod";
import type { Database, SqlRow } from "@/server/db/client";
import { getDatabase, inTransaction } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { buildPetArtPhotoPrompt, petArtPhotoScenes, PET_ART_PHOTO_SCENE_IDS, PET_ART_PHOTO_TEMPLATE_ID, PET_ART_PHOTO_VERSION, type PetArtPhotoSceneId } from "@/domain/pet-art-photo";

export const ART_PHOTO_BUNDLE_PACKAGES = {
  ten: { count: 10, amount: 9.9, sku: "pet-art-photo-bundle-10" },
  all: { count: 24, amount: 19.9, sku: "pet-art-photo-bundle-24" },
} as const;

const sceneIdSchema = z.enum(PET_ART_PHOTO_SCENE_IDS);
const createInputSchema = z.object({
  package: z.enum(["ten", "all"]),
  petId: z.string().uuid(),
  photoId: z.string().uuid(),
  sceneIds: z.array(sceneIdSchema).min(1).max(24),
  idempotencyKey: z.string().min(8).max(120),
});

function mapBatch(row: SqlRow, items: SqlRow[], order: SqlRow) {
  return {
    id: String(row.id), userId: String(row.user_id), petId: String(row.pet_id), photoId: String(row.photo_id),
    package: String(row.package) as "ten" | "all", totalCount: Number(row.total_count), status: String(row.status),
    completedCount: Number(row.completed_count || 0), failedCount: Number(row.failed_count || 0),
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at)).toISOString(),
    order: { id: String(order.id), status: String(order.status), amount: Number(order.amount), sku: String(order.sku) },
    items: items.map((item) => ({
      id: String(item.id), sceneId: String(item.scene_id) as PetArtPhotoSceneId, title: petArtPhotoScenes.find((scene) => scene.id === item.scene_id)?.title || String(item.scene_id), position: Number(item.position),
      status: String(item.status), errorCode: item.error_code ? String(item.error_code) : undefined,
    })),
  };
}

async function readBatch(database: Database, userId: string, batchId: string, lock = false) {
  const rows = await database.query(`SELECT * FROM art_photo_batches WHERE id=$1 AND user_id=$2${lock ? " FOR UPDATE" : ""}`, [batchId, userId]);
  if (!rows[0]) throw new AppError("ART_PHOTO_BATCH_NOT_FOUND", "写真套餐不存在", 404);
  const items = await database.query("SELECT * FROM art_photo_batch_items WHERE batch_id=$1 ORDER BY position", [batchId]);
  const order = await database.query("SELECT id,status,amount,sku FROM growth_orders WHERE id=$1 AND user_id=$2", [rows[0].order_id, userId]);
  if (!order[0]) throw new AppError("ART_PHOTO_ORDER_NOT_FOUND", "写真套餐订单不存在", 409);
  return mapBatch(rows[0], items, order[0]);
}

export async function getArtPhotoBundle(userId: string, batchId: string) {
  return readBatch(await getDatabase(), userId, batchId);
}

export async function listArtPhotoBundles(userId: string) {
  const rows = await (await getDatabase()).query("SELECT b.id,b.package,b.total_count,b.status,b.completed_count,b.failed_count,b.created_at,o.status order_status FROM art_photo_batches b JOIN growth_orders o ON o.id=b.order_id WHERE b.user_id=$1 ORDER BY b.created_at DESC LIMIT 20", [userId]);
  return rows.map((row) => ({ id: String(row.id), package: String(row.package), totalCount: Number(row.total_count), status: String(row.status), completedCount: Number(row.completed_count), failedCount: Number(row.failed_count), orderStatus: String(row.order_status), createdAt: new Date(String(row.created_at)).toISOString() }));
}

export async function createArtPhotoBundle(userId: string, input: unknown) {
  const data = createInputSchema.parse(input);
  const spec = ART_PHOTO_BUNDLE_PACKAGES[data.package];
  const sceneIds = [...new Set(data.sceneIds)];
  if (sceneIds.length !== spec.count) throw new AppError("ART_PHOTO_SCENE_COUNT_INVALID", `请选择 ${spec.count} 套写真场景`, 422);
  return inTransaction(async (database) => {
    const previous = await database.query("SELECT id FROM art_photo_batches WHERE user_id=$1 AND request_key=$2", [userId, data.idempotencyKey]);
    if (previous[0]) {
      const batch = await readBatch(database, userId, String(previous[0].id));
      if (batch.petId !== data.petId || batch.photoId !== data.photoId || batch.package !== data.package || batch.items.map((item) => item.sceneId).join(",") !== sceneIds.join(",")) throw new AppError("ART_PHOTO_REQUEST_CONFLICT", "这次提交编号已用于另一份写真套餐", 409);
      return { batch, order: batch.order };
    }
    const pets = await database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [data.petId, userId]);
    const photos = await database.query("SELECT id FROM photos WHERE id=$1 AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL", [data.photoId, data.petId, userId]);
    if (!pets[0] || !photos[0]) throw new AppError("ART_PHOTO_ASSET_MISMATCH", "宠物或身份照片不可用，请重新选择", 422);
    const batchId = crypto.randomUUID();
    const orderId = crypto.randomUUID();
    const now = new Date();
    const inserted = await database.query("INSERT INTO art_photo_batches (id,user_id,pet_id,photo_id,package,total_count,status,order_id,request_key,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,'pending',$7,$8,$9,$9) ON CONFLICT (user_id,request_key) WHERE request_key IS NOT NULL DO NOTHING RETURNING id", [batchId, userId, data.petId, data.photoId, data.package, spec.count, orderId, data.idempotencyKey, now]);
    if (!inserted[0]) {
      const concurrent = await database.query("SELECT id FROM art_photo_batches WHERE user_id=$1 AND request_key=$2", [userId, data.idempotencyKey]);
      if (!concurrent[0]) throw new AppError("ART_PHOTO_REQUEST_PENDING", "写真套餐创建结果待确认，请稍后重试", 503);
      const batch = await readBatch(database, userId, String(concurrent[0].id));
      if (batch.petId !== data.petId || batch.photoId !== data.photoId || batch.package !== data.package || batch.items.map((item) => item.sceneId).join(",") !== sceneIds.join(",")) throw new AppError("ART_PHOTO_REQUEST_CONFLICT", "这次提交编号已用于另一份写真套餐", 409);
      return { batch, order: batch.order };
    }
    for (const [position, sceneId] of sceneIds.entries()) {
      await database.query("INSERT INTO art_photo_batch_items (id,batch_id,scene_id,position,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$5)", [crypto.randomUUID(), batchId, sceneId, position, now]);
    }
    await database.query("INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'art_photo_bundle',$3,$4,$5,'pending',$6::jsonb,$7,$7)", [orderId, userId, batchId, spec.sku, spec.amount, JSON.stringify({ package: data.package, sceneIds }), now]);
    const batch = await readBatch(database, userId, batchId);
    return { batch, order: batch.order };
  });
}

export async function activateArtPhotoBundle(database: Database, userId: string, batchId: string, orderId: string) {
  const rows = await database.query("SELECT * FROM art_photo_batches WHERE id=$1 AND user_id=$2 AND order_id=$3 FOR UPDATE", [batchId, userId, orderId]);
  if (!rows[0]) throw new AppError("ART_PHOTO_BATCH_NOT_FOUND", "写真套餐不存在", 404);
  if (["queued", "processing", "completed", "partial"].includes(String(rows[0].status))) return;
  if (String(rows[0].status) !== "pending") throw new AppError("ART_PHOTO_BATCH_NOT_PAYABLE", "写真套餐状态不允许入队", 409);
  const items = await database.query("SELECT * FROM art_photo_batch_items WHERE batch_id=$1 ORDER BY position FOR UPDATE", [batchId]);
  const roleInputs = JSON.stringify({ subjectMode: "pet", templateId: PET_ART_PHOTO_TEMPLATE_ID, templateVersion: PET_ART_PHOTO_VERSION, ownerPhotoIds: [], petPhotoIds: [String(rows[0].photo_id)], authorizationConfirmed: false });
  for (const item of items) {
    const idempotencyKey = `art-bundle-${batchId}-${String(item.scene_id)}`;
    const existing = await database.query("SELECT id FROM ai_runs WHERE user_id=$1 AND idempotency_key=$2", [userId, idempotencyKey]);
    const runId = existing[0] ? String(existing[0].id) : crypto.randomUUID();
    if (!existing[0]) {
      await database.query("INSERT INTO ai_runs (id,user_id,plugin_id,pet_id,photo_ids,role_inputs,status,prompt,prompt_version,model_version,provider,options,idempotency_key,candidates,cost,available_at,created_at) VALUES ($1,$2,'pl-10',$3,$4::jsonb,$5::jsonb,'queued',$6,$7,'provider-v1','pending',$8::jsonb,$9,'[]'::jsonb,0,now(),now())", [runId, userId, String(rows[0].pet_id), JSON.stringify([String(rows[0].photo_id)]), roleInputs, buildPetArtPhotoPrompt(String(item.scene_id) as PetArtPhotoSceneId), `template-${PET_ART_PHOTO_VERSION}`, JSON.stringify({ scene: String(item.scene_id), templateId: PET_ART_PHOTO_TEMPLATE_ID, artPhotoBatchId: batchId, artPhotoBatchItemId: String(item.id), candidateCount: 1 }), idempotencyKey]);
    }
    await database.query("UPDATE art_photo_batch_items SET run_id=$2,status='queued',updated_at=now() WHERE id=$1", [item.id, runId]);
  }
  await database.query("UPDATE art_photo_batches SET status='queued',updated_at=now() WHERE id=$1", [batchId]);
}

export async function completeArtPhotoBatchItem(input: { runId: string; status: "succeeded" | "failed"; outputKey?: string; previewKey?: string; errorCode?: string }) {
  return inTransaction(async (database) => {
    const rows = await database.query("SELECT i.*,b.user_id,b.id batch_id FROM art_photo_batch_items i JOIN art_photo_batches b ON b.id=i.batch_id WHERE i.run_id=$1 FOR UPDATE", [input.runId]);
    if (!rows[0]) return;
    const item = rows[0];
    if (["succeeded", "failed", "cancelled"].includes(String(item.status))) return;
    const batch = await database.query("SELECT status FROM art_photo_batches WHERE id=$1 FOR UPDATE", [item.batch_id]);
    if (!batch[0] || batch[0].status === "cancelled") return;
    await database.query("UPDATE art_photo_batch_items SET status=$2,output_key=$3,preview_key=$4,error_code=$5,locked_at=NULL,updated_at=now() WHERE id=$1", [item.id, input.status, input.outputKey || null, input.previewKey || null, input.errorCode || null]);
    const counts = await database.query("SELECT count(*) FILTER (WHERE status='succeeded')::int completed,count(*) FILTER (WHERE status='failed')::int failed,count(*) FILTER (WHERE status IN ('queued','processing'))::int pending FROM art_photo_batch_items WHERE batch_id=$1", [item.batch_id]);
    const count = counts[0];
    const status = Number(count.pending) > 0 ? "processing" : Number(count.failed) > 0 ? (Number(count.completed) > 0 ? "partial" : "failed") : "completed";
    await database.query("UPDATE art_photo_batches SET status=$2,completed_count=$3,failed_count=$4,updated_at=now() WHERE id=$1", [item.batch_id, status, Number(count.completed), Number(count.failed)]);
  });
}

export async function cancelArtPhotoBundle(database: Database, batchId: string) {
  await database.query("UPDATE ai_runs SET status='cancelled',cancelled_at=now(),locked_at=NULL WHERE id IN (SELECT run_id FROM art_photo_batch_items WHERE batch_id=$1) AND status IN ('queued','processing')", [batchId]);
  await database.query("UPDATE art_photo_batch_items SET status='cancelled',updated_at=now() WHERE batch_id=$1 AND status IN ('queued','processing')", [batchId]);
  await database.query("UPDATE art_photo_batches SET status='cancelled',updated_at=now() WHERE id=$1", [batchId]);
}
