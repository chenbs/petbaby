import "server-only";

import { createHash } from "node:crypto";

import {
  generationInputSchema,
  petInputSchema,
  workEditSchema,
  type FunnelEvent,
  type GenerationTask,
  type Order,
  type Pet,
  type PublicWork,
  type Work,
} from "@/domain/models";
import { isTieredPlugin, nextTierGap, resolveOrderPricing, spanDaysBetween, tierPrice, type AccumulationInput } from "@/domain/pricing";
import { getRuntimePlugin, listRuntimePlugins, resolveManifestTone } from "@/plugins/runtime";
import { getDatabase } from "@/server/db/client";
import { mapOrder, mapPet, mapPhoto, mapTask, mapWork } from "@/server/db/rows";
import { hasTierUnlock } from "@/server/entitlements";
import { AppError } from "@/server/errors";
import { paymentProvider } from "@/server/payments/provider";
import { deletePetHumanIdentities } from "@/server/pet-human-identity-service";
import { isRealProduction } from "@/server/runtime-mode";
import { objectStorage } from "@/server/storage";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";

const DAY_MS = 24 * 60 * 60 * 1000;

function belongsToUser<T extends { userId: string }>(item: T | undefined, userId: string): T {
  if (!item || item.userId !== userId) throw new AppError("NOT_FOUND", "没有找到这条记录", 404);
  return item;
}

/**
 * 宠物档案列表，附带作品 / 照片 / 纪念空间三个计数。
 *
 * 计数是 UI 重构方案 E 的统计条所需（「12 作品 · 86 照片 · 2 纪念日」）。
 * 放在这一条查询里而不是让端上按宠物逐个请求：档案页会同时展示全部宠物，
 * 那样是 N+1 次网络往返，而这里三个 LEFT JOIN 子查询一次就够。
 *
 * 三个子查询各自先聚合再 JOIN，不用「多表 JOIN 后 COUNT DISTINCT」：
 * 后者在一只宠物同时有多张照片和多个作品时会产生笛卡尔积，
 * 计数虽能靠 DISTINCT 救回来，但扫描行数会随两边行数相乘放大。
 */
export async function listPets(userId: string) {
  const database = await getDatabase();
  const rows = await database.query(
    `SELECT p.*,
            COALESCE(w.count, 0) AS work_count,
            COALESCE(ph.count, 0) AS photo_count,
            COALESCE(m.count, 0) AS memorial_count,
            m.since AS memorial_since
       FROM pets p
       LEFT JOIN (SELECT pet_id, COUNT(*) AS count FROM works WHERE deleted_at IS NULL GROUP BY pet_id) w ON w.pet_id = p.id
       LEFT JOIN (SELECT pet_id, COUNT(*) AS count FROM photos WHERE deleted_at IS NULL GROUP BY pet_id) ph ON ph.pet_id = p.id
       LEFT JOIN (SELECT pet_id, COUNT(*) AS count, MIN(created_at) AS since FROM memorial_spaces WHERE deleted_at IS NULL GROUP BY pet_id) m ON m.pet_id = p.id
      WHERE p.user_id = $1 AND p.deleted_at IS NULL
      ORDER BY p.is_default DESC, p.created_at`,
    [userId],
  );
  return rows.map((row) => {
    const record = row as Record<string, unknown>;
    const since = record.memorial_since;
    return {
      ...mapPet(row),
      counts: {
        works: Number(record.work_count) || 0,
        photos: Number(record.photo_count) || 0,
        memorials: Number(record.memorial_count) || 0,
      },
      /*
       * 离开日期：取最早的纪念空间创建时间。createMemorialSpace 在建空间的同一次调用里
       * 把 life_stage 改成 memorial，所以这个时间就是「陪伴结束」的那天。
       *
       * 端上用它把陪伴天数固定住 —— 已离开的宠物，天数不能再每天往上跳。
       * pets 表没有单独的离开日期列，与其加一列再回填历史数据，不如从既有事实推出来。
       */
      ...(since ? { memorialSince: new Date(String(since)).toISOString() } : {}),
    };
  });
}

export async function createPet(userId: string, input: unknown): Promise<Pet> {
  const data = petInputSchema.parse(input);
  const pet: Pet = {
    ...data,
    birthday: data.birthday || undefined,
    id: crypto.randomUUID(),
    userId,
    createdAt: new Date().toISOString(), isDefault: false,
  };
  const database = await getDatabase();
  await database.query(
    "INSERT INTO pets (id, user_id, name, species, gender, birthday, date_type, life_stage, is_default, created_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
    [pet.id, userId, pet.name, pet.species, pet.gender, pet.birthday || null, pet.dateType, pet.lifeStage, (await listPets(userId)).length === 0, new Date(pet.createdAt)],
  );
  await recordEvent(userId, "profile_created");
  return { ...pet, isDefault: (await listPets(userId)).length === 1 };
}

/* c8 ignore start */
export async function updatePet(userId: string, id: string, input: unknown): Promise<Pet> {
  const data = petInputSchema.parse(input);
  const database = await getDatabase();
  belongsToUser((await database.query("SELECT * FROM pets WHERE id=$1 AND deleted_at IS NULL", [id])).map(mapPet)[0], userId);
  const rows = await database.query("UPDATE pets SET name=$2,species=$3,gender=$4,birthday=$5,date_type=$6,life_stage=$7 WHERE id=$1 RETURNING *", [id, data.name, data.species, data.gender, data.birthday || null, data.dateType, data.lifeStage]);
  return mapPet(rows[0]);
}

export async function updatePetAvatar(userId: string, id: string, avatarKey: string) {
  const database = await getDatabase();
  const pet = belongsToUser((await database.query("SELECT * FROM pets WHERE id=$1 AND deleted_at IS NULL", [id])).map(mapPet)[0], userId);
  const rows = await database.query("UPDATE pets SET avatar_key=$2 WHERE id=$1 RETURNING *", [id, avatarKey]);
  if (pet.avatarKey && pet.avatarKey !== avatarKey) await objectStorage.delete(pet.avatarKey).catch(() => undefined);
  return mapPet(rows[0]);
}

export async function setDefaultPet(userId: string, id: string): Promise<Pet> {
  const database = await getDatabase();
  belongsToUser((await database.query("SELECT * FROM pets WHERE id=$1 AND deleted_at IS NULL", [id])).map(mapPet)[0], userId);
  await database.query("UPDATE pets SET is_default=false WHERE user_id=$1 AND deleted_at IS NULL", [userId]);
  const rows = await database.query("UPDATE pets SET is_default=true WHERE id=$1 RETURNING *", [id]);
  return mapPet(rows[0]);
}

export async function deletePet(userId: string, id: string) {
  const database = await getDatabase();
  const pet = belongsToUser((await database.query("SELECT * FROM pets WHERE id=$1 AND deleted_at IS NULL", [id])).map(mapPet)[0], userId);
  await deletePetHumanIdentities({ userId, petId: id });
  await database.query("UPDATE pets SET deleted_at=now(),is_default=false WHERE id=$1", [id]);
  await database.query("UPDATE photos SET deleted_at=now() WHERE pet_id=$1 AND deleted_at IS NULL", [id]);
  await database.query("UPDATE works SET deleted_at=now(),public=false,share_token=null WHERE pet_id=$1 AND deleted_at IS NULL", [id]);
  if (pet.isDefault) {
    await database.query("UPDATE pets SET is_default=true WHERE id=(SELECT id FROM pets WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at LIMIT 1)", [userId]);
  }
  return { deleted: true };
}
/* c8 ignore stop */

export async function savePhoto(
  userId: string,
  input: { petId: string; filename: string; mimeType: string; size: number; storageKey: string; quality?: "clear" | "blurry"; shotAt?: Date },
) {
  const database = await getDatabase();
  const petRows = await database.query("SELECT * FROM pets WHERE id = $1", [input.petId]);
  belongsToUser(petRows[0] ? mapPet(petRows[0]) : undefined, userId);
  const id = crypto.randomUUID();
  const createdAt = new Date();
  const rows = await database.query(
    "INSERT INTO photos (id, user_id, pet_id, filename, mime_type, size, storage_key, position, quality, shot_at, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,(SELECT coalesce(max(position),-1)+1 FROM photos WHERE pet_id=$3 AND deleted_at IS NULL),$8,$9,$10) RETURNING *",
    [id, userId, input.petId, input.filename, input.mimeType, input.size, input.storageKey, input.quality || "unknown", input.shotAt || null, createdAt],
  );
  return mapPhoto(rows[0]);
}

export async function listPhotos(userId: string, petId?: string) {
  const database = await getDatabase();
  const rows = petId
    ? await database.query("SELECT * FROM photos WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL ORDER BY position, created_at", [userId, petId])
    : await database.query("SELECT * FROM photos WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC", [userId]);
  return rows.map(mapPhoto);
}

/* c8 ignore start */
export async function updatePhotoOrder(userId: string, petId: string, photoIds: string[]) {
  const database = await getDatabase();
  const rows = await database.query("SELECT id FROM photos WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL", [userId, petId]);
  const allowed = new Set(rows.map((row) => String(row.id)));
  if (photoIds.length !== rows.length || photoIds.some((id) => !allowed.has(id))) throw new AppError("PHOTO_ORDER_INVALID", "Photo order is invalid", 422);
  for (const [position, id] of photoIds.entries()) await database.query("UPDATE photos SET position=$2 WHERE id=$1", [id, position]);
  return listPhotos(userId, petId);
}

export async function deletePhoto(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM photos WHERE id=$1 AND deleted_at IS NULL", [id]);
  const photo = belongsToUser(rows[0] ? mapPhoto(rows[0]) : undefined, userId);
  await deletePetHumanIdentities({ userId, sourcePhotoId: id });
  await database.query("UPDATE photos SET deleted_at=now() WHERE id=$1", [id]);
  await objectStorage.delete(photo.storageKey).catch(() => undefined);
  return { deleted: true };
}
/* c8 ignore stop */

export async function createGeneration(userId: string, input: unknown): Promise<GenerationTask> {
  const data = generationInputSchema.parse(input);
  const database = await getDatabase();
  const existing = await database.query(
    "SELECT * FROM generation_tasks WHERE user_id = $1 AND idempotency_key = $2",
    [userId, data.idempotencyKey],
  );
  if (existing[0]) return mapTask(existing[0]);

  const rawPlugin = await getRuntimePlugin(data.pluginId);
  if (!rawPlugin || rawPlugin.status !== "live") throw new AppError("PLUGIN_UNAVAILABLE", "这个玩法暂时未开放", 404);
  const petRows = await database.query("SELECT * FROM pets WHERE id = $1", [data.petId]);
  const pet = belongsToUser(petRows[0] ? mapPet(petRows[0]) : undefined, userId);
  /*
   * 按宠物生命阶段解析调性，**并让快照存解析后的结果**（改造方案 C4）。
   *
   * 存含全部 variants 的原始件会让历史作品在用户改了生命阶段后换一副面孔 ——
   * 作品是既成事实，不该回头变样。
   */
  const plugin = resolveManifestTone(rawPlugin, pet.lifeStage);
  if (data.sourceWorkId) {
    const sourceRows = await database.query("SELECT * FROM works WHERE id=$1", [data.sourceWorkId]);
    const source = belongsToUser(sourceRows[0] ? mapWork(sourceRows[0]) : undefined, userId);
    if (!canRegenerate(source)) throw new AppError("REGENERATION_EXPIRED", "作品已超过 24 小时，重新生成会使用新的免费额度", 409);
    if (source.pluginId !== data.pluginId || source.petId !== data.petId) throw new AppError("SOURCE_WORK_MISMATCH", "原作品与当前玩法不匹配");
  }
  if (data.photoIds.length < plugin.input.photos.min || data.photoIds.length > plugin.input.photos.max) {
    throw new AppError("PHOTO_COUNT_INVALID", `这个玩法需要 ${plugin.input.photos.min}-${plugin.input.photos.max} 张照片`);
  }
  const photoRows = await database.query(
    "SELECT * FROM photos WHERE id = ANY($1::uuid[])",
    [data.photoIds],
  );
  if (photoRows.length !== data.photoIds.length || photoRows.some((row) => row.user_id !== userId || row.pet_id !== data.petId)) {
    throw new AppError("PHOTO_PET_MISMATCH", "照片不存在或不属于当前宠物");
  }

  const quotaDate = new Date().toISOString().slice(0, 10);
  const quotaRows = data.sourceWorkId ? [] : await database.query("SELECT id FROM daily_quotas WHERE user_id = $1 AND quota_date = $2", [userId, quotaDate]);
  let membershipId: string | undefined;
  if (quotaRows.length) {
    const memberships = await database.query("SELECT id FROM memberships WHERE user_id=$1 AND status='active' AND expires_at>now() AND used<quota ORDER BY expires_at LIMIT 1", [userId]);
    if (!memberships[0]) throw new AppError("DAILY_QUOTA_USED", "今天的免费生成已用完，明天再来看看吧", 429);
    membershipId = String(memberships[0].id);
    await database.query("UPDATE memberships SET used=used+1 WHERE id=$1 AND used<quota", [membershipId]);
  }

  const taskId = crypto.randomUUID();
  const timestamp = new Date();
  try {
    if (!data.sourceWorkId) await database.query("INSERT INTO daily_quotas (id, user_id, quota_date, task_id, created_at) VALUES ($1,$2,$3,$4,$5)", [crypto.randomUUID(), userId, quotaDate, taskId, timestamp]);
    const rows = await database.query(
      "INSERT INTO generation_tasks (id,user_id,plugin_id,pet_id,photo_ids,idempotency_key,status,progress,attempt,source_work_id,options,plugin_snapshot,available_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'queued',8,0,$7,$8::jsonb,$9::jsonb,$10,$10,$10) RETURNING *",
      [taskId, userId, data.pluginId, data.petId, JSON.stringify(data.photoIds), data.idempotencyKey, data.sourceWorkId || null, JSON.stringify(data.options), JSON.stringify(plugin), timestamp],
    );
    await recordEvent(userId, "generation_created", data.pluginId);
    return mapTask(rows[0]);
  } catch (error) {
    await database.query("DELETE FROM daily_quotas WHERE task_id = $1 AND NOT EXISTS (SELECT 1 FROM generation_tasks WHERE id = $1)", [taskId]);
    if (membershipId) await database.query("UPDATE memberships SET used=greatest(used-1,0) WHERE id=$1", [membershipId]);
    throw error;
  }
}

export async function getGeneration(userId: string, id: string): Promise<GenerationTask & { work?: PublicWork }> {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM generation_tasks WHERE id = $1", [id]);
  const task = belongsToUser(rows[0] ? mapTask(rows[0]) : undefined, userId);
  const queueRows = task.status === "queued"
    ? await database.query<{ position: number }>("SELECT count(*)::int position FROM generation_tasks WHERE status='queued' AND created_at <= $1", [new Date(task.createdAt)])
    : [];
  const queuePosition = Number(queueRows[0]?.position || 0) || undefined;
  return { ...task, queuePosition, estimatedSeconds: queuePosition ? queuePosition * 15 : undefined, work: task.workId ? await getWork(userId, task.workId) : undefined };
}

export async function listGenerations(userId: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM generation_tasks WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [userId]);
  return rows.map(mapTask);
}

export async function getWork(userId: string, id: string): Promise<PublicWork> {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM works WHERE id = $1", [id]);
  const work = belongsToUser(rows[0] ? mapWork(rows[0]) : undefined, userId);
  return hydrateWork(work);
}

async function hydrateWork(work: Work): Promise<PublicWork> {
  const database = await getDatabase();
  const [petRows, photoRows] = await Promise.all([
    database.query("SELECT * FROM pets WHERE id = $1", [work.petId]),
    database.query("SELECT * FROM photos WHERE id = $1", [work.photoId]),
  ]);
  const pet = petRows[0] ? mapPet(petRows[0]) : undefined;
  const photo = photoRows[0] ? mapPhoto(photoRows[0]) : undefined;
  const rawPlugin = await getRuntimePlugin(work.pluginId);
  if (!pet || !photo || !rawPlugin) throw new AppError("WORK_INCOMPLETE", "作品关联数据不完整", 500);
  /*
   * 这里也要解析调性（C4）。漏掉的后果不只是文案：
   * `createOrder` 的基础价取自 `work.plugin.pricing.unlockPrice`，
   * 不解析的话纪念册会按画册的 19.9 收费而不是纪念价 49。
   */
  const plugin = resolveManifestTone(rawPlugin, pet.lifeStage);
  const visibleKey = work.locked ? work.previewKey : work.outputKey;
  return { ...work, pet, photo, plugin, outputUrl: visibleKey ? `/api/media/${encodeURIComponent(visibleKey)}` : undefined };
}

export async function listWorks(userId: string, filters: { petId?: string; pluginId?: string; locked?: boolean } = {}) {
  const database = await getDatabase();
  const params: unknown[] = [userId]; const conditions = ["user_id = $1", "deleted_at IS NULL"];
  if (filters.petId) { params.push(filters.petId); conditions.push(`pet_id = $${params.length}`); }
  if (filters.pluginId) { params.push(filters.pluginId); conditions.push(`plugin_id = $${params.length}`); }
  if (typeof filters.locked === "boolean") { params.push(filters.locked); conditions.push(`locked = $${params.length}`); }
  const rows = await database.query(`SELECT * FROM works WHERE ${conditions.join(" AND ")} ORDER BY created_at DESC`, params);
  return Promise.all(rows.map((row) => hydrateWork(mapWork(row))));
}

/* c8 ignore start */
export async function deleteWork(userId: string, id: string) {
  await getWork(userId, id);
  const database = await getDatabase();
  await database.query("UPDATE works SET deleted_at=now(), public=false, share_token=null WHERE id=$1", [id]);
  return { deleted: true };
}

export async function copyWork(userId: string, id: string) {
  const source = await getWork(userId, id);
  const database = await getDatabase();
  const workId = crypto.randomUUID();
  const now = new Date();
  const rows = await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,locked,public,version,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,false,$12,$13,$14) RETURNING *", [workId,userId,source.pluginId,source.petId,source.photoId,`${source.title} - 副本`,source.subtitle,source.serialNumber,source.authority,source.outputKey,source.previewKey,source.version + 1,new Date(Date.now()+90*DAY_MS),now]);
  await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), workId, source.version + 1, `${source.title} - 副本`, source.subtitle, source.outputKey || null, source.previewKey || null, now]);
  return hydrateWork(mapWork(rows[0]));
}
/* c8 ignore stop */

export async function listWorkVersions(userId: string, id: string) {
  await getWork(userId, id);
  const database = await getDatabase();
  return database.query("SELECT id,work_id,version,title,subtitle,output_key,preview_key,created_at FROM work_versions WHERE work_id=$1 ORDER BY version DESC", [id]);
}

export async function restoreWorkVersion(userId: string, id: string, versionId: string) {
  const work = await getWork(userId, id);
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM work_versions WHERE id=$1 AND work_id=$2", [versionId, id]);
  if (!rows[0]) throw new AppError("WORK_VERSION_NOT_FOUND", "作品历史版本不存在", 404);
  const version = work.version + 1;
  const source = rows[0];
  await database.query("UPDATE works SET title=$2,subtitle=$3,output_key=$4,preview_key=coalesce($5,preview_key),version=$6 WHERE id=$1", [id, source.title, source.subtitle, source.output_key, source.preview_key || null, version]);
  await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [crypto.randomUUID(), id, version, source.title, source.subtitle, source.output_key, source.preview_key || null, new Date()]);
  return getWork(userId, id);
}

export async function editWork(userId: string, id: string, input: unknown) {
  const data = workEditSchema.parse(input);
  const work = await getWork(userId, id);
  const database = await getDatabase();
  const sourceRows = await database.query("SELECT * FROM generation_tasks WHERE work_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1", [id, userId]);
  if (!sourceRows[0]) throw new AppError("SOURCE_TASK_NOT_FOUND", "Original generation task not found", 409);
  const sourceTask = mapTask(sourceRows[0]);
  const task = await createGeneration(userId, { pluginId: work.pluginId, petId: work.petId, photoIds: sourceTask.photoIds, idempotencyKey: crypto.randomUUID(), sourceWorkId: id, options: { ...sourceTask.options, title: data.title, subtitle: data.subtitle } });
  await runWorkerUntilIdle(5);
  const completed = await getGeneration(userId, task.id);
  if (!completed.work) throw new AppError("RENDER_FAILED", `Edited work could not be rendered: ${completed.errorCode || completed.status}`, 500);
  return completed.work;
}

export async function revokeShare(userId: string, id: string) {
  await getWork(userId, id);
  const database = await getDatabase();
  await database.query("UPDATE works SET public=false,share_token=null WHERE id=$1", [id]);
  return { revoked: true };
}

/**
 * 量一只宠物当前的积累深度，供定价分档使用。
 *
 * 排序键用 `coalesce(shot_at, created_at)` —— 与 timeline-service 和 mapPhoto
 * 的回落口径一致。直接用 `shot_at` 会让无 EXIF 的照片算不进跨度，
 * 出现「时间线显示跨了两年、定价却算作基础档」。
 */
async function measureAccumulation(userId: string, petId: string): Promise<AccumulationInput> {
  const database = await getDatabase();
  const rows = await database.query<{ photo_count: number; earliest: string | null; latest: string | null }>(
    "SELECT count(*)::int photo_count, min(coalesce(shot_at, created_at)) earliest, max(coalesce(shot_at, created_at)) latest FROM photos WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL",
    [userId, petId],
  );
  const row = rows[0];
  const photoCount = Number(row?.photo_count || 0);
  const spanDays = row?.earliest && row?.latest ? spanDaysBetween(new Date(row.earliest), new Date(row.latest)) : 0;
  return { photoCount, spanDays };
}

/**
 * 下单**之前**就能拿到的定价说明（改造项 L3）。
 *
 * 17 号文 3.5 自己的判据是「档位必须在制作前可见，不能生成完才告价 —— 那是诱导」。
 * 这条服务给制作页与作品页共用的那份事实：当前档、要付多少、再攒多少进下一档、
 * 会员省了多少。
 *
 * **与 createOrder 走同一个 resolveOrderPricing**：展示价与实收价由同一个函数产出，
 * 不能各算一遍 —— 展示便宜、实收更贵正是这条改造要消除的风险。
 *
 * 分档按下单时的实际积累量算，而这条预览按调用时算，两者可能不同（用户看完又传了照片）。
 * 这个方向的偏差对用户有利（攒得更多只会更好或不变），不额外锁价。
 */
export async function getDeliveryPricing(userId: string, petId: string, pluginId: string) {
  const database = await getDatabase();
  const petRows = await database.query("SELECT * FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [petId, userId]);
  if (!petRows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  const pet = mapPet(petRows[0]);
  const rawPlugin = await getRuntimePlugin(pluginId);
  if (!rawPlugin) throw new AppError("PLUGIN_NOT_FOUND", "玩法不存在", 404);
  const plugin = resolveManifestTone(rawPlugin, pet.lifeStage);
  const base = plugin.pricing.unlockPrice;
  const tiered = isTieredPlugin(pluginId) && pet.lifeStage !== "memorial";
  const accumulation = tiered ? await measureAccumulation(userId, petId) : undefined;
  const isMember = tiered ? await hasTierUnlock(userId) : false;
  const pricing = resolveOrderPricing({ pluginId, accumulation, isMember, basePrice: base });
  return {
    pluginId,
    petId,
    /** 免费玩法为 true，端上据此完全不显示价格区块 */
    free: pricing.amount <= 0,
    tiered,
    isMember,
    accumulation,
    /** 内容规格档。会员恒为 annual */
    specTier: pricing.specTier,
    priceTier: pricing.priceTier,
    amount: pricing.amount,
    listPrice: pricing.listPrice,
    memberSaving: pricing.memberSaving,
    label: plugin.pricing.label,
    /*
     * 会员已在最高规格，不需要「再攒多少」—— 那对他没有意义，
     * 而留着会读成「你还差点什么」，与已付费的事实冲突。
     */
    nextTier: tiered && accumulation && !isMember ? nextTierGap(accumulation) : undefined,
    /** 各档价目，供端上展示价格跨度（价格锚） */
    tierPrices: tiered
      ? { basic: tierPrice(pluginId, "basic"), advanced: tierPrice(pluginId, "advanced"), annual: tierPrice(pluginId, "annual") }
      : undefined,
  };
}

export async function createOrder(userId: string, workId: string, requestedSku?: string): Promise<Order> {
  const work = await getWork(userId, workId);
  const database = await getDatabase();
  const existing = await database.query("SELECT * FROM orders WHERE user_id = $1 AND work_id = $2", [userId, workId]);
  if (existing[0]) {
    const order = mapOrder(existing[0]);
    if (requestedSku && order.sku !== requestedSku) throw new AppError("ORDER_SKU_LOCKED", "该作品已经按其他 SKU 创建订单", 409);
    return order;
  }
  const defaultSku = `${work.pluginId}-single`;
  const sku = requestedSku || defaultSku;
  /*
   * `pet-id-card-bundle`（四证套餐 19.9）已随 PL-01 转免费而下线：
   * 单张既然免费，四张打包收 19.9 讲不通。这里不再识别该 SKU，
   * 传进来会按 SKU_INVALID 拒掉。
   */
  if (sku !== defaultSku) throw new AppError("SKU_INVALID", "所选 SKU 不适用于当前作品", 422);
  const base = work.plugin.pricing.unlockPrice;
  /*
   * 免费玩法不建订单。原先 unlockPrice=0 也会插一条 amount=0 的 order，
   * 而微信支付 `amount.total` 取 Math.round(0*100)=0，最低是 1 分 —— 生产环境
   * 这条订单根本付不掉。现在免费作品直接以 locked=false 入库（见 generation-worker），
   * 走到这里说明端上还在调解锁，属调用方错误而不是可支付状态。
   */
  if (base <= 0) throw new AppError("ORDER_NOT_REQUIRED", "这个玩法可以直接保存，不需要解锁", 409);
  /*
   * 按积累量分档（C5）。**在下单时算，不在生成时算**：用户可能生成后隔几天才付，
   * 期间可能又上传了照片。按下单时的实际积累量计价对用户更有利，
   * 也避免「生成时便宜、付款时变贵」的投诉。
   *
   * 纪念形态与套餐不分档：纪念场景比价是冒犯（见 domain/pricing.ts 的说明）。
   */
  const tiered = isTieredPlugin(work.pluginId) && work.pet.lifeStage !== "memorial";
  const accumulation = tiered ? await measureAccumulation(userId, work.petId) : undefined;
  /*
   * 会员的档位解锁是「用最高规格、付最低价」，不是「按最高档计价」。
   * 计价规则整个交给 domain/pricing.ts 的 resolveOrderPricing —— 原先这里
   * 是一行三元表达式，把规格档直接当成计价档，导致会员反而多付钱。
   * 端上的档位展示（L3）走同一个函数，避免两处各算一遍。
   */
  const pricing = resolveOrderPricing({ pluginId: work.pluginId, accumulation, isMember: tiered ? await hasTierUnlock(userId) : false, basePrice: base });
  /*
   * `price_tier` 记**计价档**：这一列的用途是对账时解释「为什么这单是这个数」，
   * 记规格档会让 amount 与 price_tier 对不上。规格档进 works.accumulation_snapshot。
   */
  const entitlements = { formats: work.plugin.output.formats, watermarkRemoved: true, ...(pricing.memberSaving > 0 ? { memberSaving: pricing.memberSaving, listPrice: pricing.listPrice } : {}) };
  const rows = await database.query(
    "INSERT INTO orders (id,user_id,work_id,plugin_id,amount,sku,unit_price,entitlements,plugin_snapshot,status,price_tier,created_at) VALUES ($1,$2,$3,$4,$5,$6,$5,$7::jsonb,$8::jsonb,'pending',$10,$9) RETURNING *",
    [crypto.randomUUID(), userId, workId, work.pluginId, pricing.amount, sku, JSON.stringify(entitlements), JSON.stringify(work.plugin), new Date(), pricing.priceTier || null],
  );
  if (accumulation) {
    await database.query("UPDATE works SET accumulation_snapshot=$2::jsonb WHERE id=$1", [workId, JSON.stringify({ ...accumulation, tier: pricing.specTier, priceTier: pricing.priceTier })]);
  }
  return mapOrder(rows[0]);
}

export async function preparePayment(userId: string, orderId: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM orders WHERE id=$1", [orderId]);
  const order = belongsToUser(rows[0] ? mapOrder(rows[0]) : undefined, userId);
  if (order.status !== "pending") throw new AppError("ORDER_NOT_PAYABLE", "当前订单不能支付");
  return paymentProvider.create(order);
}

export async function payOrder(userId: string, id: string) {
  if (isRealProduction()) throw new AppError("PAYMENT_ADAPTER_REQUIRED", "生产环境未配置微信支付，已拒绝模拟解锁", 503);
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM orders WHERE id = $1", [id]);
  const order = belongsToUser(rows[0] ? mapOrder(rows[0]) : undefined, userId);
  if (order.status === "paid") return { order, work: await getWork(userId, order.workId) };
  if (order.status !== "pending") throw new AppError("ORDER_NOT_PAYABLE", "当前订单不能支付");
  const paidAt = new Date();
  await database.query("UPDATE orders SET status = 'paid', paid_at = $2 WHERE id = $1 AND status = 'pending'", [id, paidAt]);
  await database.query("UPDATE works SET locked = false WHERE id = $1", [order.workId]);
  await database.query("UPDATE ai_runs SET selected_unlocked=true WHERE work_id=$1", [order.workId]);
  await database.query("UPDATE video_projects SET status='ready',updated_at=now() WHERE work_id=$1", [order.workId]);
  await database.query("UPDATE video_renders SET status='ready' WHERE work_id=$1 AND status='preview_ready'", [order.workId]);
  await recordEvent(userId, "paid", order.pluginId);
  const updated = await database.query("SELECT * FROM orders WHERE id = $1", [id]);
  return { order: mapOrder(updated[0]), work: await getWork(userId, order.workId) };
}

export async function requestRefund(userId: string, orderId: string, reason: "generation_failed" | "dissatisfied") {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM orders WHERE id=$1", [orderId]);
  const order = belongsToUser(rows[0] ? mapOrder(rows[0]) : undefined, userId);
  if (order.status !== "paid" && order.status !== "refunded") throw new AppError("ORDER_NOT_REFUNDABLE", "当前订单不能退款");
  if (reason === "dissatisfied") {
    const used = await database.query("SELECT id FROM refunds WHERE user_id=$1 AND reason='dissatisfied' AND status IN ('pending','succeeded')", [userId]);
    if (used.length) throw new AppError("DISSATISFIED_REFUND_USED", "每位用户仅有一次效果不满意退款机会", 409);
  }
  const amount = reason === "generation_failed" ? order.amount : Math.round(order.amount * 50) / 100;
  const remaining = Math.max(0, order.amount - order.refundedAmount);
  const refundAmount = Math.min(amount, remaining);
  if (refundAmount <= 0) throw new AppError("ALREADY_REFUNDED", "订单已完成退款", 409);
  const refundId = crypto.randomUUID();
  await database.query("INSERT INTO refunds (id,user_id,order_id,amount,reason,status,created_at) VALUES ($1,$2,$3,$4,$5,'pending',$6)", [refundId, userId, orderId, refundAmount, reason, new Date()]);
  try {
    await paymentProvider.refund(order, refundAmount, reason);
    const total = order.refundedAmount + refundAmount;
    const status = total >= order.amount ? "refunded" : "paid";
    await database.query("UPDATE refunds SET status='succeeded',completed_at=now() WHERE id=$1", [refundId]);
    await database.query("UPDATE orders SET status=$2,refunded_amount=$3,refund_reason=$4 WHERE id=$1", [orderId, status, total, reason]);
    if (status === "refunded") {
      await database.query("UPDATE works SET locked=true,public=false,share_token=NULL,share_expires_at=NULL,share_access_code_hash=NULL WHERE id=$1", [order.workId]);
      await database.query("UPDATE ai_runs SET selected_unlocked=false WHERE work_id=$1", [order.workId]);
      await database.query("UPDATE video_projects SET status='preview_ready',updated_at=now() WHERE work_id=$1", [order.workId]);
      await database.query("UPDATE video_renders SET status='preview_ready' WHERE work_id=$1 AND status='ready'", [order.workId]);
    }
    return { id: refundId, amount: refundAmount, status: "succeeded" as const };
  } catch (error) {
    await database.query("UPDATE refunds SET status='failed',completed_at=now() WHERE id=$1", [refundId]);
    throw error;
  }
}

export async function listOrders(userId: string) {
  const database = await getDatabase();
  return (await database.query("SELECT * FROM orders WHERE user_id=$1 ORDER BY created_at DESC", [userId])).map(mapOrder);
}

export async function shareWork(userId: string, id: string, options: { accessCode?: string; expiresInHours?: number; resetToken?: boolean } = {}) {
  const work = await getWork(userId, id);
  const token = !options.resetToken && work.shareToken ? work.shareToken : crypto.randomUUID().replaceAll("-", "");
  const database = await getDatabase();
  const expiresInHours = Math.min(24 * 365, Math.max(1, options.expiresInHours || 24 * 7));
  const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);
  const accessCodeHash = options.accessCode ? createHash("sha256").update(options.accessCode).digest("hex") : null;
  await database.query("UPDATE works SET share_token=$2,public=true,share_expires_at=$3,share_access_code_hash=$4 WHERE id=$1", [id, token, expiresAt, accessCodeHash]);
  await recordEvent(userId, "shared", work.pluginId);
  return { token, path: `/share/${token}`, expiresAt: expiresAt.toISOString(), protected: Boolean(accessCodeHash) };
}

export async function getDownload(userId: string, id: string, format: "image" | "pdf" | "video") {
  const work = await getWork(userId, id);
  if (work.locked) throw new AppError("WORK_LOCKED", "请先解锁高清作品", 402);
  const base = work.outputKey?.replace(/\.[^.]+$/, "");
  const key = format === "pdf" ? `${base}.pdf` : work.outputKey;
  if (!key) throw new AppError("OUTPUT_NOT_FOUND", "作品文件不存在", 404);
  return { key, filename: `${work.pet.name}-${work.plugin.name}.${format === "pdf" ? "pdf" : key.split(".").pop()}` };
}

export async function getSharedWork(token: string, accessCode?: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new AppError("SHARE_NOT_FOUND", "分享已关闭或不存在", 404);
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM works WHERE share_token = $1 AND public = true", [token]);
  if (!rows[0]) throw new AppError("SHARE_NOT_FOUND", "分享已关闭或不存在", 404);
  const row = rows[0];
  if (row.share_expires_at && new Date(String(row.share_expires_at)).getTime() <= Date.now()) throw new AppError("SHARE_EXPIRED", "分享已经过期", 410);
  if (row.share_access_code_hash) {
    const hash = accessCode ? createHash("sha256").update(accessCode).digest("hex") : "";
    if (hash !== String(row.share_access_code_hash)) throw new AppError("SHARE_ACCESS_CODE_REQUIRED", "请输入正确的分享访问码", 401);
  }
  return hydrateWork(mapWork(row));
}

export async function recordShareAttribution(token: string, eventName: "visit" | "cta" | "duration", source?: string, visitorKey?: string, durationSeconds?: number, accessCode?: string) {
  const work = await getSharedWork(token, accessCode);
  const database = await getDatabase();
  const eventSource = eventName === "duration" ? `${source || "share"};seconds=${Math.max(0, Math.min(86400, durationSeconds || 0))}` : source;
  await database.query("INSERT INTO share_visits (id,work_id,share_token,event_name,source,visitor_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(),work.id,token,eventName,eventSource?.slice(0,80)||null,visitorKey?.slice(0,80)||null,new Date()]);
  if (eventName === "visit" || eventName === "cta") await recordEvent(work.userId, eventName === "visit" ? "share_page_visit" : "share_page_cta", work.pluginId, source, { visitorKey });
  return work;
}

export async function recordEvent(userId: string, name: string, pluginId?: string, channel?: string, metadata: Record<string, unknown> = {}): Promise<FunnelEvent> {
  const event: FunnelEvent = { id: crypto.randomUUID(), userId, pluginId, name, createdAt: new Date().toISOString() };
  const database = await getDatabase();
  await database.query("INSERT INTO events (id,user_id,plugin_id,name,channel,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)", [event.id, userId, pluginId || null, name, channel || null, JSON.stringify(metadata), new Date(event.createdAt)]);
  return event;
}

export async function getDashboard(userId: string) {
  const database = await getDatabase();
  const plugins = await listRuntimePlugins();
  const [countRows, pluginRows] = await Promise.all([
    database.query<{ pets: number; works: number; paid_orders: number; shares: number; revenue: number; generations: number }>(
      `SELECT
        (SELECT count(*)::int FROM pets WHERE user_id=$1) pets,
        (SELECT count(*)::int FROM works WHERE user_id=$1) works,
        (SELECT count(*)::int FROM orders WHERE user_id=$1 AND status='paid') paid_orders,
        (SELECT count(*)::int FROM events WHERE user_id=$1 AND name='shared') shares,
        (SELECT coalesce(sum(amount),0)::float FROM orders WHERE user_id=$1 AND status='paid') revenue,
        (SELECT count(*)::int FROM events WHERE user_id=$1 AND name='generation_succeeded') generations`, [userId]),
    database.query<{ plugin_id: string; generations: number; paid: number }>(
      `SELECT p.plugin_id,
        count(*) FILTER (WHERE p.kind='generation')::int generations,
        count(*) FILTER (WHERE p.kind='paid')::int paid
       FROM (
        SELECT plugin_id, 'generation' kind FROM events WHERE user_id=$1 AND name='generation_succeeded'
        UNION ALL SELECT plugin_id, 'paid' kind FROM orders WHERE user_id=$1 AND status='paid'
       ) p GROUP BY p.plugin_id`, [userId]),
  ]);
  const counts = countRows[0];
  return {
    counts: { pets: counts.pets, works: counts.works, paidOrders: counts.paid_orders, shares: counts.shares },
    revenue: counts.revenue,
    conversion: counts.generations ? counts.paid_orders / counts.generations : 0,
    plugins: plugins.map((plugin) => {
      const row = pluginRows.find((item) => item.plugin_id === plugin.id);
      return { id: plugin.id, name: plugin.name, generations: row?.generations || 0, paid: row?.paid || 0 };
    }),
  };
}

export function canRegenerate(work: Work, at = new Date()) {
  return at.getTime() - new Date(work.createdAt).getTime() <= DAY_MS;
}

