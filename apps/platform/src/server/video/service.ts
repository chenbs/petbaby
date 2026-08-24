import "server-only";

import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { jsonIdArray } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { getRuntimePlugin } from "@/plugins/runtime";
import { recordAdminAudit } from "@/server/admin/audit";
import { DEFAULT_VIDEO_DURATION, MAX_PHOTOS, maxPhotosFor, normalizeDuration } from "@/domain/video-duration";

const projectSchema = z.object({
  petId: z.string().uuid(),
  title: z.string().trim().min(1).max(80),
  photoIds: z.array(z.string().uuid()).min(1).max(MAX_PHOTOS),
  /** 成片总时长，用户三档可选。单张停留时长由它反推，见 `video/duration.ts` */
  durationSeconds: z.union([z.literal(10), z.literal(20), z.literal(30)]).default(DEFAULT_VIDEO_DURATION),
  durations: z.array(z.number().int().min(1).max(15)).max(20).default([]),
  transitions: z.array(z.enum(["cut", "fade", "slide", "zoom"])).max(20).default([]),
  captions: z.array(z.string().max(120)).max(20).default([]),
  bgm: z.enum(["none", "calm", "bright"]).default("none"),
  coverPhotoId: z.string().uuid().optional(),
  templateCode: z.string().min(1).max(80).default("memory-film-v1"),
  canvas: z.enum(["portrait", "square", "landscape"]).default("portrait"),
});

const patchSchema = projectSchema.partial().extend({ draftSnapshot: z.record(z.string(), z.unknown()).optional() });

async function assertAssets(userId: string, petId: string, photoIds: string[]) {
  const rows = await (await getDatabase()).query("SELECT id FROM photos WHERE user_id=$1 AND pet_id=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL", [userId, petId, photoIds]);
  if (rows.length !== photoIds.length) throw new AppError("VIDEO_ASSET_INVALID", "照片不存在、已删除或不属于当前宠物", 422);
}

/**
 * 张数必须与所选时长匹配，否则单张停留时长会短于两段 fade 之和，
 * 成片大半在黑场（10 秒 ÷ 20 张 = 0.5 秒 < 0.9 秒）。
 *
 * 在入口拒绝而不是渲染时静默截断：截断等于悄悄丢掉用户选好的照片，
 * 用户看到的是「我选了 20 张，成片只有 10 张」而没有任何提示。
 */
function assertDurationFits(durationSeconds: number, photoCount: number) {
  const max = maxPhotosFor(durationSeconds);
  if (photoCount > max) {
    throw new AppError("VIDEO_DURATION_MISMATCH", `${durationSeconds} 秒的片子最多放 ${max} 张照片，当前选了 ${photoCount} 张。少选几张，或把时长调长。`, 422);
  }
}

async function ensureCatalog() {
  const database = await getDatabase();
  const items = [
    ["template", "memory-film-v1", "温柔胶片", { duration: 15, canvas: "portrait" }],
    ["template", "memory-film-v2", "明亮日常", { duration: 15, canvas: "portrait" }],
    ["font", "default", "PETBABY Sans", {}],
    ["bgm", "none", "无音乐", {}],
    ["bgm", "calm", "晚风", { frequency: 261 }],
    ["bgm", "bright", "晴天", { frequency: 523 }],
    ["transition", "cut", "直接切换", {}],
    ["transition", "fade", "淡入淡出", {}],
    ["transition", "slide", "轻推镜头", {}],
    ["transition", "zoom", "慢慢靠近", {}],
  ];
  for (const [kind, code, label, config] of items) await database.query("INSERT INTO video_catalog_items (id,kind,code,label,config,version,status,is_default,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,1,'active',$6,$7) ON CONFLICT (kind,code,version) DO NOTHING", [crypto.randomUUID(), kind, code, label, JSON.stringify(config), code === "memory-film-v1" || code === "none" || code === "default" || code === "cut", new Date()]);
  return database;
}

export async function listVideoCatalog() {
  const database = await ensureCatalog();
  return database.query("SELECT * FROM video_catalog_items WHERE status='active' ORDER BY kind, code");
}

export async function listVideoProjects(userId: string) {
  const database = await getDatabase();
  return database.query("SELECT * FROM video_projects WHERE user_id=$1 ORDER BY updated_at DESC", [userId]);
}

export async function getVideoProject(userId: string, id: string) {
  const rows = await (await getDatabase()).query("SELECT * FROM video_projects WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new AppError("VIDEO_PROJECT_NOT_FOUND", "视频项目不存在", 404);
  return rows[0];
}

export async function createVideoProject(userId: string, input: unknown) {
  const data = projectSchema.parse(input);
  const plugin = await getRuntimePlugin("pl-19");
  if (!plugin || plugin.status !== "live") throw new AppError("VIDEO_PRODUCT_UNAVAILABLE", "视频产品暂未开放", 404);
  await assertAssets(userId, data.petId, data.photoIds);
  assertDurationFits(data.durationSeconds, data.photoIds.length);
  if (data.coverPhotoId && !data.photoIds.includes(data.coverPhotoId)) throw new AppError("VIDEO_COVER_INVALID", "封面必须来自已选照片", 422);
  const id = crypto.randomUUID(); const now = new Date(); const database = await getDatabase();
  const rows = await database.query("INSERT INTO video_projects (id,user_id,pet_id,title,status,photo_ids,durations,duration_seconds,transitions,captions,bgm,cover_photo_id,template_code,canvas,draft_snapshot,created_at,updated_at) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,$6::jsonb,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,'{}',$14,$14) RETURNING *", [id, userId, data.petId, data.title, JSON.stringify(data.photoIds), JSON.stringify(data.durations), data.durationSeconds, JSON.stringify(data.transitions), JSON.stringify(data.captions), data.bgm, data.coverPhotoId || data.photoIds[0], data.templateCode, data.canvas, now]);
  return rows[0];
}

export async function updateVideoProject(userId: string, id: string, input: unknown) {
  const project = await getVideoProject(userId, id); const data = patchSchema.parse(input); const database = await getDatabase();
  const petId = data.petId || String(project.pet_id); const photoIds = data.photoIds || jsonIdArray(project.photo_ids);
  await assertAssets(userId, petId, photoIds);
  // 时长和张数任一被改都要重新校验组合：只改时长（20→10）同样可能让原有张数超限。
  const durationSeconds = data.durationSeconds ?? normalizeDuration(project.duration_seconds);
  assertDurationFits(durationSeconds, photoIds.length);
  if (data.coverPhotoId && !photoIds.includes(data.coverPhotoId)) throw new AppError("VIDEO_COVER_INVALID", "封面必须来自已选照片", 422);
  const next = { ...project, ...data };
  const rows = await database.query("UPDATE video_projects SET pet_id=$3,title=$4,photo_ids=$5::jsonb,durations=$6::jsonb,duration_seconds=$7,transitions=$8::jsonb,captions=$9::jsonb,bgm=$10,cover_photo_id=$11,template_code=$12,canvas=$13,draft_snapshot=coalesce($14::jsonb,draft_snapshot),status='draft',updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, petId, next.title, JSON.stringify(photoIds), JSON.stringify(next.durations || []), durationSeconds, JSON.stringify(next.transitions || []), JSON.stringify(next.captions || []), next.bgm || "none", next.coverPhotoId || photoIds[0], next.templateCode || "memory-film-v1", next.canvas || "portrait", data.draftSnapshot ? JSON.stringify(data.draftSnapshot) : null]);
  return rows[0];
}

export async function renderVideoProject(userId: string, id: string) {
  const project = await getVideoProject(userId, id); const database = await getDatabase();
  if (["queued", "processing", "preview_ready"].includes(String(project.status)) && project.current_render_id) return getVideoRender(userId, String(project.current_render_id));
  await assertAssets(userId, String(project.pet_id), jsonIdArray(project.photo_ids));
  const photoRows = await database.query("SELECT id,storage_key FROM photos WHERE id=ANY($1::uuid[]) AND user_id=$2", [jsonIdArray(project.photo_ids), userId]); const keyMap = new Map(photoRows.map((row) => [String(row.id), String(row.storage_key)]));
  const photoKeys = jsonIdArray(project.photo_ids).map((photoId) => keyMap.get(photoId)).filter((key): key is string => Boolean(key));
  // 渲染前再校验一次：项目可能是在时长选项上线前建的，或照片被别处删到不足。
  const durationSeconds = normalizeDuration(project.duration_seconds);
  assertDurationFits(durationSeconds, photoKeys.length);
  const renderId = crypto.randomUUID(); const config = { projectId: id, photos: photoKeys, cover: keyMap.get(String(project.cover_photo_id)) || photoKeys[0], captions: project.captions, bgm: project.bgm, durationSeconds, templateCode: project.template_code, canvas: project.canvas };
  await database.query("INSERT INTO video_renders (id,user_id,plugin_id,project_id,status,progress,config,available_at,created_at) VALUES ($1,$2,'pl-19',$3,'queued',5,$4::jsonb,now(),$5)", [renderId, userId, id, JSON.stringify(config), new Date()]);
  await database.query("UPDATE video_projects SET status='queued',current_render_id=$3,updated_at=now() WHERE id=$1 AND user_id=$2", [id, userId, renderId]);
  return getVideoRender(userId, renderId);
}

export async function getVideoRender(userId: string, id: string) {
  const rows = await (await getDatabase()).query("SELECT r.*,p.title project_title,p.work_id project_work_id FROM video_renders r LEFT JOIN video_projects p ON p.id=r.project_id WHERE r.id=$1 AND r.user_id=$2", [id, userId]);
  if (!rows[0]) throw new AppError("VIDEO_RENDER_NOT_FOUND", "视频任务不存在", 404); return rows[0];
}

export async function cancelVideoRender(userId: string, id: string) {
  const rows = await (await getDatabase()).query("UPDATE video_renders SET status='cancelled',cancelled_at=now(),locked_at=NULL WHERE id=$1 AND user_id=$2 AND status IN ('queued','processing','preview_ready') RETURNING *", [id, userId]);
  if (!rows[0]) throw new AppError("VIDEO_RENDER_NOT_CANCELLABLE", "任务当前不能取消", 409);
  if (rows[0].project_id) await (await getDatabase()).query("UPDATE video_projects SET status='draft',updated_at=now() WHERE id=$1 AND user_id=$2", [rows[0].project_id, userId]);
  return rows[0];
}

export async function retryVideoRender(userId: string, id: string) {
  const current = await getVideoRender(userId, id);
  if (!["failed", "cancelled"].includes(String(current.status))) throw new AppError("VIDEO_RENDER_NOT_RETRYABLE", "任务尚未失败或取消", 409);
  if (!current.project_id) throw new AppError("VIDEO_PROJECT_REQUIRED", "任务缺少项目关联", 409);
  const database = await getDatabase();
  const existing = await database.query("SELECT id FROM video_renders WHERE retry_of=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 1", [id, userId]);
  if (existing[0]) return getVideoRender(userId, String(existing[0].id));
  const retried = await renderVideoProject(userId, String(current.project_id));
  await database.query("UPDATE video_renders SET retry_of=$2 WHERE id=$1", [retried.id, id]);
  await database.query("UPDATE video_renders SET status='retried' WHERE id=$1", [id]);
  return getVideoRender(userId, String(retried.id));
}

export async function listVideoRendersForAdmin(filters: { status?: string; page?: number; pageSize?: number } = {}) {
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 50));
  return (await getDatabase()).query(
    `SELECT r.*,p.title project_title,p.template_code,p.template_version,p.draft_snapshot,p.work_id project_work_id,
       (SELECT o.status FROM orders o WHERE o.work_id=coalesce(r.work_id,p.work_id) ORDER BY o.created_at DESC LIMIT 1) order_status,
       (SELECT o.amount FROM orders o WHERE o.work_id=coalesce(r.work_id,p.work_id) ORDER BY o.created_at DESC LIMIT 1) order_amount
     FROM video_renders r LEFT JOIN video_projects p ON p.id=r.project_id
     WHERE ($1::text IS NULL OR r.status=$1)
     ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
    [filters.status || null, pageSize, (page - 1) * pageSize],
  );
}
export async function updateVideoCatalog(actorId: string, input: unknown) {
  const data = z.object({ kind: z.enum(["template", "font", "bgm", "transition", "asset"]), code: z.string().min(1), label: z.string().min(1), config: z.record(z.string(), z.unknown()).default({}), status: z.enum(["active", "paused"]).default("active"), isDefault: z.boolean().default(false) }).parse(input);
  const database = await getDatabase();
  if (data.isDefault) await database.query("UPDATE video_catalog_items SET is_default=false WHERE kind=$1 AND is_default=true", [data.kind]);
  const rows = await database.query("SELECT coalesce(max(version),0)+1 version FROM video_catalog_items WHERE kind=$1 AND code=$2", [data.kind, data.code]);
  const version = Number(rows[0]?.version || 1);
  const created = await database.query("INSERT INTO video_catalog_items (id,kind,code,label,config,version,status,is_default,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *", [crypto.randomUUID(), data.kind, data.code, data.label, JSON.stringify(data.config), version, data.status, data.isDefault, new Date()]);
  await database.query("INSERT INTO operation_audit_logs (id,actor_id,action,resource_type,resource_id,payload,created_at) VALUES ($1,$2,'catalog_update','video_catalog',$3,$4::jsonb,$5)", [crypto.randomUUID(), actorId, String(created[0].id), JSON.stringify(data), new Date()]);
  await recordAdminAudit({ actorId, action: "video_catalog_publish", targetType: "video_catalog", targetId: String(created[0].id), reason: "发布视频目录版本", after: created[0] });
  return created[0];
}

export async function mutateVideoCatalog(actorId: string, input: unknown) {
  const data = z.discriminatedUnion("action", [
    z.object({ action: z.literal("set_status"), id: z.string().uuid(), status: z.enum(["active", "paused"]), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("set_default"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("rollback"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
  ]).parse(input);
  const database = await getDatabase();
  const current = (await database.query("SELECT * FROM video_catalog_items WHERE id=$1", [data.id]))[0];
  if (!current) throw new AppError("VIDEO_CATALOG_NOT_FOUND", "视频目录版本不存在", 404);
  let result;
  if (data.action === "set_status") {
    result = (await database.query("UPDATE video_catalog_items SET status=$2,is_default=CASE WHEN $2='paused' THEN false ELSE is_default END WHERE id=$1 RETURNING *", [data.id, data.status]))[0];
  } else if (data.action === "set_default") {
    if (current.status !== "active") throw new AppError("VIDEO_CATALOG_INACTIVE", "只有启用版本可以设为默认", 409);
    await database.query("UPDATE video_catalog_items SET is_default=false WHERE kind=$1 AND is_default=true", [current.kind]);
    result = (await database.query("UPDATE video_catalog_items SET is_default=true WHERE id=$1 RETURNING *", [data.id]))[0];
  } else {
    result = await updateVideoCatalog(actorId, { kind: current.kind, code: current.code, label: current.label, config: current.config, status: "active", isDefault: true });
  }
  await recordAdminAudit({ actorId, action: `video_catalog_${data.action}`, targetType: "video_catalog", targetId: data.id, reason: data.reason, before: current, after: result });
  return result;
}

export async function mutateVideoRenderForAdmin(actorId: string, input: unknown) {
  const data = z.object({ action: z.enum(["retry", "cancel"]), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }).parse(input);
  const database = await getDatabase();
  const current = (await database.query("SELECT * FROM video_renders WHERE id=$1", [data.id]))[0];
  if (!current) throw new AppError("VIDEO_RENDER_NOT_FOUND", "视频任务不存在", 404);
  const result = data.action === "retry" ? await retryVideoRender(String(current.user_id), data.id) : await cancelVideoRender(String(current.user_id), data.id);
  await recordAdminAudit({ actorId, action: `video_render_${data.action}`, targetType: "video_render", targetId: data.id, reason: data.reason, before: current, after: result, userId: String(current.user_id) });
  return result;
}
