/* c8 ignore file -- adapter endpoints are covered by contract tests in deployment environments. */
import "server-only";

import { z } from "zod";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";
import type { AiRun, InteractiveSession, Membership, VideoRender } from "@/domain/models";
import { getDatabase } from "@/server/db/client";
import { jsonIdArray, jsonObject, mapAiRoleInputs, mapOrder } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { generateWithFailover, type ImageReference } from "@/server/ai/provider";
import { AI_LABEL_PLATE } from "@/domain/island-weather";
import { ISLAND_AVATAR_PLUGIN_ID } from "@/server/island/avatar";
import { cutoutSprite } from "@/server/island/cutout";
import { applyAiLabel } from "@/server/media/ai-label";
import { objectStorage } from "@/server/storage";
import { decryptAddress, encryptAddress } from "@/server/commerce/address";
import { claimEntitlement, entitlementBalance, grantPurchasedCredit, hasHealthExport, physicalDiscountRate } from "@/server/entitlements";
import { HEALTH_ARCHIVE_KIND, HEALTH_ARCHIVE_PRICE } from "@/server/health-service";
import { getRuntimePlugin } from "@/plugins/runtime";
import { collectAnnualData } from "@/server/annual/aggregate";
import { REPORT_PHOTOS, buildReportSvg, rasterizeReport, withPreviewWatermark } from "@/server/annual/report";
import { createOrder, recordEvent } from "@/server/platform-service";
import { recordAdminAudit } from "@/server/admin/audit";
import { shortestDurationFor } from "@/domain/video-duration";
import { breakEvenDeliverables, describeEntitlements, singleBuyValue, type MembershipEntitlementMap } from "@/domain/membership";
import {
  buildImageTemplatePrompt,
  getImageTemplate,
  getImageTemplateCandidateCount,
  imageTemplateSupportsReroll,
  type ImageTemplateRerollReason,
} from "@/server/image-template-registry";

/**
 * AI 肖像的风格枚举，单一事实来源。
 *
 * 这组 id 同时被三处引用：本文件的入参校验、PL-10 manifest 的 samples.styleUrls 键、
 * 小程序 ai-create.js 的 STYLES。改名或增删风格必须三处同步 ——
 * 只改一处不会报错，端上只是静默取不到对比图，退回纯文字选项。
 * registry.test.ts 里有一条断言把 manifest 的键钉在这个数组上。
 */
export const AI_STYLE_IDS = ["warm-film", "paper-cut", "studio", "fantasy"] as const;

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
  options: z.object({
    play: z.enum(["portrait", "storybook", "magazine"]).default("portrait"),
    style: z.enum(AI_STYLE_IDS).default("warm-film"),
    promptPreset: z.enum(["gentle", "heroic", "curious", "custom"]).default("gentle"),
  }).default({ play: "portrait", style: "warm-film", promptPreset: "gentle" }),
});
const interactiveSnapshotSchema = z.object({
  title: z.string().trim().min(1).max(60),
  copy: z.string().trim().min(1).max(180),
  theme: z.enum(["stardust", "meadow", "sunset"]),
  stardust: z.number().int().min(0).max(99999).default(0),
});
const interactiveInput = z.object({
  pluginId: z.string().min(1),
  petId: z.string().uuid(),
  photoIds: z.array(z.string().uuid()).min(1).max(6),
  snapshot: interactiveSnapshotSchema,
});
const addressSchema = z.object({ name: z.string().min(1), phone: z.string().min(6), province: z.string().min(1), city: z.string().min(1), detail: z.string().min(1) });

export async function createAiRun(userId: string, input: unknown): Promise<AiRun> {
  const data = aiInput.parse(input);
  const database = await getDatabase();
  const existing = await database.query("SELECT id FROM ai_runs WHERE user_id=$1 AND idempotency_key=$2", [userId, data.idempotencyKey]);
  if (existing[0]) return getAiRun(userId, String(existing[0].id));
  const plugin = await getRuntimePlugin(data.pluginId);
  if (!plugin || plugin.status !== "live" || plugin.category !== "ai-image") throw new AppError("AI_PLUGIN_UNAVAILABLE", "这个 AI 玩法暂未开放", 404);
  const template = getImageTemplate(data.templateId);
  if (!template?.masterStorageKey) throw new AppError("IMAGE_TEMPLATE_UNAVAILABLE", "这个图片模板尚未开放", 404);
  if (template.subjectMode === "owner-pet" && (!data.authorizationConfirmed || data.ownerPhotoIds.length !== 1)) {
    throw new AppError("OWNER_AUTHORIZATION_REQUIRED", "人宠模板需要 1 张已获授权的主人照片并确认授权", 422);
  }
  if (template.subjectMode !== "owner-pet" && data.ownerPhotoIds.length) {
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
  const prompt = buildImageTemplatePrompt(template);
  await database.query("INSERT INTO ai_runs (id,user_id,plugin_id,pet_id,photo_ids,role_inputs,status,prompt,prompt_version,model_version,provider,options,idempotency_key,candidates,cost,available_at,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'queued',$7,$8,$9,'pending',$10::jsonb,$11,'[]'::jsonb,0,now(),$12)", [id, userId, data.pluginId, data.petId, JSON.stringify(data.photoIds), JSON.stringify(roleInputs), prompt, `template-${template.version}`, data.modelVersion, JSON.stringify({ ...data.options, templateId: template.templateId }), data.idempotencyKey, new Date()]);
  await recordEvent(userId, "ai_created", data.pluginId, "product", { petId: data.petId, templateId: template.templateId, subjectMode: template.subjectMode });
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

export async function processNextAiRun() {
  const database = await getDatabase();
  const rows = await database.query("UPDATE ai_runs SET status='processing',attempt=attempt+1,locked_at=now() WHERE id=(SELECT id FROM ai_runs WHERE status='queued' AND available_at<=now() ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1) RETURNING *");
  const row = rows[0]; if (!row) return null;
  const runId = String(row.id); const userId = String(row.user_id); const prompt = String(row.prompt);
  try {
    /*
     * 模板任务严格按角色加载全部参考图。单宠顺序是“冻结母版 → 宠物”，双主体
     * 是“冻结母版 → 主人 → 宠物”，宠物人化是“宠物原图 → 自有效果图”。
     * 任一对象缺失都明确失败，不能回落文生图。
     * 岛立绘不是货架模板，继续只读取唯一的宠物身份图。
     */
    const isIslandAvatar = String(row.plugin_id) === ISLAND_AVATAR_PLUGIN_ID;
    const templateInput = isIslandAvatar ? undefined : await loadTemplateReferences(row);
    const [templateWidth, templateHeight] = templateInput ? templateInput.template.size.split("x").map(Number) : [0, 0];
    const references = templateInput?.references || [await loadPetReference(userId, String(row.pet_id), jsonIdArray(row.photo_ids)[0] || "")];
    const candidateCount = templateInput ? getImageTemplateCandidateCount(templateInput.template) : 4;
    const result = await generateWithFailover(
      prompt,
      candidateCount,
      providerCircuitOpen,
      recordProviderFailure,
      references,
      templateInput ? { size: templateInput.template.size, quality: "high", inputFidelity: "high" } : undefined,
    );
    await clearProviderFailures(result.provider.name);
    const generationCost = Number(process.env.AI_IMAGE_COST || 0.08) * result.images.length;
    /*
     * **岛的立绘要先抠图再打标，两步都在这里做完**（22 号文 2.6）。
     *
     * 顺序不能反，而这正是原实现的缺陷所在：原先这里对所有 `ai_runs` 无条件打标，
     * 而 `adoptAvatarCandidate` 又从 `outputKey`（已打标的字节）抠图并再打一次标。
     * 深绿黑底衬的 `min(R,B)-G` 正好落进色键的羽化带 —— 实测标识框 4000 像素里
     * 3658 个变成半透明、底衬色被去溢色改写；缩放到 1200×1600 后它落在
     * y≈1330–1377，而第二个标识画在 y≈1504–1568，**两块并不重叠**。
     * 表现是立绘右下方悬着一块半透明深色残影，下面才是真正的标识 ——
     * 立绘要实时叠在浅色草地上，脏块会直接透出来。
     *
     * 这件事不报错：`cutoutSprite` 的判据全部通过（实测 `clearedPercent` 72.6%、
     * `keyed: true`），残影落在羽化带里、不进 `residue` 计数，残留统计也是干净的。
     *
     * 抠图放在生成时而不是选定时，还顺带修好候选预览：**预览必须从已打标字节缩**
     * （既有约定，否则免费预览没标识而正式版有，正好搞反），而抠图若留到选定时，
     * 四选一页给用户看的就是一张品红底方图 —— 与入岛后的样子不是一回事。
     */
    const candidates = await Promise.all(result.images.map(async (image, index) => {
      const normalized = templateInput
        ? new Uint8Array(await sharp(Buffer.from(image.body)).resize(templateWidth, templateHeight, { fit: "cover" }).png().toBuffer())
        : image.body;
      const sprite = isIslandAvatar ? await cutoutSprite(normalized) : undefined;
      /*
       * AI 生成标识（《标识办法》第四、五条）。**必须叠在 outputKey 上，不只是预览上** ——
       * outputKey 是用户付费后拿到的字节，而法条要求「提供下载、复制、导出功能时，
       * 导出的文件也应当含有显式标识」。付费移除的只能是营销水印。
       *
       * 叠标识会把 SVG 光栅化成 PNG，所以扩展名在打标之后才能定。
       *
       * 岛用自己那组更深的底衬（`AI_LABEL_PLATE`）：岛的画面比作品图亮，
       * 取值是照「纯白像素」这个最坏画面算的。
       */
      const labeled = sprite
        ? await applyAiLabel(sprite.body, `${runId}-${index}`, AI_LABEL_PLATE)
        : await applyAiLabel(normalized, `${runId}-${index}`);
      const extension = "png";
      const outputKey = `private/${userId}/ai/${runId}-${index}.${extension}`;
      await objectStorage.put(outputKey, labeled, "image/png");
      const previewKey = `private/${userId}/ai/${runId}-${index}-preview.png`;
      /*
       * 预览从**已打标的字节**缩，而不是从原始 image.body 缩 ——
       * 否则免费预览反而没有 AI 标识，付费版有，正好搞反。
       * 原先两个分支的表达式逐字相同（sharp 自己认 SVG），已合并。
       *
       * **水印 SVG 必须按缩放后的真实尺寸生成，不能写死 640×640。**
       * `fit: "inside"` 只保证长边 640，非正方形的图短边会更小 ——
       * 立绘是 3:4（1200×1600），缩完是 480×640，往上叠一张 640×640 会被 sharp
       * 判为「composite 输入大于画布」并直接抛错，表现是整个任务 failed。
       * 既有 provider 恰好都返回正方形图，所以这个坑一直没被踩到。
       */
      const resized = await sharp(Buffer.from(labeled)).resize(640, 640, { fit: "inside" }).png().toBuffer({ resolveWithObject: true });
      const markWidth = resized.info.width;
      const markHeight = resized.info.height;
      const preview = await sharp(resized.data)
        .composite([{ input: Buffer.from(`<svg width="${markWidth}" height="${markHeight}"><text x="${Math.round(markWidth / 2)}" y="${markHeight - 40}" text-anchor="middle" font-size="28" fill="white">PETBABY · AI 预览</text></svg>`) }])
        .png()
        .toBuffer();
      await objectStorage.put(previewKey, new Uint8Array(preview), "image/png");
      return {
        id: `${runId}-${index}`,
        outputKey,
        previewKey,
        aiGenerated: true as const,
        /*
         * 抠图结果随候选存下来：`adoptAvatarCandidate` 要把 `keyed` 回给端上
         * （false 说明模型没画品红底，可提示重画但不阻断），而抠图已经在这里做完了，
         * 选定时不该为了拿这个数字再抠一遍。
         */
        ...(sprite ? { keyed: sprite.keyed, residuePercent: Number(sprite.residuePercent.toFixed(3)) } : {}),
      };
    }));
    const completed = await database.query("UPDATE ai_runs SET status='succeeded',provider=$2,model_version=$3,candidates=$4::jsonb,cost=cost+$5,locked_at=NULL WHERE id=$1 AND status='processing' RETURNING id", [runId, result.provider.name, result.provider.modelVersion, JSON.stringify(candidates), generationCost]);
    if (!completed[0]) { await Promise.all(candidates.flatMap((candidate) => [candidate.outputKey, candidate.previewKey].filter((key): key is string => Boolean(key)).map((key) => objectStorage.delete(key).catch(() => undefined)))); return { id: runId, status: "cancelled" as const }; }
    await database.query("INSERT INTO ai_cost_ledger (id,run_id,provider,model_version,units,amount,status,created_at) VALUES ($1,$2,$3,$4,$5,$6,'succeeded',now())", [crypto.randomUUID(), runId, result.provider.name, result.provider.modelVersion, candidates.length, generationCost]);
    await recordEvent(userId, "ai_succeeded", String(row.plugin_id), "worker", { provider: result.provider.name, cost: generationCost });
    return { id: runId, status: "succeeded" as const, provider: result.provider.name, candidates };
  } catch (error) {
    const message = error instanceof Error ? error.message.slice(0, 200) : "AI_PROVIDER_UNAVAILABLE";
    const failed = await database.query("UPDATE ai_runs SET status='failed',error_code=$2,locked_at=NULL WHERE id=$1 AND status='processing' RETURNING id", [runId, message]);
    if (!failed[0]) return { id: runId, status: "cancelled" as const };
    await database.query("INSERT INTO ai_cost_ledger (id,run_id,provider,model_version,units,amount,status,created_at) VALUES ($1,$2,'unknown','unknown',0,0,'failed',now())", [crypto.randomUUID(), runId]);
    return { id: runId, status: "failed" as const, errorCode: message };
  }
}

export async function getAiRun(userId: string, id: string) {
  const database = await getDatabase(); const rows = await database.query("SELECT * FROM ai_runs WHERE id=$1 AND user_id=$2", [id,userId]);
  if (!rows[0]) throw new AppError("NOT_FOUND", "AI task not found", 404);
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
    status: row.status as AiRun["status"], candidates: (row.candidates || []) as AiRun["candidates"], selectedId: row.selected_id ? String(row.selected_id) : undefined,
    selectedUnlocked: workRows[0] ? !Boolean(workRows[0].locked) : false, provider: row.provider && row.provider !== "pending" ? String(row.provider) : undefined,
    modelVersion: row.model_version ? String(row.model_version) : undefined, prompt: String(row.prompt || ""), promptVersion: String(row.prompt_version || "v1"), options: jsonObject<Record<string, unknown>>(row.options, {}),
    roleInputs,
    errorCode: row.error_code ? String(row.error_code) : undefined, cost: Number(row.cost), attempt: Number(row.attempt || 0), retryCount: Number(row.retry_count || 0),
    rerollCount: Number(row.reroll_count || 0),
    rerollRemaining: roleInputs.subjectMode === "pet-human" ? 0 : Math.max(0, 2 - Number(row.reroll_count || 0)),
    queuePosition, estimatedSeconds: queuePosition ? queuePosition * 20 : undefined,
    workId: row.work_id ? String(row.work_id) : undefined, order: orderRows[0] ? mapOrder(orderRows[0]) : undefined, createdAt: new Date(String(row.created_at)).toISOString(),
  } satisfies AiRun;
}

export async function selectAiCandidate(userId: string, id: string, candidateId: string) {
  const run = await getAiRun(userId, id);
  assertNotIslandRun(run.pluginId, "选定");
  if (run.status !== "succeeded") throw new AppError("AI_NOT_READY", "AI 任务尚未完成", 409);
  const candidate = run.candidates.find((item) => item.id === candidateId);
  if (!candidate?.outputKey || !candidate.previewKey) throw new AppError("AI_CANDIDATE_NOT_FOUND", "AI 候选结果不存在", 404);
  if (run.order && run.selectedId !== candidateId) throw new AppError("AI_SELECTION_LOCKED", "订单已创建，不能再更换候选结果", 409);
  if (run.workId) {
    await (await getDatabase()).query("UPDATE ai_runs SET selected_id=$3 WHERE id=$1 AND user_id=$2", [id, userId, candidateId]);
    return getAiRun(userId, id);
  }
  const database = await getDatabase();
  const pets = await database.query("SELECT name FROM pets WHERE id=$1 AND user_id=$2", [run.petId, userId]);
  const workId = crypto.randomUUID(); const now = new Date(); const title = `${String(pets[0]?.name || "它")}的 AI 肖像`;
  const selectionLabel = run.roleInputs.subjectMode === "pet-human" ? "二选一" : "四选一";
  const subtitle = `AI 生成内容 · 已选中的${selectionLabel}结果`;
  await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,source_id,locked,public,version,expires_at,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'PETBABY AI STUDIO',$9,$10,'image','ai',$11,true,false,1,$12,$13)", [workId, userId, run.pluginId, run.petId, run.photoIds[0], title, subtitle, `AI-${id.slice(0, 8).toUpperCase()}`, candidate.outputKey, candidate.previewKey, id, new Date(Date.now() + 90 * 86400000), now]);
  await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,1,$3,$4,$5,$6,$7)", [crypto.randomUUID(), workId, title, subtitle, candidate.outputKey, candidate.previewKey, now]);
  await database.query("UPDATE ai_runs SET selected_id=$3,work_id=$4 WHERE id=$1 AND user_id=$2", [id, userId, candidateId, workId]);
  await recordEvent(userId, "ai_candidate_selected", run.pluginId, "product", { runId: id, candidateId });
  return getAiRun(userId, id);
}

export async function unlockAiCandidate(userId: string, id: string) {
  const run = await getAiRun(userId, id);
  if (!run.selectedId || !run.workId) throw new AppError("AI_CANDIDATE_NOT_SELECTED", "请先选择一个候选结果", 409);
  const order = await createOrder(userId, run.workId, `${run.pluginId}-single`);
  await (await getDatabase()).query("UPDATE ai_runs SET order_id=$3 WHERE id=$1 AND user_id=$2", [id, userId, order.id]);
  return getAiRun(userId, id);
}

/**
 * 岛的立绘任务不能走通用 `ai-runs` 接口。
 *
 * 立绘复用 `ai_runs` 表但**不在 `registry.ts` 注册**（它不产出 `works`）。通用路由
 * 原先只按 `id + user_id` 查、不过滤 `plugin_id`，于是拿 runId 打
 * `PATCH /api/ai-runs/<id>` 带 candidateId 就会走 `selectAiCandidate`，
 * 建出一条 `plugin_id='island-avatar'` 的 `works` 行。而 `hydrateWork` 一律现查
 * manifest，查不到就抛 `WORK_INCOMPLETE` —— 那一行**打不开也删不掉**，
 * 且 `listWorks` 逐行 hydrate，**一条脏行会让整个作品列表 500**。
 * 已实证：select 静默成功、works 多出一行、`listWorks` 抛「作品关联数据不完整」。
 *
 * **拦在服务层而不是路由层**：岛自己的三条路由都带了 `AND plugin_id=$3`，
 * 而通用侧有五个入口（GET/PATCH 的三个 action、reroll），逐个路由加必漏改一处。
 */
function assertNotIslandRun(pluginId: string, action: string) {
  if (pluginId === ISLAND_AVATAR_PLUGIN_ID) {
    throw new AppError("AI_RUN_NOT_FOUND", `小岛形象任务请在小岛里${action}`, 404);
  }
}

export async function rerollAiRun(userId: string, id: string, reason: ImageTemplateRerollReason = "composition") {
  const run = await getAiRun(userId, id);
  /*
   * 岛的立绘也要拦：reroll 会清掉 `candidates` 并删除对象字节。
   * `island_pets.avatar_key` 指向 `adoptAvatarCandidate` 另存的那份键，所以立绘不会裂，
   * 但用户白掉一次立绘额度、岛内候选凭空消失，而两处都不报错。
   */
  assertNotIslandRun(run.pluginId, "重画");
  const template = run.roleInputs.templateId ? getImageTemplate(run.roleInputs.templateId) : undefined;
  if (!template) throw new AppError("IMAGE_TEMPLATE_UNAVAILABLE", "这个图片模板已下架，不能继续重抽", 409);
  if (!imageTemplateSupportsReroll(template)) throw new AppError("AI_REROLL_NOT_SUPPORTED", "宠物人化不支持重抽，请从两张候选中选择", 409);
  if (reason === "owner-not-like" && template.subjectMode !== "owner-pet") throw new AppError("REROLL_REASON_INVALID", "单宠模板不能选择主人不像", 422);
  if (reason === "too-animal" && template.subjectMode !== "pet-human") throw new AppError("REROLL_REASON_INVALID", "只有宠物人化模板可以选择太像动物", 422);
  const roleInputs = { ...run.roleInputs, rerollReason: reason };
  const rows = await (await getDatabase()).query("UPDATE ai_runs SET status='queued',candidates='[]'::jsonb,selected_id=NULL,reroll_count=reroll_count+1,error_code=NULL,available_at=now(),locked_at=NULL,role_inputs=$3::jsonb,prompt=$4 WHERE id=$1 AND user_id=$2 AND status IN ('succeeded','failed') AND reroll_count<2 AND work_id IS NULL RETURNING id", [id, userId, JSON.stringify(roleInputs), buildImageTemplatePrompt(template, reason)]);
  if (!rows[0]) throw new AppError("AI_REROLL_LIMIT", "重抽次数已用完、任务仍在处理中或候选已经归档", 409);
  await Promise.all(run.candidates.flatMap((candidate) => [candidate.outputKey, candidate.previewKey].filter((key): key is string => Boolean(key)).map((key) => objectStorage.delete(key).catch(() => undefined))));
  return getAiRun(userId, id);
}

export async function retryAiRun(userId: string, id: string) {
  // `plugin_id <> ` 写进 SQL 而不是先查后判：这两个函数原本不读 pluginId，
  // 多一次查询只为拿一个用来拒绝的值不值得，而条件写在 WHERE 里同样拦得住。
  const rows = await (await getDatabase()).query("UPDATE ai_runs SET status='queued',error_code=NULL,retry_count=retry_count+1,available_at=now(),locked_at=NULL WHERE id=$1 AND user_id=$2 AND plugin_id<>$3 AND status='failed' AND retry_count<2 RETURNING id", [id, userId, ISLAND_AVATAR_PLUGIN_ID]);
  if (!rows[0]) throw new AppError("AI_RETRY_LIMIT", "任务不可重试或重试次数已用完", 409);
  return getAiRun(userId, id);
}

export async function cancelAiRun(userId: string, id: string) {
  const rows = await (await getDatabase()).query("UPDATE ai_runs SET status='cancelled',cancelled_at=now(),locked_at=NULL WHERE id=$1 AND user_id=$2 AND plugin_id<>$3 AND status IN ('queued','processing') RETURNING id", [id, userId, ISLAND_AVATAR_PLUGIN_ID]);
  if (!rows[0]) throw new AppError("AI_NOT_CANCELLABLE", "当前任务不能取消", 409);
  return getAiRun(userId, id);
}

export async function createInteractiveSession(userId: string, input: unknown): Promise<InteractiveSession> {
  const data = interactiveInput.parse(input); const id = crypto.randomUUID(); const createdAt = new Date(); const database = await getDatabase();
  const plugin = await getRuntimePlugin(data.pluginId);
  if (!plugin || plugin.status !== "live" || plugin.category !== "interactive") throw new AppError("INTERACTIVE_PLUGIN_UNAVAILABLE", "这个互动玩法暂未开放", 404);
  const [pets, photos] = await Promise.all([
    database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [data.petId, userId]),
    database.query("SELECT id FROM photos WHERE id=ANY($1::uuid[]) AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL", [data.photoIds, data.petId, userId]),
  ]);
  if (!pets[0] || photos.length !== data.photoIds.length) throw new AppError("INTERACTIVE_ASSET_MISMATCH", "宠物或照片不存在，请重新选择", 422);
  await database.query("INSERT INTO interactive_sessions (id,user_id,plugin_id,pet_id,photo_ids,state,snapshot,created_at,updated_at) VALUES ($1,$2,$3,$4,$5::jsonb,'active',$6::jsonb,$7,$7)", [id, userId, data.pluginId, data.petId, JSON.stringify(data.photoIds), JSON.stringify(data.snapshot), createdAt]);
  await recordEvent(userId, "interactive_created", data.pluginId, "product", { petId: data.petId });
  return getInteractiveSession(userId, id);
}

function mapInteractive(row: Record<string, unknown>): InteractiveSession {
  return {
    id: String(row.id), userId: String(row.user_id), pluginId: String(row.plugin_id), petId: String(row.pet_id), photoIds: jsonIdArray(row.photo_ids),
    state: row.state as InteractiveSession["state"], snapshot: (row.snapshot || {}) as Record<string, unknown>, shareToken: row.share_token ? String(row.share_token) : undefined,
    sharePath: row.share_token ? `/interactive/share/${String(row.share_token)}` : undefined, shareExpiresAt: row.share_expires_at ? new Date(String(row.share_expires_at)).toISOString() : undefined,
    revokedAt: row.revoked_at ? new Date(String(row.revoked_at)).toISOString() : undefined, exportedKey: row.exported_key ? String(row.exported_key) : undefined,
    exportRenderId: row.export_render_id ? String(row.export_render_id) : undefined, exportStatus: row.export_status ? row.export_status as VideoRender["status"] : undefined,
    exportProgress: row.export_progress === undefined || row.export_progress === null ? undefined : Number(row.export_progress), workId: row.work_id ? String(row.work_id) : undefined,
    createdAt: new Date(String(row.created_at)).toISOString(), updatedAt: new Date(String(row.updated_at || row.created_at)).toISOString(),
  };
}

export async function updateInteractiveSession(userId: string, id: string, input: unknown) {
  const data = z.object({ snapshot: interactiveSnapshotSchema, photoIds: z.array(z.string().uuid()).min(1).max(6).optional() }).parse(input); const database = await getDatabase();
  const session = await getInteractiveSession(userId, id); const photoIds = data.photoIds || session.photoIds;
  const photos = await database.query("SELECT id FROM photos WHERE id=ANY($1::uuid[]) AND pet_id=$2 AND user_id=$3 AND deleted_at IS NULL", [photoIds, session.petId, userId]);
  if (photos.length !== photoIds.length) throw new AppError("INTERACTIVE_ASSET_MISMATCH", "互动页照片不存在，请重新选择", 422);
  const rows = await database.query("UPDATE interactive_sessions SET snapshot=$3::jsonb,photo_ids=$4::jsonb,state='active',export_render_id=NULL,exported_key=NULL,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, JSON.stringify(data.snapshot), JSON.stringify(photoIds)]);
  if (!rows[0]) throw new AppError("INTERACTIVE_NOT_FOUND", "互动会话不存在", 404);
  return getInteractiveSession(userId, id);
}

export async function getInteractiveSession(userId: string, id: string) {
  const rows = await (await getDatabase()).query("SELECT s.*,v.status export_status,v.progress export_progress FROM interactive_sessions s LEFT JOIN video_renders v ON v.id=s.export_render_id WHERE s.id=$1 AND s.user_id=$2", [id, userId]);
  if (!rows[0]) throw new AppError("INTERACTIVE_NOT_FOUND", "互动会话不存在", 404);
  return mapInteractive(rows[0]);
}

export async function appendInteractiveEvent(userId: string, sessionId: string, input: unknown) {
  const data = z.object({ name: z.string().trim().min(1).max(80), payload: z.record(z.string(), z.unknown()).default({}) }).parse(input);
  await getInteractiveSession(userId, sessionId);
  const row = (await getDatabase()).query("INSERT INTO interactive_events (id,session_id,user_id,name,payload,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *", [crypto.randomUUID(), sessionId, userId, data.name, JSON.stringify(data.payload), new Date()]);
  return (await row)[0];
}

export async function listInteractiveEvents(userId: string, sessionId: string) {
  await getInteractiveSession(userId, sessionId);
  return (await getDatabase()).query("SELECT * FROM interactive_events WHERE session_id=$1 AND user_id=$2 ORDER BY created_at", [sessionId, userId]);
}

export async function revokeInteractiveShare(userId: string, sessionId: string) {
  const rows = await (await getDatabase()).query("UPDATE interactive_sessions SET revoked_at=now(),updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING id", [sessionId, userId]);
  if (!rows[0]) throw new AppError("INTERACTIVE_NOT_FOUND", "互动会话不存在", 404);
  return getInteractiveSession(userId, sessionId);
}

export async function shareInteractiveSession(userId: string, sessionId: string, input: unknown) {
  const data = z.object({ expiresInHours: z.number().int().min(1).max(8760).default(168), resetToken: z.boolean().default(false) }).parse(input);
  const session = await getInteractiveSession(userId, sessionId);
  const token = !data.resetToken && session.shareToken && !session.revokedAt ? session.shareToken : crypto.randomUUID().replaceAll("-", "");
  const expiresAt = new Date(Date.now() + data.expiresInHours * 3600000);
  await (await getDatabase()).query("UPDATE interactive_sessions SET share_token=$3,share_expires_at=$4,revoked_at=NULL,updated_at=now() WHERE id=$1 AND user_id=$2", [sessionId, userId, token, expiresAt]);
  await recordEvent(userId, "interactive_shared", session.pluginId, "product", { sessionId });
  return getInteractiveSession(userId, sessionId);
}

export async function getPublicInteractiveSession(token: string) {
  const rows = await (await getDatabase()).query("SELECT s.*,v.status export_status,v.progress export_progress FROM interactive_sessions s LEFT JOIN video_renders v ON v.id=s.export_render_id WHERE s.share_token=$1", [token]);
  if (!rows[0]) throw new AppError("INTERACTIVE_SHARE_NOT_FOUND", "互动分享不存在", 404);
  if (rows[0].revoked_at) throw new AppError("INTERACTIVE_SHARE_REVOKED", "这份互动分享已经撤销", 410);
  if (rows[0].share_expires_at && new Date(String(rows[0].share_expires_at)).getTime() <= Date.now()) throw new AppError("INTERACTIVE_SHARE_EXPIRED", "这份互动分享已经过期", 410);
  return mapInteractive(rows[0]);
}

export async function appendPublicInteractiveEvent(token: string, input: unknown) {
  const data = z.object({ name: z.enum(["visit", "stardust_collected", "duration", "cta"]), visitorKey: z.string().min(8).max(80), source: z.string().max(80).default("share"), durationMs: z.number().int().min(0).max(86400000).optional(), payload: z.record(z.string(), z.unknown()).default({}) }).parse(input);
  const session = await getPublicInteractiveSession(token);
  const rows = await (await getDatabase()).query("INSERT INTO interactive_events (id,session_id,user_id,name,payload,visitor_key,source,duration_ms,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING id", [crypto.randomUUID(), session.id, session.userId, data.name, JSON.stringify(data.payload), data.visitorKey, data.source, data.durationMs || null, new Date()]);
  return { id: String(rows[0].id), accepted: true };
}

export async function exportInteractiveSession(userId: string, sessionId: string) {
  const session = await getInteractiveSession(userId, sessionId);
  if (session.exportRenderId && ["queued", "processing", "ready"].includes(session.exportStatus || "")) return session;
  const database = await getDatabase();
  const photos = await database.query("SELECT id,storage_key FROM photos WHERE id=ANY($1::uuid[]) AND user_id=$2 AND deleted_at IS NULL", [session.photoIds, userId]);
  if (photos.length !== session.photoIds.length) throw new AppError("INTERACTIVE_ASSET_MISSING", "互动页照片已失效，请重新编辑", 409);
  const byId = new Map(photos.map((row) => [String(row.id), String(row.storage_key)]));
  const photoKeys = session.photoIds.map((id) => byId.get(id)).filter((item): item is string => Boolean(item));
  const snapshot = interactiveSnapshotSchema.parse(session.snapshot); const renderId = crypto.randomUUID();
  /*
   * 互动页导出不给用户选时长（它不是剪片入口），但必须显式写进 config：
   * 缺这个键会走 normalizeDuration 的缺省档，时长就成了隐式约定。
   * 取能容下当前张数的最短档，成片不拖沓也不黑闪。
   */
  const config = { interactiveSessionId: session.id, petId: session.petId, photoId: session.photoIds[0], photos: photoKeys, cover: photoKeys[0], captions: [snapshot.title, snapshot.copy], bgm: snapshot.theme === "sunset" ? "calm" : "bright", durationSeconds: shortestDurationFor(photoKeys.length), snapshot };
  await database.query("INSERT INTO video_renders (id,user_id,plugin_id,status,progress,config,available_at,created_at) VALUES ($1,$2,$3,'queued',5,$4::jsonb,now(),$5)", [renderId, userId, session.pluginId, JSON.stringify(config), new Date()]);
  await database.query("UPDATE interactive_sessions SET state='exporting',export_render_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2", [sessionId, userId, renderId]);
  await recordEvent(userId, "interactive_export_queued", session.pluginId, "product", { sessionId, renderId });
  return getInteractiveSession(userId, sessionId);
}

export async function createVideoRender(userId:string,input:unknown):Promise<VideoRender> {
  const data=z.object({pluginId:z.string().min(1),workId:z.string().uuid().optional(),photos:z.array(z.string().min(1)).max(20).default([]),captions:z.array(z.string().max(120)).max(20).default([]),bgm:z.enum(["none","calm","bright"]).default("none"),cover:z.string().min(1).optional()}).parse(input); const id=crypto.randomUUID(); const createdAt=new Date(); const database=await getDatabase();
  // 同互动页导出：这条入口不让用户选时长，取能容下张数的最短档并显式写入 config。
  await database.query("INSERT INTO video_renders (id,user_id,plugin_id,status,config,created_at) VALUES ($1,$2,$3,'queued',$4::jsonb,$5)",[id,userId,data.pluginId,JSON.stringify({workId:data.workId,photos:data.photos,captions:data.captions,bgm:data.bgm,cover:data.cover,durationSeconds:shortestDurationFor(data.photos.length)}),createdAt]);
  return {id,userId,pluginId:data.pluginId,status:"queued",progress:0,createdAt:createdAt.toISOString()};
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
  const database = await getDatabase();
  const pets = await database.query("SELECT id,birthday,date_type FROM pets WHERE user_id=$1 AND deleted_at IS NULL AND birthday IS NOT NULL", [userId]);
  const scheduled: Array<{ petId: string; eventType: string; scheduledAt: string }> = [];
  for (const pet of pets) {
    const eventType = String(pet.date_type || "birthday");
    const date = String(pet.birthday);
    const target = new Date(`${date.slice(0, 4)}-${date.slice(5, 10)}T09:00:00.000Z`);
    target.setUTCFullYear(now.getUTCFullYear());
    if (target.getTime() <= now.getTime()) target.setUTCFullYear(target.getUTCFullYear() + 1);
    const scheduledAt = new Date(target.getTime() - 7 * 86400000);
    if (scheduledAt.getTime() <= now.getTime()) continue;
    const existing = await database.query("SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type=$2 AND scheduled_at=$3 AND status IN ('active','scheduled','sent')", [userId, eventType, scheduledAt]);
    if (existing[0]) continue;
    await database.query("INSERT INTO message_subscriptions (id,user_id,event_type,status,scheduled_at,consented_at,created_at) VALUES ($1,$2,$3,'scheduled',$4,$5,$6)", [crypto.randomUUID(), userId, eventType, scheduledAt, now, now]);
    scheduled.push({ petId: String(pet.id), eventType, scheduledAt: scheduledAt.toISOString() });
  }
  return scheduled;
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
  /*
   * 会员实体折扣（改造项 M6）。原实现直接 `Number(sku.amount)`，从不查会员 ——
   * 套餐里写着「实体 9 折」却一分不减，属承诺未兑付。
   *
   * 折在**下单时**算并落进 amount，不在支付时算：`payPhysicalOrder` 读的是
   * 这一列，两处各算一遍会在会员正好在这期间到期时给出不一致的金额。
   * 折后价与原价都要保留 —— 只留折后价的话，后台看到一笔 35.91 的订单
   * 对不上任何 SKU 价目，履约与对账都会卡住。
   */
  const listPrice=Number(sku.amount);
  const discount=await physicalDiscountRate(userId);
  // 分为最小单位取整：0.9 折的 39.9 是 35.91，浮点直乘会得到 35.910000000000004。
  const amount=Math.round(listPrice*discount*100)/100;
  const ciphertext=encryptAddress(address); await database.query("INSERT INTO physical_orders (id,user_id,work_id,sku,address,address_ciphertext,amount,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,'pending',$8)",[id,userId,data.workId,data.sku,JSON.stringify(address),ciphertext,amount,new Date()]); return {id,userId,sku:data.sku,amount,listPrice,memberDiscount:discount<1?discount:undefined,status:"pending",address};
}

/**
 * 在售套餐清单（改造项 M3）。**两端的套餐名、价格、权益一律从这里读。**
 *
 * 原先三处各写一份（迁移 SQL、Web 按钮文案、小程序 PLANS 数组），
 * 迁移 0020 改了价而两端没改，于是界面承诺 ¥199 实收 ¥128、
 * 并且在卖已置 inactive 的月会员（点了直接 409）。
 *
 * 只输出 `status='active'` 且**同 code 取最高 version** ——
 * 与 `createMembership` 的选版逻辑必须一致，否则会出现
 * 「列表展示 v2 的价、下单扣 v3 的钱」。
 */
export async function listMembershipPlans() {
  const database = await getDatabase();
  const rows = await database.query(
    "SELECT DISTINCT ON (code) code,label,amount,period,entitlements,version FROM membership_plan_versions WHERE status='active' ORDER BY code,version DESC",
  );
  return rows.map((row) => {
    const entitlements = (typeof row.entitlements === "object" && row.entitlements ? row.entitlements : {}) as MembershipEntitlementMap;
    const amount = Number(row.amount);
    const value = singleBuyValue(entitlements);
    return {
      plan: String(row.code),
      label: String(row.label),
      amount,
      period: String(row.period),
      version: Number(row.version),
      entitlements,
      benefits: describeEntitlements(entitlements),
      /** 单买这些权益的合计价，按「只做一件交付物」的保守口径。折扣类不计入 */
      singleBuyValue: value,
      /*
       * 比单买省多少。**只在真的为正时才有值** —— 负数说明按「只做一件」
       * 算下来定价高于权益价值，那时宣称「省 ¥N」是假的。
       * 这种情况给 breakEven（做几件回本）而不是编一个省额。
       */
      saving: value > amount ? Math.round((value - amount) * 100) / 100 : 0,
      /** 做几件分档交付物回本。用户能自己算这道题，也就能自己判断值不值 */
      breakEven: breakEvenDeliverables(entitlements, amount),
    };
  });
}

export async function createMembership(userId: string, input: unknown): Promise<Membership> {
  const data = z.object({ plan: z.enum(["monthly", "yearly"]) }).parse(input);
  const database = await getDatabase();
  const plans = await database.query("SELECT * FROM membership_plan_versions WHERE code=$1 AND status='active' ORDER BY version DESC LIMIT 1", [data.plan]);
  const plan = plans[0];
  if (!plan) throw new AppError("MEMBERSHIP_PLAN_UNAVAILABLE", "会员套餐暂不可售", 409);
  const id = crypto.randomUUID();
  const orderId = crypto.randomUUID();
  const entitlements = (plan.entitlements || {}) as Record<string, unknown>;
  const expiresAt = new Date(Date.now() + (plan.period === "year" ? 365 : 30) * 86400000);
  const resetAt = new Date(Date.now() + 30 * 86400000);
  await database.query("INSERT INTO memberships (id,user_id,plan,status,quota,expires_at,quota_reset_at,entitlements,order_id,created_at) VALUES ($1,$2,$3,'pending',0,$4,$5,$6::jsonb,$7,$8)", [id, userId, data.plan, expiresAt, resetAt, JSON.stringify(entitlements), orderId, new Date()]);
  await database.query("INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'membership',$3,$4,$5,'pending',$6::jsonb,$7,$7)", [orderId, userId, id, `membership-${data.plan}-v${plan.version}`, plan.amount, JSON.stringify({ ...entitlements, planVersion: plan.version }), new Date()]);
  return { id, userId, plan: data.plan, status: "pending", quota: 0, used: 0, expiresAt: expiresAt.toISOString(), orderId };
}

export async function createAnnualReport(userId:string,year:number) {
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
  await objectStorage.put(previewKey, await rasterizeReport(withPreviewWatermark(svg)), "image/png");

  const rows=await database.query("INSERT INTO annual_reports (id,user_id,year,status,output_key,preview_key,data,template_version,locked,created_at) VALUES ($1,$2,$3,'ready',$4,$5,$6::jsonb,$7,true,$8) ON CONFLICT (user_id,year) DO UPDATE SET status='ready',output_key=$4,preview_key=$5,data=$6::jsonb,template_version=$7 RETURNING *",[id,userId,year,key,previewKey,JSON.stringify({...data,companionDays:aggregate.companionDays,petName:aggregate.petName,photoCount:photos.length,templateConfig:template.config}),templateVersion,new Date()]);const row=rows[0];return{id:String(row.id),userId:String(row.user_id),year:Number(row.year),status:String(row.status),outputKey:String(row.output_key),createdAt:new Date(String(row.created_at)).toISOString()};
}

export async function listSubscriptions(userId:string){return (await getDatabase()).query("SELECT * FROM message_subscriptions WHERE user_id=$1 ORDER BY created_at DESC",[userId]);}
export async function cancelSubscription(userId:string,id:string){const rows=await (await getDatabase()).query("UPDATE message_subscriptions SET status='unsubscribed',revoked_at=now() WHERE id=$1 AND user_id=$2 AND status NOT IN ('unsubscribed','sent') RETURNING *",[id,userId]);if(!rows[0])throw new AppError("SUBSCRIPTION_NOT_FOUND","订阅记录不存在或已结束",404);return rows[0];}
export async function listPhysicalOrders(userId:string){return (await getDatabase()).query("SELECT * FROM physical_orders WHERE user_id=$1 ORDER BY created_at DESC",[userId]);}
export async function updatePhysicalOrderAddress(userId: string, id: string, input: unknown) { const address = addressSchema.parse(input); const rows = await (await getDatabase()).query("UPDATE physical_orders SET address=$3::jsonb,address_ciphertext=$4 WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *", [id, userId, JSON.stringify(address), encryptAddress(address)]); if (!rows[0]) throw new AppError("PHYSICAL_ORDER_NOT_EDITABLE", "订单已进入履约，无法修改地址", 409); return rows[0]; }
export async function payPhysicalOrder(userId:string,id:string){const database=await getDatabase();const rows=await database.query("SELECT p.*,w.output_key FROM physical_orders p JOIN works w ON w.id=p.work_id WHERE p.id=$1 AND p.user_id=$2 AND p.status='pending'",[id,userId]);const row=rows[0];if(!row)throw new AppError("PHYSICAL_ORDER_NOT_PAYABLE","实体订单不存在或已支付",409);if(process.env.NODE_ENV==="production"&&!process.env.PHYSICAL_PAYMENT_PROVIDER)throw new AppError("PHYSICAL_PAYMENT_PROVIDER_PENDING","实体商品支付供应商尚未配置",503);const object=await objectStorage.get(String(row.output_key));if(!object)throw new AppError("PRINT_SOURCE_NOT_FOUND","印刷源文件不存在",404);const png=await sharp(Buffer.from(object.body)).resize(2480,3508,{fit:"contain",background:"white"}).png().toBuffer();const metadata=await sharp(png).metadata();const pdf=await PDFDocument.create();const page=pdf.addPage([595.28,841.89]);const image=await pdf.embedPng(png);page.drawImage(image,{x:0,y:0,width:595.28,height:841.89});const pdfBody=await pdf.save();const key=`private/${userId}/physical-orders/${id}.pdf`;await objectStorage.put(key,pdfBody,"application/pdf");const qc={width:metadata.width||0,height:metadata.height||0,dpi:300,colorSpace:metadata.space||"srgb",passed:(metadata.width||0)>=2480&&(metadata.height||0)>=3508};const providerOrderId=`${process.env.PHYSICAL_PAYMENT_PROVIDER||"local"}-${id}`;const paid=await database.query("UPDATE physical_orders SET status='paid',paid_at=now(),provider_order_id=$3,print_pdf_key=$4,qc_report=$5::jsonb WHERE id=$1 AND user_id=$2 RETURNING *",[id,userId,providerOrderId,key,JSON.stringify(qc)]);return paid[0];}
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
/**
 * 我的会员。**权益文案与按次余量随行下发**（M3）：
 * 端上不再自己拼「本期额度 used/quota」这类话术 —— 新权益不卖次数，
 * 那个进度条在 ¥69 套餐下永远是 0/0，看起来像坏了。
 *
 * 按次余量对每条 active 记录逐条算。会员记录数量级是「每人 1–2 条」，
 * 不值得为此做批量查询。
 */
export async function listMemberships(userId:string){
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM memberships WHERE user_id=$1 ORDER BY created_at DESC",[userId]);
  /*
   * 套餐显示名也从库里取，端上不再留 `{monthly:"月会员"}` 这种翻译表 ——
   * 那张表与 membership_plan_versions.label 是两份副本，改了 label 就走散。
   * memberships 只存 code 不存 version，所以按 code 取最新一版的 label。
   */
  const labelRows = await database.query("SELECT DISTINCT ON (code) code,label FROM membership_plan_versions ORDER BY code,version DESC");
  const labelByCode = new Map(labelRows.map((row) => [String(row.code), String(row.label)]));
  return Promise.all(rows.map(async (row) => {
    const entitlements = (typeof row.entitlements === "object" && row.entitlements ? row.entitlements : {}) as MembershipEntitlementMap;
    const active = String(row.status) === "active" && new Date(String(row.expires_at)).getTime() > Date.now();
    return {
      ...row,
      planLabel: labelByCode.get(String(row.plan)) || String(row.plan),
      benefits: describeEntitlements(entitlements),
      /*
       * 年报余量只对生效中的会员算 —— 过期会员的余量是 0，
       * 但对它调 entitlementBalance 会白跑一次查询（内部按 active 过滤后必然返回 0）。
       */
      annualReportRemaining: active ? await entitlementBalance(userId, "annualReport") : 0,
    };
  }));
}
export async function resetMembershipQuotas(now = new Date()) { const rows = await (await getDatabase()).query("UPDATE memberships SET used=0,quota_reset_at=$1 + interval '30 days' WHERE status='active' AND expires_at>$1 AND (quota_reset_at IS NULL OR quota_reset_at<= $1) RETURNING id,user_id", [now]); return rows.length; }
export async function recordMembershipRenewal(userId:string,id:string,input:unknown){const data=z.object({succeeded:z.boolean()}).parse(input);const rows=await (await getDatabase()).query("UPDATE memberships SET status=$3,renewal_attempts=CASE WHEN $4 THEN 0 ELSE renewal_attempts+1 END,status_updated_at=now(),expires_at=CASE WHEN $4 THEN now()+interval '30 days' ELSE expires_at END WHERE id=$1 AND user_id=$2 AND status IN ('active','past_due') RETURNING *",[id,userId,data.succeeded?"active":"past_due",data.succeeded]);if(!rows[0])throw new AppError("MEMBERSHIP_NOT_FOUND","会员记录不存在",404);return rows[0];}
export async function expirePastDueMemberships(now=new Date()){const rows=await (await getDatabase()).query("UPDATE memberships SET status='expired',quota=0,used=0,status_updated_at=$1 WHERE status='past_due' AND status_updated_at<$1-interval '3 days' RETURNING id",[now]);return rows.length;}
export async function refundMembership(userId:string,id:string){const rows=await (await getDatabase()).query("UPDATE memberships SET status='expired',quota=0,used=0,status_updated_at=now() WHERE id=$1 AND user_id=$2 AND status IN ('active','past_due') RETURNING *",[id,userId]);if(!rows[0])throw new AppError("MEMBERSHIP_NOT_REFUNDABLE","会员记录不可退款",409);return rows[0];}
export async function listAnnualReports(userId:string){return (await getDatabase()).query("SELECT * FROM annual_reports WHERE user_id=$1 ORDER BY year DESC",[userId]);}
export async function unlockAnnualReport(userId:string,id:string){return createAnnualReportUnlockOrder(userId,id);}
export async function shareAnnualReport(userId:string,id:string){const current=await(await getDatabase()).query("SELECT locked FROM annual_reports WHERE id=$1 AND user_id=$2",[id,userId]);if(!current[0])throw new AppError("REPORT_NOT_FOUND","年度报告不存在",404);if(current[0].locked)throw new AppError("REPORT_LOCKED","请先解锁年度报告",409);const token=crypto.randomUUID().replaceAll("-","");await (await getDatabase()).query("UPDATE annual_reports SET share_token=$3,revoked_at=NULL WHERE id=$1 AND user_id=$2",[id,userId,token]);return{token};}
export async function revokeAnnualReport(userId:string,id:string){const rows=await (await getDatabase()).query("UPDATE annual_reports SET share_token=NULL,revoked_at=now() WHERE id=$1 AND user_id=$2 RETURNING *",[id,userId]);if(!rows[0])throw new AppError("REPORT_NOT_FOUND","年度报告不存在",404);return rows[0];}
export async function payGrowthOrder(userId: string, id: string) { const database = await getDatabase(); const rows = await database.query("SELECT * FROM growth_orders WHERE id=$1 AND user_id=$2", [id, userId]); const order = rows[0]; if (!order) throw new AppError("GROWTH_ORDER_NOT_FOUND", "权益订单不存在", 404); if (order.status === "paid") return order; if (order.status !== "pending") throw new AppError("GROWTH_ORDER_NOT_PAYABLE", "权益订单当前不能支付", 409); if (process.env.NODE_ENV === "production" && !process.env.PAYMENT_PROVIDER) throw new AppError("PAYMENT_ADAPTER_REQUIRED", "生产环境未配置支付供应商", 503); await database.query("UPDATE growth_orders SET status='paid',paid_at=now(),updated_at=now() WHERE id=$1", [id]); if (String(order.kind) === "membership") { /* COALESCE 不能省：会员权益在迁移 0020 重做后不再含 monthlyQuota（会员不卖次数），`->>` 返回 NULL、`::int` 得 NULL，而 memberships.quota 是 NOT NULL —— 会让付款后激活直接报错。且这条只在真实支付路径触发（payOrder 的模拟支付在生产被拒），本地不容易发现。 */ await database.query("UPDATE memberships SET status='active',quota=COALESCE((entitlements->>'monthlyQuota')::int,0),used=0,status_updated_at=now() WHERE id=$1 AND user_id=$2", [order.resource_id, userId]); await database.query("INSERT INTO entitlement_ledger (id,user_id,membership_id,order_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,$4,'membership',1,'granted','membership payment',$5)", [crypto.randomUUID(), userId, order.resource_id, id, new Date()]); } else if (String(order.kind) === "annual_report") await database.query("UPDATE annual_reports SET locked=false WHERE id=$1 AND user_id=$2", [order.resource_id, userId]);
  /*
   * 健康档案单买（L1）：付款后发一张凭据，导出时核销。
   * 不在这里直接生成文件 —— 付款与产出之间要有可追溯的凭据，
   * 否则付了款而生成失败就无处申诉。
   */
  else if (String(order.kind) === "health_archive") await grantPurchasedCredit(userId, HEALTH_ARCHIVE_KIND, id, "单次购买健康档案导出");
  return (await database.query("SELECT * FROM growth_orders WHERE id=$1", [id]))[0]; }
export async function listGrowthOrders(userId: string) { return (await getDatabase()).query("SELECT * FROM growth_orders WHERE user_id=$1 ORDER BY created_at DESC", [userId]); }
/** 年度报告高清版单买价。会员权益命中时不走这个价（见下）。 */
export const ANNUAL_REPORT_UNLOCK_PRICE = 19.9;

/**
 * 单买一次健康档案导出（改造项 L1 的非会员路径）。
 *
 * 会员的 `healthExportUnlimited` 无限导出，非会员按次买 ¥29.9。
 * 付款后发一张凭据（`entitlement_ledger` 的 granted 行），
 * 导出时核销 —— 不直接生成文件：**先付钱再拿东西**这条链路上，
 * 付款与产出之间必须有一个可追溯的凭据，否则付了款而生成失败就无处申诉。
 *
 * 已是会员时直接拒掉，不让他买一个已经拥有的东西。
 */
export async function createHealthArchiveOrder(userId: string) {
  if (await hasHealthExport(userId)) throw new AppError("HEALTH_EXPORT_ALREADY_INCLUDED", "你的会员权益已包含健康档案导出", 409);
  const database = await getDatabase();
  const existing = await database.query("SELECT * FROM growth_orders WHERE user_id=$1 AND kind='health_archive' AND status='pending' ORDER BY created_at DESC LIMIT 1", [userId]);
  if (existing[0]) return existing[0];
  const orderId = crypto.randomUUID();
  await database.query(
    "INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'health_archive',NULL,'health-archive-pdf',$3,'pending','{}',$4,$4)",
    [orderId, userId, HEALTH_ARCHIVE_PRICE, new Date()],
  );
  return { id: orderId, status: "pending", amount: HEALTH_ARCHIVE_PRICE };
}

/**
 * 年度报告解锁（改造项 M4）。
 *
 * **先查会员的 `annualReport` 权益余量**：套餐里写着「年度报告 ×1」，
 * 命中就直接解锁并记账，不建订单 —— 让已付 ¥128/¥69 的会员再付 ¥19.9
 * 是重复收费，也是这条改造存在的原因。
 *
 * 顺序上「查权益」必须在「查待付订单」之前吗？不必，但**核销必须在建单之前**：
 * 反过来会先给用户建一张订单再告诉他不用付，界面上会留一条永远 pending 的单。
 */
export async function createAnnualReportUnlockOrder(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM annual_reports WHERE id=$1 AND user_id=$2", [id, userId]);
  const report = rows[0];
  if (!report) throw new AppError("REPORT_NOT_FOUND", "年度报告不存在", 404);
  if (!report.locked) return { unlocked: true };
  const existing = await database.query("SELECT * FROM growth_orders WHERE resource_id=$1 AND kind='annual_report' AND status='pending'", [id]);
  if (existing[0]) return existing[0];
  /*
   * 会员权益兑付。核销成功才解锁 —— claimEntitlement 内部已判余量，
   * 返回 false 时一律回落到付费路径，不能「先解锁再记账」。
   */
  if (await claimEntitlement(userId, "annualReport", `年度报告 ${report.year} 高清版解锁`)) {
    await database.query("UPDATE annual_reports SET locked=false WHERE id=$1 AND user_id=$2", [id, userId]);
    return { unlocked: true, viaEntitlement: true };
  }
  const orderId = crypto.randomUUID();
  await database.query("INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'annual_report',$3,'annual-report-hd',$5,'pending','{}',$4,$4)", [orderId, userId, id, new Date(), ANNUAL_REPORT_UNLOCK_PRICE]);
  await database.query("UPDATE annual_reports SET order_id=$2 WHERE id=$1 AND user_id=$3", [id, orderId, userId]);
  return { id: orderId, status: "pending", amount: ANNUAL_REPORT_UNLOCK_PRICE };
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
