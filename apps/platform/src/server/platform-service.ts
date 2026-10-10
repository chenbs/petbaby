import { lockPhotoInputs } from "@/server/photo-deliverable-assets";
﻿import "server-only";

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
import { nextTierGap } from "@/domain/pricing";
import { AI_RUN_COST, DONGAN_UNIT, FREE_DAILY_GENERATIONS, isTieredPlugin, resolveDeliverableCost, tierCosts } from "@/domain/dongan-pricing";
import { getRuntimePlugin, listRuntimePlugins, resolveManifestTone } from "@/plugins/runtime";
import { getDatabase, inTransaction } from "@/server/db/client";
import { mapOrder, mapPet, mapPhoto, mapTask, mapWork } from "@/server/db/rows";
import { measureAccumulation } from "@/server/accumulation";
import { grantNewcomerGift, spend } from "@/server/wallet/service";
import { AppError } from "@/server/errors";
import { applyWorkUnlock, confirmOrderPayment, prepareOrderPayment, refundOrderPayment } from "@/server/payments/service";
import { objectStorage } from "@/server/storage";
import { runWorkerUntilIdle } from "@/server/worker/generation-worker";
import { ensurePhotoDeliverableAsset } from "@/server/photo-deliverable-assets";
import { AI_NOTICE_TEXT, needsAiLabel } from "@/server/media/ai-label";
import { assertAiOriginalDelivery } from "@/server/ai-disclosure-service";

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
  /*
   * 新人见面礼：添加第一只宠物后到账 3 颗冻干（7 天有效），每个微信身份只发一次。
   * 发放失败不影响建档 —— 建档是积累，不能因为送礼出错而失败。
   */
  const gift = await grantNewcomerGift(userId).catch(() => undefined);
  return { ...pet, isDefault: (await listPets(userId)).length === 1, ...(gift ? { newcomerGift: { units: gift.delta } } : {}) };
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

export { deletePetWithCleanup as deletePet } from "@/server/photo-deletion-service";
/* c8 ignore stop */

// 历史调用点和记录入口共用同一照片实现。
export { savePhoto, listPhotos, updatePhotoOrder, deletePhoto } from "@/server/photo-library-service";

async function createGenerationOperation(userId: string, input: unknown): Promise<GenerationTask> {
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

  /*
   * 先扣冻干，再执行任务（36 号文第 2 章）：付费玩法在入队的同一事务里扣费，产物直接是正式版；
   * 改文案重新生成同样按现价再扣一次（扣一次生成一次）。免费玩法每天 10 次。
   * 调用方 createGeneration 已锁住用户行，免费次数的计数不会被并发请求穿透。
   */
  const memorial = pet.lifeStage === "memorial";
  const accumulation = isTieredPlugin(data.pluginId) && !memorial ? await measureAccumulation(userId, data.petId) : undefined;
  const pricing = resolveDeliverableCost({ pluginId: data.pluginId, accumulation, memorial });
  const taskId = crypto.randomUUID();
  const timestamp = new Date();
  const quotaDate = new Date().toISOString().slice(0, 10);
  let walletBizKey: string | undefined;
  if (pricing.cost > 0) {
    walletBizKey = `spend:generation:${taskId}`;
    await spend(userId, { units: pricing.cost, bizKey: walletBizKey, title: plugin.name, refType: "generation_task", refId: taskId });
  } else if (["pet-id-card", "pl-23"].includes(data.pluginId)) {
    const used = await database.query<{ count: number }>("SELECT count(*)::int count FROM daily_quotas q JOIN generation_tasks t ON t.id=q.task_id WHERE q.user_id = $1 AND q.quota_date = $2 AND t.plugin_id IN ('pet-id-card','pl-23')", [userId, quotaDate]);
    if (Number(used[0]?.count || 0) >= FREE_DAILY_GENERATIONS) throw new AppError("DAILY_QUOTA_USED", `今天的免费生成已用完 ${FREE_DAILY_GENERATIONS} 次，明天再来看看吧`, 429);
    await database.query("INSERT INTO daily_quotas (id, user_id, quota_date, task_id, created_at) VALUES ($1,$2,$3,$4,$5)", [crypto.randomUUID(), userId, quotaDate, taskId, timestamp]);
  }
  const options = { ...data.options, recordSnapshot: plugin.id === "pl-23" ? { pet, photos: photoRows.map(mapPhoto) } : undefined, dongan: { cost: pricing.cost, tier: pricing.tier, accumulation } };
    const rows = await database.query(
      "INSERT INTO generation_tasks (id,user_id,plugin_id,pet_id,photo_ids,idempotency_key,status,progress,attempt,source_work_id,options,plugin_snapshot,wallet_biz_key,available_at,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,'queued',8,0,$7,$8::jsonb,$9::jsonb,$11,$10,$10,$10) RETURNING *",
      [taskId, userId, data.pluginId, data.petId, JSON.stringify(data.photoIds), data.idempotencyKey, data.sourceWorkId || null, JSON.stringify(options), JSON.stringify(plugin), timestamp, walletBizKey || null],
    );
    await recordEvent(userId, "generation_created", data.pluginId);
    return mapTask(rows[0]);
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
  const coverKey = await ensurePhotoDeliverableAsset(work.userId, work.petId, "work", work.id, work.photoId);
  const sourceKey = work.locked ? work.previewKey : work.outputKey;
  const visibleKey = sourceKey === photo.storageKey ? coverKey : sourceKey;
  // 作品只需要封面；不要把后来补写的私人记录或上传标识嵌入作品响应。
  // 生成合成内容在界面上叠「该内容由AI生成」蒙层；文案由服务端下发，端上不写死。
  const aiGenerated = needsAiLabel(plugin);
  const imageFormat = work.assetKind === "image" && visibleKey?.endsWith(".svg") ? "?format=png" : "";
  return { ...work, pet, photo: { id: photo.id, url: `/api/media/${encodeURIComponent(coverKey)}` }, plugin, outputUrl: visibleKey ? `/api/media/${encodeURIComponent(visibleKey)}${imageFormat}` : undefined, aiGenerated, ...(aiGenerated ? { aiNotice: AI_NOTICE_TEXT } : {}) };
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
 * 制作**之前**就能看到要扣多少颗冻干（改造项 L3 的冻干版）。
 *
 * 与 createGeneration 走同一个 resolveDeliverableCost：展示颗数与实扣颗数由同一个函数产出。
 * 分档按扣费那一刻的积累量算，而这条预览按调用时算 —— 两者可能不同（用户看完又传了照片），
 * 这个方向的偏差对用户只会更好或不变，不额外锁价。
 */
export async function getDeliveryPricing(userId: string, petId: string, pluginId: string) {
  const database = await getDatabase();
  const petRows = await database.query("SELECT * FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [petId, userId]);
  if (!petRows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  const pet = mapPet(petRows[0]);
  const rawPlugin = await getRuntimePlugin(pluginId);
  if (!rawPlugin) throw new AppError("PLUGIN_NOT_FOUND", "玩法不存在", 404);
  const plugin = resolveManifestTone(rawPlugin, pet.lifeStage);
  const memorial = pet.lifeStage === "memorial";
  const tiered = isTieredPlugin(pluginId) && !memorial;
  const accumulation = tiered ? await measureAccumulation(userId, petId) : undefined;
  const pricing = resolveDeliverableCost({ pluginId, accumulation, memorial });
  return {
    pluginId,
    petId,
    /** 免费玩法为 true，端上据此完全不显示颗数区块 */
    free: pricing.cost <= 0,
    tiered,
    accumulation,
    tier: pricing.tier,
    /** 这次要扣的颗数 */
    cost: pricing.cost,
    unit: DONGAN_UNIT,
    label: plugin.pricing.label,
    nextTier: tiered && accumulation ? nextTierGap(accumulation) : undefined,
    /** 各档颗数，供端上展示跨度 */
    tierCosts: tiered ? tierCosts(pluginId) : undefined,
  };
}

/** 一件作品现在要扣多少颗（用于冻干上线前遗留的锁定作品）。 */
async function workUnlockCost(userId: string, work: PublicWork) {
  const database = await getDatabase();
  if (work.sourceKind === "ai") {
    const runs = await database.query("SELECT role_inputs FROM ai_runs WHERE work_id=$1 AND user_id=$2", [work.id, userId]);
    const mode = ((runs[0]?.role_inputs || {}) as { subjectMode?: keyof typeof AI_RUN_COST }).subjectMode || "pet";
    return AI_RUN_COST[mode] ?? AI_RUN_COST.pet;
  }
  const memorial = work.pet.lifeStage === "memorial";
  const accumulation = isTieredPlugin(work.pluginId) && !memorial ? await measureAccumulation(userId, work.petId) : undefined;
  return resolveDeliverableCost({ pluginId: work.pluginId, accumulation, memorial }).cost;
}

/**
 * 用冻干解锁一件作品。
 *
 * 冻干上线后新作品一律先扣后做、入库即正式版，走到这里的只有上线前遗留的锁定作品
 * （生产从未收过真实款项，实际只存在于测试环境）。按该玩法现价扣一次，解锁副作用与历史支付回调共用。
 */
export async function unlockWork(userId: string, workId: string) {
  return inTransaction(async (database) => {
    await database.query("SELECT id FROM works WHERE id=$1 AND user_id=$2 FOR UPDATE", [workId, userId]);
    const work = await getWork(userId, workId);
    if (!work.locked) return { work, charged: 0 };
    const cost = await workUnlockCost(userId, work);
    if (cost > 0) await spend(userId, { units: cost, bizKey: `spend:work:${workId}:v${work.version}`, title: work.title, refType: "work", refId: workId });
    await applyWorkUnlock(database, workId, userId, work.pluginId);
    return { work: await getWork(userId, workId), charged: cost };
  });
}

/** 历史现金订单（冻干上线前）。新作品不再下单，统一走冻干。 */
export async function createOrder(): Promise<Order> {
  throw new AppError("ORDER_RETIRED", "作品改用冻干制作，不再单独下单", 410);
}

export async function preparePayment(userId: string, orderId: string, client: "web" | "miniprogram" = "web") {
  return prepareOrderPayment(userId, "work", orderId, client);
}

export async function payOrder(userId: string, id: string) {
  const row = await confirmOrderPayment(userId, "work", id, true);
  const order = mapOrder(row);
  return { order, work: await getWork(userId, order.workId) };
}

export async function requestRefund(userId: string, orderId: string, reason: "generation_failed" | "requested") {
  return refundOrderPayment(userId, "work", orderId, reason);
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
  // 生成类原图上没有可见标识：首次交付前确认标识义务，并留交付日志（第九条）。
  if (work.aiGenerated) await assertAiOriginalDelivery(userId, { kind: "work", id: work.id, storageKey: key });
  const extension = format === "pdf" ? "pdf" : format === "image" && key.endsWith(".svg") ? "png" : key.split(".").pop();
  return { key, filename: `${work.pet.name}-${work.plugin.name}.${extension}` };
}

export async function getSharedWork(token: string, accessCode?: string) {
  if (!/^[a-f0-9]{32}$/.test(token)) throw new AppError("SHARE_NOT_FOUND", "分享已关闭或不存在", 404);
  const database = await getDatabase();
  const rows = await database.query("SELECT w.* FROM works w JOIN pets p ON p.id=w.pet_id JOIN users u ON u.id=w.user_id WHERE w.share_token=$1 AND w.public=true AND w.deleted_at IS NULL AND p.deleted_at IS NULL AND u.deleted_at IS NULL", [token]);
  if (!rows[0]) throw new AppError("SHARE_NOT_FOUND", "分享已关闭或不存在", 404);
  const row = rows[0];
  if (row.share_expires_at && new Date(String(row.share_expires_at)).getTime() <= Date.now()) throw new AppError("SHARE_EXPIRED", "分享已经过期", 410);
  if (row.share_access_code_hash) {
    const hash = accessCode ? createHash("sha256").update(accessCode).digest("hex") : "";
    if (hash !== String(row.share_access_code_hash)) throw new AppError("SHARE_ACCESS_CODE_REQUIRED", "请输入正确的分享访问码", 401);
  }
  const work = await hydrateWork(mapWork(row));
  const query = accessCode ? `?code=${encodeURIComponent(accessCode)}` : "";
  return {
    ...work,
    // 显式白名单，私人档案和对象键不随作品对外传播。
    userId: "", outputKey: undefined, previewKey: undefined,
    pet: { id: work.pet.id, name: work.pet.name, species: work.pet.species, lifeStage: work.pet.lifeStage },
    photo: { id: work.photo.id, url: `/api/share/${token}/media/cover${query}` },
    outputUrl: work.outputUrl ? `/api/share/${token}/media/output${query}` : undefined,
  };
}

export async function recordShareAttribution(token: string, eventName: "visit" | "cta" | "duration", source?: string, visitorKey?: string, durationSeconds?: number, accessCode?: string) {
  const work = await getSharedWork(token, accessCode);
  const database = await getDatabase();
  const eventSource = eventName === "duration" ? `${source || "share"};seconds=${Math.max(0, Math.min(86400, durationSeconds || 0))}` : source;
  await database.query("INSERT INTO share_visits (id,work_id,share_token,event_name,source,visitor_key,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(),work.id,token,eventName,eventSource?.slice(0,80)||null,visitorKey?.slice(0,80)||null,new Date()]);
  const [owner] = await database.query("SELECT user_id FROM works WHERE id=$1", [work.id]);
  if (owner && (eventName === "visit" || eventName === "cta")) await recordEvent(String(owner.user_id), eventName === "visit" ? "share_page_visit" : "share_page_cta", work.pluginId, source, { visitorKey });
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

export async function createGeneration(userId: string, input: unknown) {
  return inTransaction(async (database) => {
    const data = generationInputSchema.parse(input);
    await database.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await lockPhotoInputs(userId, data.petId, data.photoIds);
    return createGenerationOperation(userId, input);
  });
}
