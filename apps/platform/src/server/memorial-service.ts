import "server-only";
import { z } from "zod";
import { getDatabase } from "@/server/db/client";
import { jsonIdArray } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";
import { renderVideoProject, retryVideoRender } from "@/server/video/service";
import { recordAdminAudit } from "@/server/admin/audit";
import { escapeXml, renderMemorialAlbum } from "@/server/memorial/album";
import { anchorOf } from "@/domain/companion";
import { shortestDurationFor } from "@/domain/video-duration";

const createSchema = z.object({ petId: z.string().uuid(), title: z.string().trim().min(1).max(80), story: z.string().trim().max(4000).default(""), theme: z.enum(["stardust", "forest", "dawn"]).default("stardust"), photoIds: z.array(z.string().uuid()).max(20).default([]), coverPhotoId: z.string().uuid().optional() });
const editSchema = z.object({ title: z.string().trim().min(1).max(80), story: z.string().trim().max(4000), theme: z.enum(["stardust", "forest", "dawn"]), photoIds: z.array(z.string().uuid()).max(20).default([]), storySections: z.array(z.object({ title: z.string().max(80), body: z.string().max(1000) })).max(12).default([]), coverPhotoId: z.string().uuid().optional(), visibility: z.enum(["private", "shared"]).default("private") });

async function assertPhotos(userId: string, petId: string, photoIds: string[]) { if (!photoIds.length) return; const rows = await (await getDatabase()).query("SELECT id FROM photos WHERE user_id=$1 AND pet_id=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL", [userId, petId, photoIds]); if (rows.length !== photoIds.length) throw new AppError("MEMORIAL_PHOTO_INVALID", "纪念照片不存在或不属于当前宠物", 422); }
async function getOwned(userId: string, id: string) { const rows = await (await getDatabase()).query("SELECT * FROM memorial_spaces WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, userId]); if (!rows[0]) throw new AppError("MEMORIAL_NOT_FOUND", "纪念空间不存在", 404); return rows[0]; }
async function snapshot(id: string, row: Record<string, unknown>) { await (await getDatabase()).query("INSERT INTO memorial_versions (id,memorial_id,version,snapshot,created_at) VALUES ($1,$2,$3,$4::jsonb,$5) ON CONFLICT (memorial_id,version) DO NOTHING", [crypto.randomUUID(), id, Number(row.version || 1), JSON.stringify(row), new Date()]); }

export async function listMemorialSpaces(userId: string) { return (await getDatabase()).query("SELECT * FROM memorial_spaces WHERE user_id=$1 AND deleted_at IS NULL ORDER BY updated_at DESC", [userId]); }
export async function createMemorialSpace(userId: string, input: unknown) { const data = createSchema.parse(input); const database = await getDatabase(); const pets = await database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [data.petId, userId]); if (!pets[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404); await assertPhotos(userId, data.petId, data.photoIds); const id = crypto.randomUUID(); const now = new Date(); const rows = await database.query("INSERT INTO memorial_spaces (id,user_id,pet_id,status,title,story,theme,photo_ids,cover_photo_id,visibility,lifecycle,created_at,updated_at) VALUES ($1,$2,$3,'private',$4,$5,$6,$7::jsonb,$8,'private','active',$9,$9) RETURNING *", [id, userId, data.petId, data.title, data.story, data.theme, JSON.stringify(data.photoIds), data.coverPhotoId || data.photoIds[0] || null, now]); await database.query("UPDATE pets SET life_stage='memorial' WHERE id=$1", [data.petId]); await snapshot(id, rows[0]); return rows[0]; }
export async function updateMemorialSpace(userId: string, id: string, input: unknown) { const current = await getOwned(userId, id); const legacy = z.object({ title: z.string(), story: z.string(), theme: z.enum(["stardust", "forest", "dawn"]), status: z.enum(["private", "shared", "hidden"]) }).safeParse(input); if (legacy.success) { if (legacy.data.status === "hidden") return setMemorialLifecycle(userId, id, "hidden", "用户主动隐藏"); input = { ...legacy.data, photoIds: current.photo_ids || [], storySections: current.story_sections || [], visibility: legacy.data.status === "shared" ? "shared" : "private" }; } const data = editSchema.parse(input); await assertPhotos(userId, String(current.pet_id), data.photoIds); if (data.coverPhotoId && !data.photoIds.includes(data.coverPhotoId)) throw new AppError("MEMORIAL_COVER_INVALID", "封面必须来自纪念照片", 422); const token = data.visibility === "shared" ? current.share_token || crypto.randomUUID().replaceAll("-", "") : null; const expiresAt = data.visibility === "shared" ? new Date(Date.now() + 30 * 86400000) : null; const rows = await (await getDatabase()).query("UPDATE memorial_spaces SET title=$3,story=$4,theme=$5,photo_ids=$6::jsonb,story_sections=$7::jsonb,cover_photo_id=$8,visibility=$9,status=$9,share_token=$10,share_expires_at=$11,version=version+1,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, data.title, data.story, data.theme, JSON.stringify(data.photoIds), JSON.stringify(data.storySections), data.coverPhotoId || data.photoIds[0] || null, data.visibility, token, expiresAt]); await snapshot(id, rows[0]); return rows[0]; }
export async function setMemorialLifecycle(userId: string, id: string, lifecycle: "hidden" | "restored", reason: string) { z.string().trim().min(2).max(200).parse(reason); await getOwned(userId, id); const rows = await (await getDatabase()).query("UPDATE memorial_spaces SET lifecycle=$3,hidden_reason=CASE WHEN $3='hidden' THEN $4 ELSE NULL END,visibility=CASE WHEN $3='hidden' THEN 'private' ELSE visibility END,status=CASE WHEN $3='hidden' THEN 'hidden' ELSE 'private' END,share_token=CASE WHEN $3='hidden' THEN NULL ELSE share_token END,updated_at=now() WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId, lifecycle, reason]); return rows[0]; }

/**
 * 星尘页仍是单张 SVG（它本来就是一页 H5 的静态快照，不是要长期保存的文件）。
 * 纪念册走 `memorial/album.ts` 的多页 PDF。
 *
 * `escapeXml` 从 `memorial/album.ts` 导入：原先这里是
 * `replace(/[<>&'"]/g, "")`，**直接删掉**特殊字符，用户故事里的引号会被吃掉。
 */
function stardustSvg(row: Record<string, unknown>, title: string, photo?: { body: Uint8Array; contentType: string }) {
  const colors = row.theme === "forest" ? ["#173b2f", "#ecf4ed"] : row.theme === "dawn" ? ["#713f37", "#fff1dc"] : ["#101d2f", "#f7e7ad"];
  const image = photo
    ? `<defs><clipPath id="sc"><rect x="72" y="360" width="936" height="620" rx="16"/></clipPath></defs><image href="data:${photo.contentType};base64,${Buffer.from(photo.body).toString("base64")}" x="72" y="360" width="936" height="620" preserveAspectRatio="xMidYMid slice" clip-path="url(#sc)"/>`
    : "";
  const story = String(row.story || "").split(/\r?\n/).flatMap((paragraph) => {
    const chunks: string[] = [];
    for (let index = 0; index < paragraph.length; index += 30) chunks.push(paragraph.slice(index, index + 30));
    return chunks.length ? chunks : [""];
  }).slice(0, 8);
  const spans = story.map((line, index) => `<tspan x="72" dy="${index ? 52 : 0}">${escapeXml(line)}</tspan>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1440"><rect width="1080" height="1440" fill="${colors[0]}"/><text x="72" y="140" fill="${colors[1]}" font-size="30" font-family="sans-serif">PETBABY · STARDUST PAGE</text><text x="72" y="280" fill="white" font-size="72" font-family="serif">${escapeXml(title)}</text>${image}<text x="72" y="1060" fill="${colors[1]}" font-size="32" font-family="serif">${spans}</text><text x="72" y="1390" fill="${colors[1]}" font-size="26" font-family="sans-serif">安静记住，不开放留言</text></svg>`;
}
export async function exportMemorialSpace(userId: string, id: string) { return generateMemorialProduct(userId, id, "album"); }
export async function generateMemorialProduct(userId: string, id: string, product: "album" | "video" | "stardust") { const row = await getOwned(userId, id); if (String(row.lifecycle) === "hidden") throw new AppError("MEMORIAL_HIDDEN", "请先恢复纪念空间", 409); const photoIds = Array.isArray(row.photo_ids) ? row.photo_ids.map(String) : []; if (!photoIds.length) throw new AppError("MEMORIAL_PHOTOS_REQUIRED", "请先添加纪念照片", 422); const database = await getDatabase(); const workIds = (row.work_ids || {}) as Record<string, string>;
  if (product === "video") {
    const projectId = crypto.randomUUID(); const now = new Date();
    // 纪念视频不让用户选时长，取能容下张数的最短档并显式写入，别依赖列的 DEFAULT。
    const durationSeconds = shortestDurationFor(photoIds.length);
    await database.query("INSERT INTO video_projects (id,user_id,pet_id,title,status,photo_ids,durations,duration_seconds,transitions,captions,bgm,cover_photo_id,template_code,canvas,draft_snapshot,created_at,updated_at) VALUES ($1,$2,$3,$4,'draft',$5::jsonb,'[]',$6,'[]',$7::jsonb,'calm',$8,'memory-film-v1','portrait',$9::jsonb,$10,$10)", [projectId, userId, row.pet_id, `${String(row.title)} · 纪念视频`, JSON.stringify(photoIds), durationSeconds, JSON.stringify([row.title, row.story]), row.cover_photo_id || photoIds[0], JSON.stringify({ memorialId: id }), now]);
    const render = await renderVideoProject(userId, projectId); const jobs = { ...((row.product_jobs || {}) as object), video: { renderId: render.id, status: render.status, projectId } };
    await database.query("UPDATE memorial_spaces SET product_jobs=$3::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2", [id, userId, JSON.stringify(jobs)]);
    return { product, renderId: render.id, projectId, status: render.status };
  }
  /*
   * PL-20/22 已并入 PL-03/15 的 memorial 调性（改造方案 D3/D5），
   * 所以这里改指合并后的 id。**不能继续写 pl-20 / pl-22**：
   * getWork 会调 getRuntimePlugin 解析 plugin_id，指向已删除的 manifest
   * 会让新生成的纪念册直接打不开（历史作品有 plugin_snapshot 兜底，新作品没有）。
   */
  const pluginId = product === "album" ? "pet-time-album" : "pl-15";
  const title = product === "album" ? `${String(row.title)} · 纪念册` : `${String(row.title)} · 星尘页`;
  /*
   * 按 photo_ids 的顺序取出照片字节。
   *
   * `id=ANY(...)` 的返回顺序不保证与入参一致，必须自己按 photoIds 重排 ——
   * 否则纪念册的页序与用户在编辑器里排的顺序不同，而这本册子的叙事就是那个顺序。
   */
  const photoRows = await database.query("SELECT id,storage_key FROM photos WHERE id=ANY($1::uuid[]) AND user_id=$2 AND deleted_at IS NULL", [photoIds, userId]);
  const keyById = new Map(photoRows.map((photoRow) => [String(photoRow.id), String(photoRow.storage_key)]));
  const coverFirst = [String(row.cover_photo_id || ""), ...photoIds].filter((photoId) => keyById.has(photoId));
  const orderedIds = [...new Set(coverFirst)];
  const loaded: Array<{ body: Uint8Array; contentType: string }> = [];
  for (const photoId of orderedIds) {
    const object = await objectStorage.get(keyById.get(photoId) as string);
    if (object && object.contentType.startsWith("image/")) loaded.push({ body: object.body, contentType: object.contentType });
  }
  // 库里有 photo_ids 但字节全取不到（存储卷没灌 / 对象被清理）时不产出空册子。
  if (!loaded.length) throw new AppError("MEMORIAL_PHOTOS_REQUIRED", "纪念照片暂时读不出来，请稍后再试", 422);

  const sections = Array.isArray(row.story_sections)
    ? (row.story_sections as Array<{ title?: unknown; body?: unknown }>).map((section) => ({ title: String(section?.title || ""), body: String(section?.body || "") }))
    : [];
  const petRows = await database.query("SELECT name,birthday,created_at FROM pets WHERE id=$1", [row.pet_id]);
  const pet = petRows[0] || {};

  let outputKey: string;
  let assetKind: "image" | "h5" | "pdf";
  if (product === "album") {
    const body = await renderMemorialAlbum({
      petName: String(pet.name || row.title),
      title: String(row.title),
      story: String(row.story || ""),
      theme: String(row.theme || "stardust"),
      sections,
      photos: loaded,
      anchor: anchorOf({ birthday: pet.birthday ? String(pet.birthday) : undefined, createdAt: pet.created_at ? String(pet.created_at instanceof Date ? pet.created_at.toISOString() : pet.created_at) : undefined }),
      // 截止日取纪念空间创建时间：陪伴天数必须是过去式且不递增。
      memorialSince: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    });
    outputKey = `private/${userId}/memorials/${id}-album.pdf`;
    assetKind = "pdf";
    await objectStorage.put(outputKey, body, "application/pdf");
  } else {
    const svg = stardustSvg(row, String(row.title), loaded[0]);
    outputKey = `private/${userId}/memorials/${id}-${product}.svg`;
    assetKind = "h5";
    await objectStorage.put(outputKey, new TextEncoder().encode(svg), "image/svg+xml");
  }

  const workId = workIds[product] || crypto.randomUUID(); const existing = workIds[product] ? await database.query("SELECT version FROM works WHERE id=$1", [workId]) : []; const version = existing[0] ? Number(existing[0].version || 1) + 1 : 1; const now = new Date();
  if (existing[0]) await database.query("UPDATE works SET title=$2,subtitle=$3,output_key=$4,preview_key=$4,locked=false,version=$5,deleted_at=NULL WHERE id=$1", [workId, title, "来自纪念空间的克制产物", outputKey, version]);
  else await database.query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,asset_kind,source_kind,locked,public,version,created_at) VALUES ($1,$2,$3,$4,$5,$6,'来自纪念空间的克制产物',$7,'PETBABY MEMORIAL',$8,$8,$9,'memorial',false,false,1,$10)", [workId, userId, pluginId, row.pet_id, row.cover_photo_id || photoIds[0], title, `MEM-${String(workId).slice(0, 8).toUpperCase()}`, outputKey, assetKind, now]);
  await database.query("INSERT INTO work_versions (id,work_id,version,title,subtitle,output_key,preview_key,created_at) VALUES ($1,$2,$3,$4,'来自纪念空间的克制产物',$5,$5,$6)", [crypto.randomUUID(), workId, version, title, outputKey, now]);
  const nextWorkIds = { ...workIds, [product]: workId };
  await database.query("UPDATE memorial_spaces SET exported_key=$3,work_ids=$4::jsonb,updated_at=now() WHERE id=$1 AND user_id=$2", [id, userId, outputKey, JSON.stringify(nextWorkIds)]);
  return { product, workId, outputKey, status: "ready" };
}

export async function getPublicMemorial(token: string) { const rows = await (await getDatabase()).query("SELECT m.*,p.name pet_name FROM memorial_spaces m JOIN pets p ON p.id=m.pet_id WHERE m.share_token=$1 AND m.visibility='shared' AND m.lifecycle<>'hidden' AND m.deleted_at IS NULL", [token]); const row = rows[0]; if (!row) throw new AppError("MEMORIAL_SHARE_INVALID", "纪念分享已关闭或失效", 410); if (row.share_expires_at && new Date(String(row.share_expires_at)).getTime() < Date.now()) throw new AppError("MEMORIAL_SHARE_EXPIRED", "纪念分享已过期", 410); const photos = await (await getDatabase()).query("SELECT id,storage_key FROM photos WHERE id=ANY($1::uuid[]) AND deleted_at IS NULL", [jsonIdArray(row.photo_ids)]); return { ...row, photos: photos.map((photo) => ({ id: String(photo.id), url: `/api/media/${encodeURIComponent(String(photo.storage_key))}` })) }; }
export async function recordMemorialVisit(token: string, input: unknown) { const data = z.object({ visitorKey: z.string().max(80).optional(), source: z.string().max(80).default("share"), eventName: z.enum(["visit", "duration"]), durationMs: z.number().int().min(0).max(86400000).optional() }).parse(input); const memorial = await getPublicMemorial(token) as unknown as { id: string }; await (await getDatabase()).query("INSERT INTO memorial_visits (id,memorial_id,visitor_key,source,event_name,duration_ms,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [crypto.randomUUID(), memorial.id, data.visitorKey || null, data.source, data.eventName, data.durationMs || null, new Date()]); return { accepted: true }; }

export async function listMemorialAdmin(filters: { lifecycle?: string; visibility?: string; page?: number; pageSize?: number } = {}) {
  const database = await getDatabase();
  const page = Math.max(1, filters.page || 1);
  const pageSize = Math.min(100, Math.max(1, filters.pageSize || 50));
  const [spaces, catalog] = await Promise.all([
    database.query(
      `SELECT m.id,m.user_id,m.title,m.status,m.lifecycle,m.visibility,m.share_token,m.product_jobs,m.work_ids,m.updated_at,
         r.status video_status,r.progress video_progress,r.error_code video_error
       FROM memorial_spaces m
       LEFT JOIN video_renders r ON r.id=nullif(m.product_jobs->'video'->>'renderId','')::uuid
       WHERE ($1::text IS NULL OR m.lifecycle=$1) AND ($2::text IS NULL OR m.visibility=$2)
       ORDER BY m.updated_at DESC LIMIT $3 OFFSET $4`,
      [filters.lifecycle || null, filters.visibility || null, pageSize, (page - 1) * pageSize],
    ),
    listMemorialCatalog(),
  ]);
  return { spaces, catalog, page, pageSize };
}
export async function listMemorialCatalog() { const database = await getDatabase(); for (const item of [["theme", "stardust", "星尘"], ["theme", "forest", "森林"], ["theme", "dawn", "晨曦"], ["template", "album-v1", "纪念册一版"], ["template", "video-v1", "纪念视频一版"]]) await database.query("INSERT INTO memorial_catalog_items (id,kind,code,label,version,status,is_default,created_at) VALUES ($1,$2,$3,$4,1,'active',$5,$6) ON CONFLICT (kind,code,version) DO NOTHING", [crypto.randomUUID(), item[0], item[1], item[2], item[1] === "stardust" || item[1] === "album-v1", new Date()]); return database.query("SELECT * FROM memorial_catalog_items ORDER BY kind,code,version DESC"); }
export async function updateMemorialCatalog(actorId: string, input: unknown) {
  const data = z.object({ kind: z.enum(["theme", "template", "bgm", "asset"]), code: z.string().min(1), label: z.string().min(1), config: z.record(z.string(), z.unknown()).default({}), status: z.enum(["active", "paused"]).default("active"), isDefault: z.boolean().default(false) }).parse(input);
  const database = await getDatabase();
  if (data.isDefault) await database.query("UPDATE memorial_catalog_items SET is_default=false WHERE kind=$1 AND is_default=true", [data.kind]);
  const versions = await database.query("SELECT coalesce(max(version),0)+1 version FROM memorial_catalog_items WHERE kind=$1 AND code=$2", [data.kind, data.code]);
  const rows = await database.query("INSERT INTO memorial_catalog_items (id,kind,code,label,config,version,status,is_default,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *", [crypto.randomUUID(), data.kind, data.code, data.label, JSON.stringify(data.config), Number(versions[0]?.version || 1), data.status, data.isDefault, new Date()]);
  await database.query("INSERT INTO operation_audit_logs (id,actor_id,action,resource_type,resource_id,payload,created_at) VALUES ($1,$2,'catalog_update','memorial_catalog',$3,$4::jsonb,$5)", [crypto.randomUUID(), actorId, String(rows[0].id), JSON.stringify(data), new Date()]);
  await recordAdminAudit({ actorId, action: "memorial_catalog_publish", targetType: "memorial_catalog", targetId: String(rows[0].id), reason: "发布纪念目录版本", after: rows[0] });
  return rows[0];
}

export async function mutateMemorialAdmin(actorId: string, input: unknown) {
  const data = z.discriminatedUnion("action", [
    z.object({ action: z.literal("catalog_status"), id: z.string().uuid(), status: z.enum(["active", "paused"]), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("catalog_default"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("catalog_rollback"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("close_share"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
    z.object({ action: z.literal("retry_video"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
  ]).parse(input);
  const database = await getDatabase();
  if (data.action.startsWith("catalog_")) {
    const current = (await database.query("SELECT * FROM memorial_catalog_items WHERE id=$1", [data.id]))[0];
    if (!current) throw new AppError("MEMORIAL_CATALOG_NOT_FOUND", "纪念目录版本不存在", 404);
    let result;
    if (data.action === "catalog_status") result = (await database.query("UPDATE memorial_catalog_items SET status=$2,is_default=CASE WHEN $2='paused' THEN false ELSE is_default END WHERE id=$1 RETURNING *", [data.id, data.status]))[0];
    else if (data.action === "catalog_default") {
      if (current.status !== "active") throw new AppError("MEMORIAL_CATALOG_INACTIVE", "只有启用版本可以设为默认", 409);
      await database.query("UPDATE memorial_catalog_items SET is_default=false WHERE kind=$1 AND is_default=true", [current.kind]);
      result = (await database.query("UPDATE memorial_catalog_items SET is_default=true WHERE id=$1 RETURNING *", [data.id]))[0];
    } else result = await updateMemorialCatalog(actorId, { kind: current.kind, code: current.code, label: current.label, config: current.config, status: "active", isDefault: true });
    await recordAdminAudit({ actorId, action: data.action, targetType: "memorial_catalog", targetId: data.id, reason: data.reason, before: current, after: result });
    return result;
  }
  const current = (await database.query("SELECT * FROM memorial_spaces WHERE id=$1", [data.id]))[0];
  if (!current) throw new AppError("MEMORIAL_NOT_FOUND", "纪念空间不存在", 404);
  if (data.action === "close_share") {
    const result = (await database.query("UPDATE memorial_spaces SET visibility='private',share_token=NULL,updated_at=now() WHERE id=$1 RETURNING *", [data.id]))[0];
    await recordAdminAudit({ actorId, action: data.action, targetType: "memorial", targetId: data.id, reason: data.reason, before: current, after: result, userId: String(current.user_id) });
    return result;
  }
  const jobs = (current.product_jobs || {}) as Record<string, { renderId?: string }>;
  const renderId = jobs.video?.renderId;
  if (!renderId) throw new AppError("MEMORIAL_VIDEO_JOB_NOT_FOUND", "纪念视频任务不存在", 404);
  const render = await retryVideoRender(String(current.user_id), renderId);
  const nextJobs = { ...jobs, video: { ...jobs.video, renderId: String(render.id), status: String(render.status), projectId: render.projectId } };
  const updated = (await database.query("UPDATE memorial_spaces SET product_jobs=$2::jsonb,updated_at=now() WHERE id=$1 RETURNING *", [data.id, JSON.stringify(nextJobs)]))[0];
  await recordAdminAudit({ actorId, action: data.action, targetType: "memorial", targetId: data.id, reason: data.reason, before: current, after: { memorial: updated, render }, userId: String(current.user_id) });
  return render;
}
