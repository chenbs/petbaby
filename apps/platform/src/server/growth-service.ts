import { lockPhotoInputs } from "@/server/photo-deliverable-assets";
﻿/* c8 ignore file -- adapter endpoints are covered by contract tests in deployment environments. */
import "server-only";

import { z } from "zod";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { AiRun, VideoRender } from "@/domain/models";
import { getDatabase, inTransaction } from "@/server/db/client";
import { confirmOrderPayment } from "@/server/payments/service";
import { jsonIdArray, jsonObject, mapAiRoleInputs, mapOrder } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { generateWithFailover, type ImageReference } from "@/server/ai/provider";
import { AI_NOTICE_TEXT, applyAiMetadata } from "@/server/media/ai-label";
import { objectStorage } from "@/server/storage";
import { decryptAddress, encryptAddress } from "@/server/commerce/address";
import { getRuntimePlugin } from "@/plugins/runtime";
import { collectAnnualData } from "@/server/annual/aggregate";
import { REPORT_PHOTOS, buildReportSvg, rasterizeReport, rasterizeReportPreview } from "@/server/annual/report";
import { recordEvent, unlockWork } from "@/server/platform-service";
import { recordAdminAudit } from "@/server/admin/audit";
import { shortestDurationFor } from "@/domain/video-duration";
import {
  buildImageTemplatePrompt,
  getImageTemplate,
  getImageTemplateCandidateCount,
  imageTemplateSupportsReroll,
  type ImageTemplateRerollReason,
} from "@/server/image-template-registry";
import {
  buildPetArtPhotoPrompt,
  PET_ART_PHOTO_TEMPLATE_ID,
  PET_ART_PHOTO_VERSION,
  PET_ART_PHOTO_SCENE_IDS,
  resolvePetArtPhotoScene,
  type PetArtPhotoSceneId,
} from "@/domain/pet-art-photo";
import { completeArtPhotoBatchItem } from "@/server/art-photo-bundle-service";
import { AI_RUN_COST, ANNUAL_REPORT_COST, MAX_TASK_ATTEMPTS, describeCost } from "@/domain/dongan-pricing";
import { refundSpend, spend } from "@/server/wallet/service";
import { assertGenerationCircuit } from "@/server/risk/controls";

/** 宠物艺术写真场景的单一事实来源；旧 AI_STYLE_IDS 仅为历史请求兼容。 */
export const AI_SCENE_IDS = PET_ART_PHOTO_SCENE_IDS;
/** @deprecated 使用 AI_SCENE_IDS；旧 style 入参仍接受并映射到对应场景。 */
export const AI_STYLE_IDS = ["warm-film", "paper-cut", "studio", "fantasy"] as const;

const aiOptions = z.object({
  play: z.enum(["portrait", "storybook", "magazine"]).default("portrait"),
  scene: z.enum(AI_SCENE_IDS).optional(),
  style: z.enum(AI_STYLE_IDS).optional(),
  promptPreset: z.enum(["gentle", "heroic", "curious", "custom"]).default("gentle"),
}).default({ play: "portrait", promptPreset: "gentle" }).transform((options) => ({
  ...options,
  scene: resolvePetArtPhotoScene(options as { scene?: PetArtPhotoSceneId; style?: string }),
}));

const aiInput = z.object({
  pluginId: z.string().min(1),
  petId: z.string().uuid(),
  photoIds: z.array(z.string().uuid()).length(1),
  ownerPhotoIds: z.array(z.string().uuid()).max(1).default([]),
  authorizationConfirmed: z.boolean().default(false),
  templateId: z.string().trim().min(1).max(80).default("pet-expression-grid"),
  prompt: z.string().trim().max(1000).optional(),
  promptVersion: z.string().min(1).max(40).default("portrait-v1"),
  modelVersion: z.string().min(1).max(80).default("provider-v1"),
  idempotencyKey: z.string().min(8).max(120),
  options: aiOptions,
  /** 「再拍一张」：带上原任务与理由，按新任务重新扣费 */
  rerollOf: z.string().uuid().optional(),
  rerollReason: z.enum(["owner-not-like", "pet-not-like", "too-animal", "composition"]).optional(),
});
const addressSchema = z.object({ name: z.string().min(1), phone: z.string().min(6), province: z.string().min(1), city: z.string().min(1), detail: z.string().min(1) });

async function notifyRun(userId: string, runId: string, type: string, title: string, body: string) {
  await (await getDatabase()).query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,$3,$4,$5,$6,now())", [crypto.randomUUID(), userId, type, title, body, `/pages/ai-run/ai-run?id=${runId}`]);
}

/** 单个制作任务的预估耗时（秒）。lingsuan 单张实测 46–62 秒。 */
const AI_SECONDS_PER_RUN = 55;

async function createAiRunOperation(userId: string, input: unknown): Promise<AiRun> {
  const data = aiInput.parse(input);
  const database = await getDatabase();
  const existing = await database.query("SELECT id FROM ai_runs WHERE user_id=$1 AND idempotency_key=$2", [userId, data.idempotencyKey]);
  if (existing[0]) return getAiRun(userId, String(existing[0].id));
  const plugin = await getRuntimePlugin(data.pluginId);
  if (!plugin || plugin.status !== "live" || plugin.category !== "ai-image") throw new AppError("AI_PLUGIN_UNAVAILABLE", "这个玩法暂未开放", 404);
  const template = getImageTemplate(data.templateId);
  if (!template || template.status !== "live" || (!template.masterStorageKey && template.templateId !== PET_ART_PHOTO_TEMPLATE_ID)) throw new AppError("IMAGE_TEMPLATE_UNAVAILABLE", "这个图片模板尚未开放", 404);
  if (template?.subjectMode === "owner-pet" && (!data.authorizationConfirmed || data.ownerPhotoIds.length !== 1)) {
    throw new AppError("OWNER_AUTHORIZATION_REQUIRED", "人宠模板需要 1 张已获授权的主人照片并确认授权", 422);
  }
  if (template?.subjectMode !== "owner-pet" && data.ownerPhotoIds.length) {
    throw new AppError("OWNER_PHOTO_NOT_ALLOWED", "这个模板不接收主人照片", 422);
  }
  const [pets, photos, ownerPhotos] = await Promise.all([
    database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [data.petId, userId]),
    database.query("SELECT id FROM photos WHERE id=ANY($1::uuid[]) AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL", [data.photoIds, data.petId, userId]),
    data.ownerPhotoIds.length
      ? database.query("SELECT id FROM owner_photos WHERE id=ANY($1::uuid[]) AND user_id=$2 AND authorization_confirmed_at IS NOT NULL AND deleted_at IS NULL", [data.ownerPhotoIds, userId])
      : Promise.resolve([]),
  ]);
  if (!pets[0] || photos.length !== data.photoIds.length || ownerPhotos.length !== data.ownerPhotoIds.length) throw new AppError("AI_ASSET_MISMATCH", "主人、宠物或照片不存在，请重新选择", 422);
  const id = crypto.randomUUID();
  const roleInputs: AiRun["roleInputs"] = {
    subjectMode: template.subjectMode,
    templateId: template.templateId,
    templateVersion: template.version,
    ownerPhotoIds: data.ownerPhotoIds,
    petPhotoIds: data.photoIds,
    authorizationConfirmed: template.subjectMode === "owner-pet" ? data.authorizationConfirmed : false,
  };
  const prompt = template.templateId === PET_ART_PHOTO_TEMPLATE_ID
    ? buildPetArtPhotoPrompt(data.options.scene, data.rerollReason)
    : buildImageTemplatePrompt(template, data.rerollReason);
  if (data.rerollReason) roleInputs.rerollReason = data.rerollReason;
  /*
   * 先扣冻干，再入队（36 号文第 2 章）：扣费与写入任务在同一事务，余额不足整体回滚。
   * 没有免费重拍：「再拍一张」就是新建一个任务、重新扣费（rerollOf 记来源，原结果保留）。
   */
  await assertGenerationCircuit();
  const cost = AI_RUN_COST[template.subjectMode] ?? AI_RUN_COST.pet;
  const walletBizKey = `spend:ai_run:${id}`;
  await spend(userId, { units: cost, bizKey: walletBizKey, title: template.title || "创意照片", refType: "ai_run", refId: id });
  await database.query("INSERT INTO ai_runs (id,user_id,plugin_id,pet_id,photo_ids,role_inputs,status,prompt,prompt_version,model_version,provider,options,idempotency_key,candidates,cost,wallet_biz_key,available_at,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'queued',$7,$8,$9,'pending',$10::jsonb,$11,'[]'::jsonb,0,$13,now(),$12)", [id, userId, data.pluginId, data.petId, JSON.stringify(data.photoIds), JSON.stringify(roleInputs), prompt, `template-${roleInputs.templateVersion}`, data.modelVersion, JSON.stringify({ ...data.options, templateId: roleInputs.templateId, dongan: { cost }, ...(data.rerollOf ? { rerollOf: data.rerollOf } : {}) }), data.idempotencyKey, new Date(), walletBizKey]);
  await recordEvent(userId, "ai_created", data.pluginId, "product", { petId: data.petId, templateId: roleInputs.templateId, subjectMode: roleInputs.subjectMode, scene: template.templateId === PET_ART_PHOTO_TEMPLATE_ID ? data.options.scene : undefined });
  return getAiRun(userId, id);
}

async function providerCircuitOpen(provider: string) {
  const rows = await (await getDatabase()).query("SELECT opened_at,manual_open FROM ai_provider_circuits WHERE provider=$1", [provider]);
  if (rows[0]?.manual_open) return true;
  if (!rows[0]?.opened_at) return false;
  return new Date(String(rows[0].opened_at)).getTime() > Date.now() - 60_000;
}

async function recordProviderFailure(provider: string) {
  const threshold = Number(process.env.AI_CIRCUIT_FAILURE_THRESHOLD || 3);
  await (await getDatabase()).query("INSERT INTO ai_provider_circuits (provider,failures,opened_at,manual_open,updated_at) VALUES ($1,1,NULL,false,now()) ON CONFLICT (provider) DO UPDATE SET failures=ai_provider_circuits.failures+1,opened_at=CASE WHEN ai_provider_circuits.failures+1 >= $2 THEN now() ELSE ai_provider_circuits.opened_at END,updated_at=now()", [provider, threshold]);
}

async function clearProviderFailures(provider: string) {
  await (await getDatabase()).query("INSERT INTO ai_provider_circuits (provider,failures,opened_at,manual_open,updated_at) VALUES ($1,0,NULL,false,now()) ON CONFLICT (provider) DO UPDATE SET failures=0,opened_at=CASE WHEN ai_provider_circuits.manual_open THEN ai_provider_circuits.opened_at ELSE NULL END,updated_at=now()", [provider]);
}

function extensionOf(contentType: string) {
  return contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
}

async function loadRequiredReference(storageKey: string, allowedPrefix: string, filename: string): Promise<ImageReference> {
  if (!storageKey.startsWith(allowedPrefix)) throw new AppError("AI_REFERENCE_NOT_ALLOWED", "参考图路径不合法", 422);
  const object = await objectStorage.get(storageKey).catch(() => null);
  if (!object || !object.contentType.startsWith("image/") || !object.body.byteLength) {
    throw new AppError("AI_REFERENCE_MISSING", "必需参考图不存在，请重新选择或联系运营补齐母版", 422);
  }
  return { body: object.body, contentType: object.contentType, filename: `${filename}.${extensionOf(object.contentType)}` };
}

async function loadPetReference(userId: string, petId: string, photoId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT storage_key FROM photos WHERE id=$1 AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL",
    [photoId, petId, userId],
  );
  if (!rows[0]) throw new AppError("AI_PET_REFERENCE_MISSING", "宠物身份图不存在，请重新选择", 422);
  return loadRequiredReference(String(rows[0].storage_key), `private/${userId}/`, "pet-identity");
}

async function loadOwnerReference(userId: string, ownerPhotoId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT storage_key FROM owner_photos WHERE id=$1 AND user_id=$2 AND authorization_confirmed_at IS NOT NULL AND deleted_at IS NULL",
    [ownerPhotoId, userId],
  );
  if (!rows[0]) throw new AppError("AI_OWNER_REFERENCE_MISSING", "主人身份图不存在或未确认授权，请重新选择", 422);
  return loadRequiredReference(String(rows[0].storage_key), `private/${userId}/owner/`, "owner-identity");
}

async function loadTemplateReferences(row: Record<string, unknown>) {
  const userId = String(row.user_id);
  const petId = String(row.pet_id);
  const roleInputs = mapAiRoleInputs(row.role_inputs);
  if (roleInputs.templateId === PET_ART_PHOTO_TEMPLATE_ID) {
    if (!["v01", "v03", "v04", "v05", "v06", "v07", "v08", "v09", "v10", "v11", "v12", "v13", PET_ART_PHOTO_VERSION].includes(roleInputs.templateVersion || "") || roleInputs.subjectMode !== "pet" || roleInputs.petPhotoIds.length !== 1 || roleInputs.ownerPhotoIds.length) {
      throw new AppError("AI_TEMPLATE_SNAPSHOT_INVALID", "写真任务输入已失效，请重新创建", 409);
    }
    const reference = await loadPetReference(userId, petId, roleInputs.petPhotoIds[0]);
    return { template: getImageTemplate(PET_ART_PHOTO_TEMPLATE_ID)!, references: [reference] };
  }
  const template = roleInputs.templateId ? getImageTemplate(roleInputs.templateId) : undefined;
  if (!template?.masterStorageKey || template.version !== roleInputs.templateVersion || template.subjectMode !== roleInputs.subjectMode) {
    throw new AppError("AI_TEMPLATE_SNAPSHOT_INVALID", "任务使用的模板版本已失效，请重新创建", 409);
  }
  if (roleInputs.petPhotoIds.length !== 1) throw new AppError("AI_PET_REFERENCE_REQUIRED", "任务缺少唯一的宠物身份图", 422);
  const masterReference = await loadRequiredReference(
    template.masterStorageKey,
    "samples/image-templates/",
    template.subjectMode === "pet-human" ? "effect-reference" : "owned-master",
  );
  if (template.subjectMode === "pet-human") {
    const petReference = await loadPetReference(userId, petId, roleInputs.petPhotoIds[0]);
    // 新人化方案固定角色顺序：用户宠物原图是图一，自有效果图是图二。
    return { template, references: [petReference, masterReference] };
  }
  const references: ImageReference[] = [masterReference];
  if (template.subjectMode === "owner-pet") {
    if (!roleInputs.authorizationConfirmed || roleInputs.ownerPhotoIds.length !== 1) {
      throw new AppError("OWNER_AUTHORIZATION_REQUIRED", "人宠模板缺少已授权的主人身份图", 422);
    }
    references.push(await loadOwnerReference(userId, roleInputs.ownerPhotoIds[0]));
  }
  references.push(await loadPetReference(userId, petId, roleInputs.petPhotoIds[0]));
  return { template, references };
}

async function claimNextAiRun() {
  const capacity = Math.max(1, Math.min(8, Math.floor(Number(process.env.AI_MAX_CONCURRENCY || 1)) || 1));
  return inTransaction(async (database) => {
    const expired = await database.query("SELECT slot_id,run_id,attempt FROM ai_provider_slots WHERE run_id IS NOT NULL AND lease_until<now() FOR UPDATE SKIP LOCKED");
    for (const slot of expired) {
      await database.query("UPDATE ai_runs SET status='queued',locked_at=NULL,available_at=now() WHERE id=$1 AND attempt=$2 AND status='processing'", [slot.run_id, slot.attempt]);
      await database.query("UPDATE art_photo_batch_items SET status='queued',locked_at=NULL,updated_at=now() WHERE run_id=$1 AND status='processing'", [slot.run_id]);
      await database.query("UPDATE ai_provider_slots SET run_id=NULL,attempt=NULL,lease_until=NULL WHERE slot_id=$1", [slot.slot_id]);
    }
    const slots = await database.query("SELECT slot_id FROM ai_provider_slots WHERE slot_id<=$1 AND run_id IS NULL ORDER BY slot_id FOR UPDATE SKIP LOCKED LIMIT 1", [capacity]);
    if (!slots[0]) return null;
    const queued = await database.query("SELECT id FROM ai_runs WHERE status='queued' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1");
    if (!queued[0]) return null;
    const rows = await database.query("UPDATE ai_runs SET status='processing',attempt=attempt+1,locked_at=now() WHERE id=$1 AND status='queued' RETURNING *", [queued[0].id]);
    if (!rows[0]) return null;
    const row = rows[0];
    await database.query("UPDATE ai_provider_slots SET run_id=$2,attempt=$3,lease_until=now()+interval '15 minutes' WHERE slot_id=$1", [slots[0].slot_id, row.id, row.attempt]);
    const options = jsonObject<Record<string, unknown>>(row.options, {});
    if (options.artPhotoBatchItemId) {
      await database.query("UPDATE art_photo_batch_items SET status='processing',attempt=attempt+1,locked_at=now(),updated_at=now() WHERE id=$1 AND status='queued'", [String(options.artPhotoBatchItemId)]);
      await database.query("UPDATE art_photo_batches SET status='processing',updated_at=now() WHERE id=$1 AND status='queued'", [String(options.artPhotoBatchId)]);
    }
    return { row, slotId: Number(slots[0].slot_id) };
  });
}

export async function processNextAiRun() {
  const claim = await claimNextAiRun();
  if (!claim) return null;
  const database = await getDatabase();
  const { row, slotId } = claim;
  const runId = String(row.id); const userId = String(row.user_id); const prompt = String(row.prompt);
  const attempt = Number(row.attempt);
  const heartbeat = setInterval(() => {
    database.query("UPDATE ai_provider_slots SET lease_until=now()+interval '15 minutes' WHERE slot_id=$1 AND run_id=$2 AND attempt=$3", [slotId, runId, attempt]).catch(() => undefined);
    database.query("UPDATE ai_runs SET locked_at=now() WHERE id=$1 AND attempt=$2 AND status='processing'", [runId, attempt]).catch(() => undefined);
  }, 60_000);
  try {
        const templateInput = await loadTemplateReferences(row);
    const [templateWidth, templateHeight] = templateInput.template.size.split("x").map(Number);
    const references = templateInput.references;
    const runOptions = jsonObject<Record<string, unknown>>(row.options, {});
    const candidateCount = runOptions.artPhotoBatchItemId ? 1 : getImageTemplateCandidateCount(templateInput.template);
    const result = await generateWithFailover(
      prompt,
      candidateCount,
      providerCircuitOpen,
      recordProviderFailure,
      references,
      { size: templateInput.template.size, quality: "high", inputFidelity: "high" },
    );
    await clearProviderFailures(result.provider.name);
    const generationCost = Number(process.env.AI_IMAGE_COST || 0.08) * result.images.length;
        const candidates = await Promise.all(result.images.map(async (image, index) => {
      const normalized = new Uint8Array(await sharp(Buffer.from(image.body)).resize(templateWidth, templateHeight, { fit: "cover" }).png().toBuffer());
      const contentId = `${runId}-${index}`;
      const output = await applyAiMetadata(normalized, contentId);
      const extension = "png";
      const outputKey = `private/${userId}/ai/${runId}-a${attempt}-${index}.${extension}`;
      await objectStorage.put(outputKey, output, "image/png");
      const previewKey = `private/${userId}/ai/${runId}-a${attempt}-${index}-preview.png`;
      /*
       * 预览只缩图，不叠任何可见标记（2026-09 起取消营销水印与「AI 生成」角标，
       * 提示改由小程序界面蒙层承担）。长边 640 是付费墙的依据：原图才是完整分辨率。
       *
       * 缩图会重新编码，sharp 默认丢 EXIF —— 所以对预览**再写一次**隐式元数据，
       * 否则免费预览在文件层没有任何标识（第五条）。
       */
      const resized = await sharp(Buffer.from(output)).resize(640, 640, { fit: "inside" }).png().toBuffer();
      await objectStorage.put(previewKey, await applyAiMetadata(new Uint8Array(resized), contentId), "image/png");
      return {
        id: `${runId}-${index}`,
        outputKey,
        previewKey,
        aiGenerated: true as const,
      };
    }));
    const completed = await inTransaction(async (transaction) => {
      const rows = await transaction.query("UPDATE ai_runs SET status='succeeded',provider=$2,model_version=$3,candidates=$4::jsonb,cost=cost+$5,locked_at=NULL WHERE id=$1 AND status='processing' AND attempt=$6 RETURNING id", [runId, result.provider.name, result.provider.modelVersion, JSON.stringify(candidates), generationCost, attempt]);
      if (rows[0] && runOptions.artPhotoBatchItemId) await completeArtPhotoBatchItem({ runId, status: "succeeded", outputKey: candidates[0]?.outputKey, previewKey: candidates[0]?.previewKey });
      return rows;
    });
    if (!completed[0]) { await Promise.all(candidates.flatMap((candidate) => [candidate.outputKey, candidate.previewKey].filter((key): key is string => Boolean(key)).map((key) => objectStorage.delete(key).catch(() => undefined)))); return { id: runId, status: "cancelled" as const }; }
    await database.query("INSERT INTO ai_cost_ledger (id,run_id,provider,model_version,units,amount,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'succeeded',now())", [crypto.randomUUID(), runId, result.provider.name, result.provider.modelVersion, candidates.length, generationCost]);
    await recordEvent(userId, "ai_succeeded", String(row.plugin_id), "worker", { provider: result.provider.name, cost: generationCost });
    /*
     * 单张出图（2026-10 取消 2 选 1）：出图即选中并归档进作品柜，用户不打开结果页作品也在。
     * 归档失败（例如原照在出图期间被删）不影响任务成功，结果页仍可看到这张预览。
     */
    if (!runOptions.artPhotoBatchItemId && candidates.length === 1) await selectAiCandidate(userId, runId, candidates[0].id).catch(() => undefined);
    // 独立制作任务完成后发站内通知；写真套餐的逐张任务由批次整体通知，这里不重复。
    if (!runOptions.artPhotoBatchItemId) await notifyRun(userId, runId, "ai_run_ready", "照片拍好了", candidates.length > 1 ? `${candidates.length} 张已经出来了，去挑一张喜欢的` : "已经拍好了，去看看");
    return { id: runId, status: "succeeded" as const, provider: result.provider.name, candidates };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "AI_PROVIDER_UNAVAILABLE";
    const runOptions = jsonObject<Record<string, unknown>>(row.options, {});
    // 系统自动重试 2 次（共 3 次尝试），仍失败才进入终态并全额退还冻干（36 号文 D5）。
    if (attempt < MAX_TASK_ATTEMPTS) {
      const retried = await inTransaction(async (transaction) => {
        const rows = await transaction.query("UPDATE ai_runs SET status='queued',error_code=$2,retry_count=retry_count+1,available_at=now()+interval '2 seconds',locked_at=NULL WHERE id=$1 AND status='processing' AND attempt=$3 RETURNING id", [runId, message, attempt]);
        if (rows[0] && runOptions.artPhotoBatchItemId) await transaction.query("UPDATE art_photo_batch_items SET status='queued',error_code=$2,locked_at=NULL,updated_at=now() WHERE id=$1 AND status='processing' AND run_id=$3", [String(runOptions.artPhotoBatchItemId), message, runId]);
        return rows;
      });
      return { id: runId, status: retried[0] ? "retrying" as const : "cancelled" as const };
    }
    const failed = await inTransaction(async (transaction) => {
      const rows = await transaction.query("UPDATE ai_runs SET status='failed',error_code=$2,locked_at=NULL WHERE id=$1 AND status='processing' AND attempt=$3 RETURNING id", [runId, message, attempt]);
      if (rows[0] && runOptions.artPhotoBatchItemId) await completeArtPhotoBatchItem({ runId, status: "failed", errorCode: message });
      return rows;
    });
    if (!failed[0]) return { id: runId, status: "cancelled" as const };
    await database.query("INSERT INTO ai_cost_ledger (id,run_id,provider,model_version,units,amount,status,created_at) VALUES ($1,$2,'unknown','unknown',0,0,'failed',now())", [crypto.randomUUID(), runId]);
    const returned = row.wallet_biz_key ? await refundSpend(String(row.wallet_biz_key), { title: "没有拍成 · 已退还" }) : 0;
    if (!runOptions.artPhotoBatchItemId) await notifyRun(userId, runId, "ai_run_failed", "这次没有拍成", returned ? `已退还 ${describeCost(returned)}冻干，可以再试一次` : "可以再试一次");
    return { id: runId, status: "failed" as const, errorCode: message };
  } finally {
    clearInterval(heartbeat);
    await database.query("UPDATE ai_provider_slots SET run_id=NULL,attempt=NULL,lease_until=NULL WHERE slot_id=$1 AND run_id=$2 AND attempt=$3", [slotId, runId, attempt]);
  }
}

export async function getAiRun(userId: string, id: string) {
  const database = await getDatabase(); const rows = await database.query("SELECT * FROM ai_runs WHERE id=$1 AND user_id=$2", [id,userId]);
  if (!rows[0]) throw new AppError("NOT_FOUND", "制作任务不存在", 404);
  const row = rows[0];
  const [workRows, orderRows, queueRows] = await Promise.all([
    row.work_id ? database.query("SELECT locked FROM works WHERE id=$1", [row.work_id]) : Promise.resolve([]),
    row.order_id ? database.query("SELECT * FROM orders WHERE id=$1", [row.order_id]) : Promise.resolve([]),
    row.status === "queued" ? database.query<{ position: number }>("SELECT count(*)::int position FROM ai_runs WHERE status='queued' AND created_at<=$1", [row.created_at]) : Promise.resolve([]),
  ]);
  const queuePosition = Number(queueRows[0]?.position || 0) || undefined;
  const roleInputs = mapAiRoleInputs(row.role_inputs);
  return {
    id: String(row.id), userId: String(row.user_id), pluginId: String(row.plugin_id), petId: String(row.pet_id), photoIds: jsonIdArray(row.photo_ids),
    status: row.status as AiRun["status"], candidates: (row.candidates || []) as AiRun["candidates"], aiNotice: AI_NOTICE_TEXT, selectedId: row.selected_id ? String(row.selected_id) : undefined,
    selectedUnlocked: workRows[0] ? !Boolean(workRows[0].locked) : false, provider: row.provider && row.provider !== "pending" ? String(row.provider) : undefined,
    modelVersion: row.model_version ? String(row.model_version) : undefined, prompt: String(row.prompt || ""), promptVersion: String(row.prompt_version || "v1"), options: jsonObject<Record<string, unknown>>(row.options, {}),
    roleInputs,
    errorCode: row.error_code ? String(row.error_code) : undefined, attempt: Number(row.attempt || 0), retryCount: Number(row.retry_count || 0),
    rerollCount: Number(row.reroll_count || 0),
    // 没有免费重拍（D8）。「再拍一张」是新任务，按 cost 重新扣费；人化模板不支持换理由重拍。
    rerollRemaining: 0,
    cost: Number(row.cost),
    donganCost: AI_RUN_COST[roleInputs.subjectMode] ?? AI_RUN_COST.pet,
    paidWithDongan: Boolean(row.wallet_biz_key),
    // lingsuan 单张实测 46–62 秒；按每位 55 秒估算，比原来写死的 20 秒更接近真实等待。
    queuePosition, estimatedSeconds: queuePosition ? queuePosition * AI_SECONDS_PER_RUN : row.status === "processing" ? AI_SECONDS_PER_RUN : undefined,
    workId: row.work_id ? String(row.work_id) : undefined, order: orderRows[0] ? mapOrder(orderRows[0]) : undefined, createdAt: new Date(String(row.created_at)).toISOString(),
  } satisfies AiRun;
}

/**
 * 作品柜「进行中」：排队、制作中、失败待重试，以及已出图但还没选中的独立制作任务。
 *
 * 写真套餐的逐张任务（options.artPhotoBatchItemId）不在这里单列，由套餐批次整体展示；
 * 已选中出作品的任务已进作品柜，也不重复。只取最近 30 天，避免老失败任务长期占位。
 */
export async function listAiRuns(userId: string) {
  const rows = await (await getDatabase()).query(
    `SELECT id,plugin_id,pet_id,status,role_inputs,candidates,created_at FROM ai_runs
     WHERE user_id=$1 AND work_id IS NULL AND status IN ('queued','processing','succeeded','failed')
       AND coalesce(options->>'artPhotoBatchItemId','')='' AND created_at > now() - interval '30 days'
     ORDER BY created_at DESC LIMIT 20`,
    [userId],
  );
  return rows.map((row) => {
    const roleInputs = mapAiRoleInputs(row.role_inputs);
    const template = roleInputs.templateId ? getImageTemplate(roleInputs.templateId, { includePending: true }) : undefined;
    const candidates = (Array.isArray(row.candidates) ? row.candidates : []) as AiRun["candidates"];
    return {
      id: String(row.id), pluginId: String(row.plugin_id), petId: row.pet_id ? String(row.pet_id) : undefined,
      status: String(row.status) as AiRun["status"], title: template?.title || "创意照片", subjectMode: roleInputs.subjectMode,
      candidateCount: candidates.length, previewCandidateId: candidates[0]?.id, createdAt: new Date(String(row.created_at)).toISOString(),
      aiNotice: AI_NOTICE_TEXT,
    };
  });
}

export async function selectAiCandidate(userId: string, id: string, candidateId: string) {
  await inTransaction(async (database) => {
    // 与重抽/删除保持宠物→任务锁顺序，并在等待后重新读取 work_id。
    const initial = await getAiRun(userId, id);
    await lockPhotoInputs(userId, initial.petId, []);
    await database.query("SELECT id FROM ai_runs WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId]);
    const run = await getAiRun(userId, id);

    if (run.status !== "succeeded") throw new AppError("AI_NOT_READY", "还在制作中，请稍后再选", 409);
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate?.outputKey || !candidate.previewKey) throw new AppError("AI_CANDIDATE_NOT_FOUND", "这张照片不存在", 404);
    if (run.order && run.selectedId !== candidateId) throw new AppError("AI_SELECTION_LOCKED", "订单已创建，不能再更换这张照片", 409);
    if (run.workId) {
      await (await getDatabase()).query("UPDATE ai_runs SET selected_id=$3 WHERE id=$1 AND user_id=$2", [id, userId, candidateId]);
      return;
    }
    // 选择候选会新建作品并引用原照片；与删除照片共用宠物→照片锁，
    // 防止删除已经落库而选择操作仍把工作指向不存在的素材。
    await lockPhotoInputs(userId, run.petId, run.photoIds);
    const db = await getDatabase();
    const pets = await db.query("SELECT name FROM pets WHERE id=$1 AND user_id=$2", [run.petId, userId]);
    /*
     * 作品标题用「宠物名 + 模板名」，不出现「AI」字样（2026-09 文案口径）；
     * AI 提示由界面蒙层承担。作品长期保存，不写 expires_at。
     */
    const templateTitle = run.roleInputs.templateId === PET_ART_PHOTO_TEMPLATE_ID ? "宠物艺术写真" : getImageTemplate(String(run.roleInputs.templateId || ""), { includePending: true })?.title || "创意照片";
    const workId = crypto.randomUUID(); const now = new Date(); const title = `${String(pets[0]?.name || "我")}的${templateTitle}`;
    const subtitle = run.candidates.length > 1 ? `从 ${run.candidates.length} 张里挑中的这一张` : "为我拍的这一张";
    // 已扣冻干的任务直接归档为正式作品；没有扣费键的是冻干上线前的历史任务，仍按当时口径锁定。
    const paid = run.paidWithDongan;
    await db.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,source_id,locked,public,version,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'麻麻抱我照相馆',$9,$10,'image','ai',$11,$13,false,1,NULL,$12)", [workId, userId, run.pluginId, run.petId, run.photoIds[0], title, subtitle, `MB-${id.slice(0, 8).toUpperCase()}`, candidate.outputKey, candidate.previewKey, id, now, !paid]);
    if (paid) await db.query("UPDATE ai_runs SET selected_unlocked=true WHERE id=$1", [id]);
    await db.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7)", [crypto.randomUUID(), workId, title, subtitle, candidate.outputKey, candidate.previewKey, now]);
    await db.query("UPDATE ai_runs SET selected_id=$3,work_id=$4 WHERE id=$1 AND user_id=$2", [id, userId, candidateId, workId]);
    await recordEvent(userId, "ai_candidate_selected", run.pluginId, "product", { runId: id, candidateId });
  });
  return getAiRun(userId, id);
}

export async function unlockAiCandidate(userId: string, id: string) {
  const run = await getAiRun(userId, id);
  if (!run.selectedId || !run.workId) throw new AppError("AI_CANDIDATE_NOT_SELECTED", "这张照片还没归档好，请稍后再试", 409);
  // 冻干上线前的历史任务：按该模板现价用冻干解锁（新任务入库即正式版，不会走到这里）。
  await unlockWork(userId, run.workId);
  return getAiRun(userId, id);
}

/**
 * 「再拍一张」（2026-10-08 起）：按原任务的模板、照片与场景**新建一个任务并重新扣费**，原结果保留。
 * 没有免费重拍；理由（构图 / 不像 / 太像动物）仍写进提示词，让第二张往对的方向改。
 */
async function rerollAiRunOperation(userId: string, id: string, reason: ImageTemplateRerollReason = "composition", idempotencyKey?: string) {
  const run = await getAiRun(userId, id);
  if (!["succeeded", "failed"].includes(run.status)) throw new AppError("AI_REROLL_NOT_READY", "这一张还在制作中，稍后再拍", 409);

  const template = run.roleInputs.templateId ? getImageTemplate(run.roleInputs.templateId) : undefined;
  if (!template) throw new AppError("IMAGE_TEMPLATE_UNAVAILABLE", "这个图片模板已下架，不能继续重抽", 409);
  if (!imageTemplateSupportsReroll(template)) throw new AppError("AI_REROLL_NOT_SUPPORTED", "「如果我是人」不支持重抽", 409);
  if (reason === "owner-not-like" && template.subjectMode !== "owner-pet") throw new AppError("REROLL_REASON_INVALID", "单宠模板不能选择主人不像", 422);
  if (reason === "too-animal" && template.subjectMode !== "pet-human") throw new AppError("REROLL_REASON_INVALID", "只有宠物人化模板可以选择太像动物", 422);
  const scene = resolvePetArtPhotoScene({
    scene: typeof run.options.scene === "string" && (AI_SCENE_IDS as readonly string[]).includes(run.options.scene) ? run.options.scene as PetArtPhotoSceneId : undefined,
    style: typeof run.options.style === "string" ? run.options.style : undefined,
  });
  const options = { ...run.options, scene } as Record<string, unknown>;
  delete options.dongan;
  delete options.rerollOf;
  return createAiRunOperation(userId, {
    pluginId: run.pluginId, petId: run.petId, photoIds: run.roleInputs.petPhotoIds.length ? run.roleInputs.petPhotoIds : run.photoIds,
    ownerPhotoIds: run.roleInputs.ownerPhotoIds, authorizationConfirmed: run.roleInputs.authorizationConfirmed,
    templateId: template.templateId, promptVersion: run.promptVersion, modelVersion: "provider-v1",
    idempotencyKey: idempotencyKey || `reroll-${id}-${crypto.randomUUID()}`, options, rerollOf: id, rerollReason: reason,
  });
}

/** 没有用户手动重试（D8）：失败已由系统自动重试 2 次并全额退还冻干，想再拍就新建任务。 */
async function retryAiRunOperation() {
  throw new AppError("AI_RETRY_RETIRED", "这一张已经退还冻干，想再拍请点「再拍一张」", 410);
}

export async function cancelAiRun(userId: string, id: string) {
  return inTransaction(async (database) => {
    const rows = await database.query("UPDATE ai_runs SET status='cancelled',cancelled_at=now(),locked_at=NULL WHERE id=$1 AND user_id=$2 AND status='queued' RETURNING id,wallet_biz_key", [id, userId]);
    if (!rows[0]) throw new AppError("AI_NOT_CANCELLABLE", "任务已开始处理，请在处理结束后再删除照片", 409);
    // 排队中取消：还没调用供应商，全额退还。
    if (rows[0].wallet_biz_key) await refundSpend(String(rows[0].wallet_biz_key), { title: "取消制作 · 已退还" });
    return getAiRun(userId, id);
  });
}

export async function createVideoRender(userId:string,input:unknown):Promise<VideoRender> {
  const data=z.object({pluginId:z.string().min(1),workId:z.string().uuid().optional(),photos:z.array(z.string().min(1)).min(1).max(20),captions:z.array(z.string().max(120)).max(20).default([]),bgm:z.enum(["none","calm","bright"]).default("none"),cover:z.string().min(1).optional()}).parse(input);
  return inTransaction(async (database) => {
  const keys = [...new Set([...data.photos, ...(data.cover ? [data.cover] : [])])];
  const photos = await database.query("SELECT id,pet_id,storage_key FROM photos WHERE user_id=$1 AND storage_key=ANY($2::text[]) AND deleted_at IS NULL", [userId, keys]);
  if (photos.length !== keys.length || new Set(photos.map((photo) => photo.pet_id)).size !== 1) throw new AppError("PHOTO_PET_MISMATCH", "请选择当前宠物照片库中的照片", 422);
  const petId = String(photos[0].pet_id), photoIds = photos.map((photo) => String(photo.id));
  await lockPhotoInputs(userId, petId, photoIds);
  if (data.workId && !(await database.query("SELECT id FROM works WHERE id=$1 AND user_id=$2 AND pet_id=$3 AND deleted_at IS NULL", [data.workId, userId, petId])).length) throw new AppError("NOT_FOUND", "作品不存在", 404);
  const id=crypto.randomUUID(); const createdAt=new Date();
  // 同互动页导出：这条入口不让用户选时长，取能容下张数的最短档并显式写入 config。
  await database.query("INSERT INTO video_renders (id,user_id,plugin_id,status,config,created_at) VALUES ($1,$2,$3,'queued',$4::jsonb,$5)",[id,userId,data.pluginId,JSON.stringify({workId:data.workId,petId,photoIds,photos:data.photos,captions:data.captions,bgm:data.bgm,cover:data.cover,durationSeconds:shortestDurationFor(keys.length)}),createdAt]);
  return {id,userId,pluginId:data.pluginId,status:"queued",progress:0,createdAt:createdAt.toISOString()};
  });
}
export async function getVideoRender(userId:string,id:string){const rows=await (await getDatabase()).query("SELECT * FROM video_renders WHERE id=$1 AND user_id=$2",[id,userId]);if(!rows[0])throw new AppError("VIDEO_NOT_FOUND","视频任务不存在",404);return rows[0];}

/**
 * 订阅授权登记。这是**唯一**能产生「有效授权」的入口。
 *
 * `on_this_day` 也走这里（改造项 E2）：原先 `timeline-service.scheduleOnThisDay`
 * 凭空插一条 `status='scheduled'` 的记录当授权，而 `processDueMessages` 取
 * `status IN ('active','scheduled')` 会直接投递 —— 无授权下发会被微信拦截。
 * 补上授权门之后，若这里不放行 `on_this_day`，那条推送就永远无法被授权，
 * 于是整个功能静默失效：两处必须同时改。
 *
 * 授权记录不带 `scheduled_at`（这条路径的 scheduledAt 是可选的），
 * 投递记录才带 —— 两者靠 `status` 区分：授权是 `active`，投递排期是 `scheduled`。
 */
export async function subscribeReminder(userId:string,input:unknown) {
  const data=z.object({petId:z.string().uuid().optional(),eventType:z.enum(["birthday","got_home","holiday","on_this_day"]),templateCode:z.string().max(80).default("pet-milestone-v1"),scheduledAt:z.string().datetime().optional(),consent:z.literal(true),wechatAuthorization:z.enum(["accept","reject","ban"]).default("accept")}).parse(input); const id=crypto.randomUUID(); const database=await getDatabase(); if(data.petId){const pets=await database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",[data.petId,userId]);if(!pets[0])throw new AppError("PET_NOT_FOUND","宠物档案不存在",404);} const status=data.wechatAuthorization==="accept"?"active":"authorization_required"; await database.query("INSERT INTO message_subscriptions (id,user_id,pet_id,event_type,template_code,status,scheduled_at,consented_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)",[id,userId,data.petId||null,data.eventType,data.templateCode,status,data.scheduledAt?new Date(data.scheduledAt):null,new Date(),new Date()]); return {id,petId:data.petId,eventType:data.eventType,templateCode:data.templateCode,status,scheduledAt:data.scheduledAt};
}

export async function scheduleUpcomingReminders(userId: string, now = new Date()) {
  return inTransaction(async (database) => {
  const pets = await database.query("SELECT id,birthday,date_type FROM pets WHERE user_id=$1 AND deleted_at IS NULL AND life_stage<>'memorial' AND birthday IS NOT NULL ORDER BY id FOR UPDATE", [userId]);
  const scheduled: Array<{ petId: string; eventType: string; scheduledAt: string }> = [];
  for (const pet of pets) {
    const eventType = String(pet.date_type || "birthday");
    if (!["birthday", "got_home"].includes(eventType)) continue;
    const date = String(pet.birthday);
    const target = new Date(`${date.slice(0, 4)}-${date.slice(5, 10)}T09:00:00.000Z`);
    if (!Number.isFinite(target.getTime())) continue;
    target.setUTCFullYear(now.getUTCFullYear());
    if (target.getTime() <= now.getTime()) target.setUTCFullYear(target.getUTCFullYear() + 1);
    const scheduledAt = new Date(target.getTime() - 7 * 86400000);
    if (scheduledAt.getTime() <= now.getTime()) continue;
    const existing = await database.query("SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type=$2 AND scheduled_at=$3 AND pet_id=$4 AND status IN ('active','scheduled','sent')", [userId, eventType, scheduledAt, pet.id]);
    if (existing[0]) continue;
    const consent = await database.query("UPDATE message_subscriptions SET status='consumed',status_updated_at=now() WHERE id=(SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type=$2 AND status='active' AND revoked_at IS NULL AND scheduled_at IS NULL AND (pet_id=$3 OR pet_id IS NULL) ORDER BY created_at,id LIMIT 1 FOR UPDATE) AND status='active' RETURNING template_code,consented_at", [userId, eventType, pet.id]);
    if (!consent.length) continue;
    await database.query("INSERT INTO message_subscriptions (id,user_id,pet_id,event_type,template_code,status,scheduled_at,consented_at,created_at) VALUES ($1,$2,$3,$4,$5,'scheduled',$6,$7,$8)", [crypto.randomUUID(), userId, pet.id, eventType, consent[0].template_code, scheduledAt, consent[0].consented_at, now]);
    scheduled.push({ petId: String(pet.id), eventType, scheduledAt: scheduledAt.toISOString() });
  }
  return scheduled;
  });
}
export async function scheduleAllUpcomingReminders(now = new Date()) { const users = await (await getDatabase()).query("SELECT id FROM users"); let count = 0; for (const user of users) count += (await scheduleUpcomingReminders(String(user.id), now)).length; return count; }

export async function ensurePhysicalSkus(){const database=await getDatabase();for(const item of [["art-print-a4","A4 艺术微喷",39.9,"image"],["memorial-album","精装纪念册",99.9,"image"]])await database.query("INSERT INTO physical_skus (id,code,name,amount,required_asset_kind,status,version,created_at) VALUES ($1,$2,$3,$4,$5,'active',1,$6) ON CONFLICT (code,version) DO NOTHING",[crypto.randomUUID(),item[0],item[1],item[2],item[3],new Date()]);return database;}
export async function listPhysicalSkus(){return (await ensurePhysicalSkus()).query("SELECT code,name,amount,required_asset_kind,version FROM physical_skus WHERE status='active' ORDER BY amount");}
export async function listAddresses(userId:string){return (await getDatabase()).query("SELECT id,label,masked,is_default,created_at,updated_at FROM user_addresses WHERE user_id=$1 ORDER BY is_default DESC,updated_at DESC",[userId]);}
export async function createAddress(userId:string,input:unknown){const data=z.object({label:z.string().min(1).max(30),address:addressSchema,isDefault:z.boolean().default(false)}).parse(input);const database=await getDatabase();if(data.isDefault)await database.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1",[userId]);const masked={name:data.address.name.slice(0,1)+"**",phone:data.address.phone.slice(0,3)+"****"+data.address.phone.slice(-4),region:`${data.address.province}${data.address.city}`,detail:data.address.detail.slice(0,4)+"***"};const rows=await database.query("INSERT INTO user_addresses (id,user_id,label,ciphertext,masked,is_default,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$7) RETURNING id,label,masked,is_default,created_at,updated_at",[crypto.randomUUID(),userId,data.label,encryptAddress(data.address),JSON.stringify(masked),data.isDefault,new Date()]);return rows[0];}
export async function updateAddress(userId:string,id:string,input:unknown){const data=z.object({label:z.string().min(1).max(30),address:addressSchema,isDefault:z.boolean().default(false)}).parse(input);const database=await getDatabase();if(data.isDefault)await database.query("UPDATE user_addresses SET is_default=false WHERE user_id=$1",[userId]);const masked={name:data.address.name.slice(0,1)+"**",phone:data.address.phone.slice(0,3)+"****"+data.address.phone.slice(-4),region:`${data.address.province}${data.address.city}`,detail:data.address.detail.slice(0,4)+"***"};const rows=await database.query("UPDATE user_addresses SET label=$3,ciphertext=$4,masked=$5::jsonb,is_default=$6,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id,label,masked,is_default,created_at,updated_at",[id,userId,data.label,encryptAddress(data.address),JSON.stringify(masked),data.isDefault]);if(!rows[0])throw new AppError("ADDRESS_NOT_FOUND","收货地址不存在",404);return rows[0];}
export async function deleteAddress(userId:string,id:string){const rows=await (await getDatabase()).query("DELETE FROM user_addresses WHERE id=$1 AND user_id=$2 RETURNING id",[id,userId]);if(!rows[0])throw new AppError("ADDRESS_NOT_FOUND","收货地址不存在",404);return{deleted:true};}
export async function createPhysicalOrder(userId:string,input:unknown) {
  const data=z.object({workId:z.string().uuid(),sku:z.string().min(1),address:addressSchema.optional(),addressId:z.string().uuid().optional()}).refine(value=>value.address||value.addressId,{message:"请选择或填写收货地址"}).parse(input); const id=crypto.randomUUID(); const database=await getDatabase(); await ensurePhysicalSkus(); const works=await database.query("SELECT id,asset_kind FROM works WHERE id=$1 AND user_id=$2 AND locked=false AND deleted_at IS NULL",[data.workId,userId]);if(!works[0])throw new AppError("WORK_NOT_UNLOCKED","实体商品只能使用已解锁作品",409);const skus=await database.query("SELECT * FROM physical_skus WHERE code=$1 AND status='active' ORDER BY version DESC LIMIT 1",[data.sku]);const sku=skus[0];if(!sku)throw new AppError("PHYSICAL_SKU_UNAVAILABLE","商品规格已下架",409);if(sku.required_asset_kind&&sku.required_asset_kind!==works[0].asset_kind)throw new AppError("PHYSICAL_WORK_INCOMPATIBLE","该作品类型不适用于所选商品",422);let address=data.address;if(data.addressId){const rows=await database.query("SELECT ciphertext FROM user_addresses WHERE id=$1 AND user_id=$2",[data.addressId,userId]);if(!rows[0])throw new AppError("ADDRESS_NOT_FOUND","收货地址不存在",404);address=addressSchema.parse(decryptAddress(String(rows[0].ciphertext)));}if(!address)throw new AppError("ADDRESS_REQUIRED","请填写收货地址",422);
  // 实体商品仍收现金、走普通微信支付；会员九折随会员下线取消（2026-10-08）。
  const listPrice=Number(sku.amount);
  const amount=Math.round(listPrice*100)/100;
  const ciphertext=encryptAddress(address); await database.query("INSERT INTO physical_orders (id,user_id,work_id,sku,address,address_ciphertext,amount,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'pending',$8)",[id,userId,data.workId,data.sku,JSON.stringify(address),ciphertext,amount,new Date()]); return {id,userId,sku:data.sku,amount,listPrice,status:"pending",address};
}

/** 排版并落库年度报告。付费入口见 createPaidAnnualReport；后台重试沿用原报告的解锁状态。 */
export async function createAnnualReport(userId:string,year:number,options:{unlocked?:boolean}={}) {
  const database=await getDatabase();const id=crypto.randomUUID();
  const templateRows=await database.query("SELECT code,version,config FROM annual_report_templates WHERE status='active' ORDER BY is_default DESC,created_at DESC LIMIT 1");
  const template=templateRows[0];
  if(!template)throw new AppError("ANNUAL_REPORT_TEMPLATE_UNAVAILABLE","年度报告模板暂不可用",409);
  const templateVersion=`${String(template.code)}-v${Number(template.version)}`;
  const counts=await database.query<{photos:number;works:number;shares:number;pets:number;interactions:number}>("SELECT (SELECT count(*)::int FROM photos WHERE user_id=$1 AND extract(year from created_at)=$2) photos,(SELECT count(*)::int FROM works WHERE user_id=$1 AND extract(year from created_at)=$2) works,(SELECT count(*)::int FROM events WHERE user_id=$1 AND name='shared' AND extract(year from created_at)=$2) shares,(SELECT count(*)::int FROM pets WHERE user_id=$1 AND deleted_at IS NULL) pets,(SELECT count(*)::int FROM interactive_events WHERE user_id=$1 AND extract(year from created_at)=$2) interactions",[userId,year]);
  const data=counts[0]||{photos:0,works:0,shares:0,pets:0,interactions:0};

  /*
   * 报告内容由 `annual/report.ts` 排版，数据来自 `annual/aggregate.ts` ——
   * 与叙事年度视频**共用同一份聚合**，两个产物在同一年给出的数字必须一致。
   *
   * 原实现是纯计数 SVG，一张照片都没有，主标题「这一年，我们认真生活过」
   * 把宠物名字换掉仍然成立 —— 按任务书的判定方法那是无效文案，已删掉。
   */
  const aggregate = await collectAnnualData(userId, year, REPORT_PHOTOS);
  const photos: Array<{ body: Uint8Array; contentType: string; day: number; date: string }> = [];
  for (const item of aggregate.photos.slice(0, REPORT_PHOTOS)) {
    // 越权兜底：key 必须落在这个用户的私有前缀下。
    if (!item.photo.storageKey.startsWith(`private/${userId}/`)) continue;
    const object = await objectStorage.get(item.photo.storageKey);
    if (object && object.contentType.startsWith("image/")) photos.push({ body: object.body, contentType: object.contentType, day: item.day, date: item.date });
  }

  const svg = buildReportSvg({ aggregate: { ...aggregate, counts: data }, photos });
  /*
   * 落 PNG 而不是 SVG：微信内置浏览器与部分客户端对 SVG 里的 data URI 图片
   * 渲染不一致，而年度报告的用途就是分享出去被别人打开。
   */
  const key=`private/${userId}/reports/${year}-${id}.png`;
  await objectStorage.put(key, await rasterizeReport(svg), "image/png");
  const previewKey=`private/${userId}/reports/${year}-${id}-preview.png`;
  await objectStorage.put(previewKey, await rasterizeReportPreview(svg), "image/png");

  const rows=await database.query("INSERT INTO annual_reports (id,user_id,year,status,output_key,preview_key,data,template_version,locked,created_at) VALUES ($1,$2,$3,'ready',$4,$5,$6::jsonb,$7,$9,$8) ON CONFLICT (user_id,year) DO UPDATE SET status='ready',output_key=$4,preview_key=$5,data=$6::jsonb,template_version=$7,locked=CASE WHEN $9 THEN false ELSE annual_reports.locked END RETURNING *",[id,userId,year,key,previewKey,JSON.stringify({...data,companionDays:aggregate.companionDays,petName:aggregate.petName,photoCount:photos.length,templateConfig:template.config}),templateVersion,new Date(),!options.unlocked]);const row=rows[0];return{id:String(row.id),userId:String(row.user_id),year:Number(row.year),status:String(row.status),outputKey:String(row.output_key),createdAt:new Date(String(row.created_at)).toISOString()};
}

export async function listSubscriptions(userId:string){return (await getDatabase()).query("SELECT * FROM message_subscriptions WHERE user_id=$1 ORDER BY created_at DESC",[userId]);}
export async function cancelSubscription(userId:string,id:string){const rows=await (await getDatabase()).query("UPDATE message_subscriptions SET status='unsubscribed',revoked_at=now() WHERE id=$1 AND user_id=$2 AND status NOT IN ('unsubscribed','sent') RETURNING *",[id,userId]);if(!rows[0])throw new AppError("SUBSCRIPTION_NOT_FOUND","订阅记录不存在或已结束",404);return rows[0];}
export async function listPhysicalOrders(userId:string){return (await getDatabase()).query("SELECT * FROM physical_orders WHERE user_id=$1 ORDER BY created_at DESC",[userId]);}
export async function updatePhysicalOrderAddress(userId: string, id: string, input: unknown) { const address = addressSchema.parse(input); const rows = await (await getDatabase()).query("UPDATE physical_orders SET address=$3::jsonb,address_ciphertext=$4 WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *", [id, userId, JSON.stringify(address), encryptAddress(address)]); if (!rows[0]) throw new AppError("PHYSICAL_ORDER_NOT_EDITABLE", "订单已进入履约，无法修改地址", 409); return rows[0]; }
export async function payPhysicalOrder(userId: string, id: string) {
  await confirmOrderPayment(userId, "physical", id, true);
  return preparePhysicalPrint(userId, id);
}

export async function processPaidPhysicalOrders() {
  const rows = await (await getDatabase()).query("SELECT id,user_id FROM physical_orders WHERE status='paid' AND print_pdf_key IS NULL ORDER BY paid_at LIMIT 5");
  let failed = 0;
  for (const row of rows) {
    try { await preparePhysicalPrint(String(row.user_id), String(row.id)); } catch { failed += 1; }
  }
  return { processed: rows.length - failed, failed };
}

export async function preparePhysicalPrint(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT p.*,w.output_key FROM physical_orders p JOIN works w ON w.id=p.work_id WHERE p.id=$1 AND p.user_id=$2 AND p.status IN (\'paid\',\'producing\')",[id,userId]);
  const row = rows[0];
  if (!row) throw new AppError("PHYSICAL_ORDER_UNPAID", "订单尚未到账，不能制作印刷文件", 409);
  if (row.print_pdf_key) return row;
  const object=await objectStorage.get(String(row.output_key));if(!object)throw new AppError("PRINT_SOURCE_NOT_FOUND","印刷源文件不存在",404);const png=await sharp(Buffer.from(object.body)).resize(2480,3508,{fit:"contain",background:"white"}).png().toBuffer();const metadata=await sharp(png).metadata();const pdf=await PDFDocument.create();const page=pdf.addPage([595.28,841.89]);const image=await pdf.embedPng(png);page.drawImage(image,{x:0,y:0,width:595.28,height:841.89});const pdfBody=await pdf.save();const key=`private/${userId}/physical-orders/${id}.pdf`;await objectStorage.put(key,pdfBody,"application/pdf");const qc={width:metadata.width||0,height:metadata.height||0,dpi:300,colorSpace:metadata.space||"srgb",passed:(metadata.width||0)>=2480&&(metadata.height||0)>=3508};await database.query("UPDATE physical_orders SET print_pdf_key=$2,qc_report=$3::jsonb WHERE id=$1 AND status IN (\'paid\',\'producing\')",[id,key,JSON.stringify(qc)]);return (await database.query("SELECT * FROM physical_orders WHERE id=$1",[id]))[0];}
export async function updatePhysicalOrderStatus(
  id: string,
  status: "paid" | "producing" | "shipped" | "completed" | "cancelled" | "after_sale" | "refunded",
  actorId?: string,
  note = "",
  shipping?: { carrier: string; trackingNo: string },
) {
  const database = await getDatabase();
  const currentRows = await database.query("SELECT * FROM physical_orders WHERE id=$1", [id]);
  const current = currentRows[0];
  if (!current) throw new AppError("PHYSICAL_ORDER_NOT_FOUND", "实体订单不存在", 404);
  const allowed: Record<string, string[]> = {
    pending: ["cancelled"],
    paid: ["producing", "cancelled", "after_sale", "refunded"],
    producing: ["shipped", "cancelled", "after_sale", "refunded"],
    shipped: ["completed", "after_sale"],
    after_sale: ["completed", "refunded"],
    completed: ["after_sale"],
    cancelled: [],
    refunded: [],
  };
  if (!allowed[String(current.status)]?.includes(status)) throw new AppError("PHYSICAL_ORDER_TRANSITION_INVALID", "实体订单状态不能这样流转", 409);
  if (status === "shipped" && (!shipping?.carrier || !shipping.trackingNo)) throw new AppError("SHIPPING_REQUIRED", "发货需要承运商和运单号", 422);
  const rows = await database.query(
    `UPDATE physical_orders SET status=$2,
      carrier=CASE WHEN $2='shipped' THEN $3 ELSE carrier END,
      tracking_no=CASE WHEN $2='shipped' THEN $4 ELSE tracking_no END,
      production_note=CASE WHEN $5<>'' THEN $5 ELSE production_note END,
      shipped_at=CASE WHEN $2='shipped' THEN now() ELSE shipped_at END,
      completed_at=CASE WHEN $2='completed' THEN now() ELSE completed_at END,
      refunded_at=CASE WHEN $2='refunded' THEN now() ELSE refunded_at END,
      refund_reason=CASE WHEN $2='refunded' THEN $5 ELSE refund_reason END
     WHERE id=$1 RETURNING *`,
    [id, status, shipping?.carrier || null, shipping?.trackingNo || null, note],
  );
  await database.query("INSERT INTO physical_order_events (id,order_id,actor_id,from_status,to_status,note,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), id, actorId || null, current.status, status, note, new Date()]);
  if (actorId) await recordAdminAudit({ actorId, action: "physical_order_transition", targetType: "physical_order", targetId: id, reason: note || "后台履约", before: current, after: rows[0] });
  return rows[0];
}
export async function listAnnualReports(userId:string){return (await getDatabase()).query("SELECT * FROM annual_reports WHERE user_id=$1 ORDER BY year DESC",[userId]);}
/** 冻干上线前生成的锁定报告：按现价用冻干解锁。 */
export async function unlockAnnualReport(userId:string,id:string){
  return inTransaction(async (database) => {
    const rows = await database.query("SELECT * FROM annual_reports WHERE id=$1 AND user_id=$2 FOR UPDATE", [id, userId]);
    if (!rows[0]) throw new AppError("REPORT_NOT_FOUND", "年度报告不存在", 404);
    if (!rows[0].locked) return { unlocked: true };
    await spend(userId, { units: ANNUAL_REPORT_COST, bizKey: `spend:annual_report_unlock:${id}`, title: `${String(rows[0].year)} 年度报告`, refType: "annual_report", refId: id });
    await database.query("UPDATE annual_reports SET locked=false WHERE id=$1 AND user_id=$2", [id, userId]);
    return { unlocked: true, cost: ANNUAL_REPORT_COST };
  });
}
export async function shareAnnualReport(userId:string,id:string){const current=await(await getDatabase()).query("SELECT locked FROM annual_reports WHERE id=$1 AND user_id=$2",[id,userId]);if(!current[0])throw new AppError("REPORT_NOT_FOUND","年度报告不存在",404);if(current[0].locked)throw new AppError("REPORT_LOCKED","请先解锁年度报告",409);const token=crypto.randomUUID().replaceAll("-","");await (await getDatabase()).query("UPDATE annual_reports SET share_token=$3,revoked_at=NULL WHERE id=$1 AND user_id=$2",[id,userId,token]);return{token};}
export async function revokeAnnualReport(userId:string,id:string){const rows=await (await getDatabase()).query("UPDATE annual_reports SET share_token=NULL,revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[id,userId]);if(!rows[0])throw new AppError("REPORT_NOT_FOUND","年度报告不存在",404);return rows[0];}
export async function payGrowthOrder(userId: string, id: string) {
  return confirmOrderPayment(userId, "growth", id, true);
}
export async function listGrowthOrders(userId: string) { return (await getDatabase()).query("SELECT * FROM growth_orders WHERE user_id=$1 ORDER BY created_at DESC", [userId]); }
/**
 * 年度报告（2026-10-08 起）：生成时先扣 18 颗冻干，产物直接是高清版（没有预览、没有解锁）。
 * 同一年重复生成按「扣一次生成一次」再扣一次，更新同一份报告。
 */
export async function createPaidAnnualReport(userId: string, year: number, idempotencyKey?: string) {
  return inTransaction(async (database) => {
    await database.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await assertGenerationCircuit();
    const bizKey = `spend:annual_report:${userId}:${year}:${idempotencyKey || crypto.randomUUID()}`;
    const charged = await spend(userId, { units: ANNUAL_REPORT_COST, bizKey, title: `${year} 年度报告`, refType: "annual_report", refId: String(year) });
    // 同一个幂等键重放：不重复生成，直接返回这一年的报告。
    if (charged.replayed) {
      const existing = await database.query("SELECT * FROM annual_reports WHERE user_id=$1 AND year=$2", [userId, year]);
      if (existing[0]) return { id: String(existing[0].id), userId, year, status: String(existing[0].status), outputKey: String(existing[0].output_key), createdAt: new Date(String(existing[0].created_at)).toISOString(), cost: ANNUAL_REPORT_COST };
    }
    // 排版在同一事务里完成：失败时扣费随事务一起回滚，冻干不会白扣。
    const report = await createAnnualReport(userId, year, { unlocked: true });
    return { ...report, cost: ANNUAL_REPORT_COST };
  });
}

type ExperimentFilters = { pluginId?: string; status?: string; channel?: string; from?: string; to?: string };

function experimentMetrics(row: Record<string, unknown>): Record<string, unknown> & {
  exposure: number;
  completion: number;
  paid: number;
  refunds: number;
  cost: number;
  revenue: number;
  completion_rate: number;
  paid_rate: number;
  refund_rate: number;
  cpa: number;
  completion_cost: number;
  gross_profit: number;
} {
  const exposure = Number(row.exposure || 0);
  const completion = Number(row.completion || 0);
  const paid = Number(row.paid || 0);
  const refunds = Number(row.refunds || 0);
  const cost = Number(row.cost || 0);
  const revenue = Number(row.revenue || 0);
  return {
    ...row,
    exposure,
    completion,
    paid,
    refunds,
    cost,
    revenue,
    completion_rate: exposure ? completion / exposure : 0,
    paid_rate: completion ? paid / completion : 0,
    refund_rate: paid ? refunds / paid : 0,
    cpa: paid ? cost / paid : 0,
    completion_cost: completion ? cost / completion : 0,
    gross_profit: revenue - cost,
  };
}

const experimentAggregateSql = `SELECT v.*,
  coalesce(sum(m.value) FILTER (WHERE m.metric='exposure'),0) exposure,
  coalesce(sum(m.value) FILTER (WHERE m.metric='start'),0) starts,
  coalesce(sum(m.value) FILTER (WHERE m.metric='completion'),0) completion,
  coalesce(sum(m.value) FILTER (WHERE m.metric='paid'),0) paid,
  coalesce(sum(m.value) FILTER (WHERE m.metric='refund'),0) refunds,
  coalesce(sum(m.value) FILTER (WHERE m.metric='cost'),0) cost,
  coalesce(sum(m.revenue),0) revenue
 FROM experiment_variants v
 LEFT JOIN experiment_metrics m ON m.variant_id=v.id`;

export async function listExperiments(filters: ExperimentFilters = {}) {
  const database = await getDatabase();
  const params = [
    filters.pluginId || null,
    filters.status || null,
    filters.channel || null,
    filters.from ? new Date(`${filters.from}T00:00:00Z`) : null,
    filters.to ? new Date(`${filters.to}T23:59:59.999Z`) : null,
  ];
  const filteredAggregateSql = experimentAggregateSql.replace(
    "LEFT JOIN experiment_metrics m ON m.variant_id=v.id",
    "LEFT JOIN experiment_metrics m ON m.variant_id=v.id AND ($4::timestamptz IS NULL OR m.period_start >= $4) AND ($5::timestamptz IS NULL OR m.period_end <= $5)",
  );
  const rows = await database.query(
    `${filteredAggregateSql}
     WHERE ($1::text IS NULL OR v.plugin_id=$1)
       AND ($2::text IS NULL OR v.status=$2)
       AND ($3::text IS NULL OR v.channel=$3)
     GROUP BY v.id ORDER BY v.created_at DESC`,
    params,
  );
  const liveAggregateSql = experimentAggregateSql.replace(
    "LEFT JOIN experiment_metrics m ON m.variant_id=v.id",
    "LEFT JOIN experiment_metrics m ON m.variant_id=v.id AND ($1::timestamptz IS NULL OR m.period_start >= $1) AND ($2::timestamptz IS NULL OR m.period_end <= $2)",
  );
  const liveRows = await database.query(`${liveAggregateSql} WHERE v.status='live' GROUP BY v.id`, [params[3], params[4]]);
  const liveByPlugin = new Map(liveRows.map((row) => [String(row.plugin_id), experimentMetrics(row)]));
  return rows.map((row) => {
    const item = experimentMetrics(row);
    const baseline = liveByPlugin.get(String(row.plugin_id));
    return {
      ...item,
      live_baseline_id: baseline?.id || null,
      baseline,
      delta: baseline ? {
        completion_rate: Number(item.completion_rate) - Number(baseline.completion_rate),
        paid_rate: Number(item.paid_rate) - Number(baseline.paid_rate),
        gross_profit: Number(item.gross_profit) - Number(baseline.gross_profit),
      } : null,
    };
  });
}

export async function createExperiment(input: unknown, actorId?: string) {
  const data = z.object({
    pluginId: z.string().min(1),
    variantCode: z.string().min(1).max(80).default("default"),
    status: z.enum(["idea", "testing"]).default("idea"),
    channel: z.enum(["all", "web", "miniprogram"]).default("all"),
    trafficSource: z.string().max(80).default("all"),
    config: z.record(z.string(), z.unknown()).default({}),
    reason: z.string().min(2).max(200).default("创建实验"),
  }).parse(input);
  const plugin = await getRuntimePlugin(data.pluginId);
  if (!plugin) throw new AppError("PLUGIN_NOT_FOUND", "玩法不存在", 404);
  const database = await getDatabase();
  const id = crypto.randomUUID();
  const rows = await database.query(
    "INSERT INTO experiment_variants (id,plugin_id,variant_code,status,channel,traffic_source,config,created_by,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$9) RETURNING *",
    [id, data.pluginId, data.variantCode, data.status, data.channel, data.trafficSource, JSON.stringify(data.config), actorId || null, new Date()],
  );
  await database.query("INSERT INTO experiment_operations (id,variant_id,actor_id,to_status,reason,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)", [crypto.randomUUID(), id, actorId || null, data.status, data.reason, JSON.stringify(data), new Date()]);
  if (actorId) await recordAdminAudit({ actorId, action: "experiment_create", targetType: "experiment", targetId: id, reason: data.reason, after: rows[0] });
  return rows[0];
}

export async function updateExperiment(id: string, input: unknown, actorId?: string) {
  const data = z.object({ status: z.enum(["idea", "testing", "live", "archived"]), config: z.record(z.string(), z.unknown()).default({}), reason: z.string().trim().min(2).max(200) }).parse(input);
  const database = await getDatabase();
  const currentRows = await database.query("SELECT * FROM experiment_variants WHERE id=$1", [id]);
  const current = currentRows[0];
  if (!current) throw new AppError("EXPERIMENT_NOT_FOUND", "赛马实验不存在", 404);
  const allowed: Record<string, string[]> = { idea: ["testing", "archived"], testing: ["live", "archived"], live: ["archived"], archived: ["testing"] };
  if (!allowed[String(current.status)]?.includes(data.status)) throw new AppError("EXPERIMENT_TRANSITION_INVALID", "当前实验状态不能执行该流转", 409);
  let previousLiveId: string | null = null;
  if (data.status === "live") {
    const previousLive = await database.query("SELECT id FROM experiment_variants WHERE plugin_id=$1 AND status='live' AND id<>$2 FOR UPDATE", [current.plugin_id, id]);
    previousLiveId = previousLive[0] ? String(previousLive[0].id) : null;
    await database.query("UPDATE experiment_variants SET status='archived',ended_at=now(),updated_at=now() WHERE plugin_id=$1 AND status='live' AND id<>$2", [current.plugin_id, id]);
  }
  const rows = await database.query(
    `UPDATE experiment_variants SET status=$2,config=$3::jsonb,
      superseded_live_id=CASE WHEN $2='live' THEN $4::uuid ELSE superseded_live_id END,
      started_at=CASE WHEN $2='live' THEN coalesce(started_at,now()) ELSE started_at END,
      ended_at=CASE WHEN $2='archived' THEN now() ELSE NULL END,updated_at=now()
     WHERE id=$1 RETURNING *`,
    [id, data.status, JSON.stringify(data.config), previousLiveId],
  );
  await database.query("INSERT INTO experiment_operations (id,variant_id,actor_id,from_status,to_status,reason,payload,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)", [crypto.randomUUID(), id, actorId || null, current.status, data.status, data.reason, JSON.stringify({ config: data.config, previousLiveId }), new Date()]);
  if (actorId) await recordAdminAudit({ actorId, action: "experiment_transition", targetType: "experiment", targetId: id, reason: data.reason, before: current, after: rows[0] });
  return rows[0];
}

export async function rollbackExperiment(id: string, reason: string, actorId: string) {
  z.string().trim().min(2).max(200).parse(reason);
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM experiment_variants WHERE id=$1 AND status='live'", [id]);
  const current = rows[0];
  if (!current) throw new AppError("EXPERIMENT_LIVE_REQUIRED", "只有当前 live 变体可以回滚", 409);
  if (!current.superseded_live_id) throw new AppError("EXPERIMENT_ROLLBACK_UNAVAILABLE", "没有可恢复的上一 live 变体", 409);
  const previousRows = await database.query("SELECT * FROM experiment_variants WHERE id=$1 AND plugin_id=$2", [current.superseded_live_id, current.plugin_id]);
  const previous = previousRows[0];
  if (!previous) throw new AppError("EXPERIMENT_ROLLBACK_TARGET_MISSING", "上一 live 变体不存在", 404);
  await database.query("UPDATE experiment_variants SET status='archived',ended_at=now(),updated_at=now() WHERE id=$1", [id]);
  const restored = await database.query("UPDATE experiment_variants SET status='live',ended_at=NULL,updated_at=now(),superseded_live_id=$2 WHERE id=$1 RETURNING *", [previous.id, id]);
  await database.query("INSERT INTO experiment_operations (id,variant_id,actor_id,from_status,to_status,reason,payload,created_at) VALUES ($1,$2,$3,'archived','live',$4,$5::jsonb,$6)", [crypto.randomUUID(), previous.id, actorId, reason, JSON.stringify({ rolledBackFrom: id }), new Date()]);
  await recordAdminAudit({ actorId, action: "experiment_rollback", targetType: "experiment", targetId: String(previous.id), reason, before: current, after: restored[0] });
  return restored[0];
}
export async function getExperimentDetail(id:string){const database=await getDatabase();const rows=await database.query("SELECT * FROM experiment_variants WHERE id=$1",[id]);if(!rows[0])throw new AppError("EXPERIMENT_NOT_FOUND","赛马实验不存在",404);const [metrics,operations]=await Promise.all([database.query("SELECT * FROM experiment_metrics WHERE variant_id=$1 ORDER BY period_start DESC",[id]),database.query("SELECT * FROM experiment_operations WHERE variant_id=$1 ORDER BY created_at DESC",[id])]);return{variant:rows[0],metrics,operations};}
export async function recordExperimentMetric(input: unknown) { const data=z.object({variantId:z.string().uuid(),metric:z.enum(["exposure","start","completion","paid","refund","cost"]),value:z.number().nonnegative(),sampleCount:z.number().int().nonnegative().default(1),revenue:z.number().nonnegative().default(0),source:z.enum(["manual","automatic"]).default("manual"),channel:z.enum(["all","web","miniprogram"]).default("all"),periodStart:z.string().datetime(),periodEnd:z.string().datetime()}).parse(input); const rows=await (await getDatabase()).query("INSERT INTO experiment_metrics (id,variant_id,metric,value,sample_count,revenue,source,channel,period_start,period_end,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,now()) RETURNING *",[crypto.randomUUID(),data.variantId,data.metric,data.value,data.sampleCount,data.revenue,data.source,data.channel,new Date(data.periodStart),new Date(data.periodEnd)]); return rows[0]; }
export async function listExperimentMetrics(variantId?: string) { return variantId ? (await getDatabase()).query("SELECT * FROM experiment_metrics WHERE variant_id=$1 ORDER BY period_start DESC", [variantId]) : (await getDatabase()).query("SELECT * FROM experiment_metrics ORDER BY period_start DESC"); }

export async function createAiRun(userId: string, input: unknown) {
  return inTransaction(async () => {
    const data = aiInput.parse(input);
    await lockPhotoInputs(userId, data.petId, data.photoIds);
    return createAiRunOperation(userId, input);
  });
}

export async function retryAiRun(userId: string, id: string) {
  await getAiRun(userId, id);
  return retryAiRunOperation();
}

export async function rerollAiRun(userId: string, id: string, reason: ImageTemplateRerollReason = "composition", idempotencyKey?: string) {
  return inTransaction(async () => {
    const run = await getAiRun(userId, id);
    await lockPhotoInputs(userId, run.petId, run.photoIds);
    return rerollAiRunOperation(userId, id, reason, idempotencyKey);
  });
}
