import "server-only";

import { z } from "zod";

import { getDatabase, inTransaction } from "@/server/db/client";
import {
  CARE_KIND_TEXT,
  DAILY_LOG_KINDS,
  KIND_SPEC,
  RECORD_KINDS,
  describeRecord,
  formatGrams,
  type FieldSpec,
} from "@/server/daily-log-kinds";
import { LOOSE_STOOL, MEDICAL_CONTEXT_KINDS, addDays, asDateString, isInformative, recordLine, todayString, type LogRow } from "@/server/daily-log-context";
import { AppError } from "@/server/errors";
import { deleteCare, deleteWeight, getWeightHistory, recordCare, recordWeight } from "@/server/health-service";
import { matchEmergency } from "@/server/health/triage";
import { processObjectCleanupJob, queueObjectCleanup } from "@/server/object-cleanup";
import { objectStorage } from "@/server/storage";

/*
 * 日常记录（2026-10）。
 *
 * 把三张表合成一条「这只宠物每天发生了什么」的时间流：
 * - `pet_daily_logs`：吃喝、便便、呕吐、不舒服、用药、就医检查、洗护、小事（迁移 0041）；
 * - `pet_weight_records`：体重（0018，同日覆盖口径不变）；
 * - `pet_care_records`：疫苗驱虫（0022，到期提醒口径不变）。
 *
 * 和备忘录的区别不在「能写字」，而在三件事：每条记录挂在具体那只宠物和「陪伴第 N 天」上；
 * 结构化的维度让「上次呕吐是几天前」「这周便便偏软几次」「用药第几天」可以直接算出来；
 * 记下的事实会被健康助手读到、被整理成给兽医看的摘要。
 *
 * 红线与健康线一致：只存事实不存结论；用药名由用户填写；`memorial` 宠物不再接受新记录。
 */

const SOURCES = ["log", "weight", "care"] as const;
type Source = (typeof SOURCES)[number];

export interface RecordAttachment { id: string; url: string }

export interface PetRecord {
  id: string;
  source: Source;
  kind: string;
  occurredOn: string;
  occurredTime?: string;
  details: Record<string, unknown>;
  note?: string;
  title: string;
  summary: string;
  attachments: RecordAttachment[];
  healthSessionId?: string;
  createdAt: string;
}

function daysBetween(from: string, to: string) {
  const [a, b] = [from, to].map((text) => { const [y, m, d] = text.split("-").map(Number); return new Date(y, m - 1, d).getTime(); });
  return Math.round((b - a) / 86_400_000);
}

function fieldSchema(field: FieldSpec): z.ZodType {
  switch (field.type) {
    case "choice": {
      const values = field.options.map((option) => option.value) as [string, ...string[]];
      return field.multiple ? z.array(z.enum(values)).max(values.length) : z.enum(values);
    }
    case "count": return z.number().int().min(field.min).max(field.max);
    case "text": return z.string().trim().max(field.maxLength);
    case "toggle": return z.boolean();
    case "date": return z.string().date();
    case "number": return z.number().positive();
  }
}

/** 按清单校验 details：空值丢弃，必填项缺失返回 422，未登记的键直接剥掉。 */
function parseDetails(kind: string, input: unknown) {
  const spec = KIND_SPEC[kind];
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const result: Record<string, unknown> = {};
  for (const field of spec.fields) {
    const raw = source[field.key];
    const empty = raw === undefined || raw === null || raw === "" || raw === false || (Array.isArray(raw) && raw.length === 0);
    if (empty) {
      if ("required" in field && field.required) throw new AppError("RECORD_FIELD_REQUIRED", `请填写「${field.label}」`, 422);
      continue;
    }
    const parsed = fieldSchema(field).safeParse(raw);
    if (!parsed.success) throw new AppError("RECORD_FIELD_INVALID", `「${field.label}」填写有误`, 422);
    result[field.key] = parsed.data;
  }
  return result;
}

const createSchema = z.object({
  kind: z.enum(RECORD_KINDS.map((spec) => spec.kind) as [string, ...string[]]),
  occurredOn: z.string().date(),
  occurredTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/).optional().or(z.literal("")),
  details: z.record(z.string(), z.unknown()).optional().default({}),
  note: z.string().trim().max(300).optional().default(""),
  attachmentIds: z.array(z.string().uuid()).max(3).optional().default([]),
  healthSessionId: z.string().uuid().optional(),
});

async function getWritablePet(userId: string, petId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id,name,species,birthday,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [petId, userId],
  );
  const pet = rows[0];
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  /*
   * 已离开的宠物不再接受新记录（与健康线红线 10 同口径）。
   * 日常记录里有体重、用药、症状这些照顾类内容，对这些用户再出现「记一笔」是冒犯。
   */
  if (String(pet.life_stage) === "memorial") throw new AppError("RECORDS_SEALED_MEMORIAL", "这只宠物的日常记录已经封存", 409);
  return pet;
}

async function getReadablePet(userId: string, petId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id,name,species,birthday,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [petId, userId],
  );
  if (!rows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  return rows[0];
}

export function listRecordKinds() {
  return RECORD_KINDS;
}

/**
 * 记一笔。体重与疫苗驱虫转交各自的老服务，其余写 `pet_daily_logs`。
 *
 * 返回值带 `urgentAreas`：备注里出现「呼吸困难」「尿不出来」这类紧急表现时，
 * 用健康分诊同一份紧急关键词（`matchEmergency`）提示立即就医 ——
 * 用户记下这类事的那一刻，比等他想起来去问健康助手更早。
 */
export async function createRecord(userId: string, petId: string, input: unknown) {
  const data = createSchema.parse(input);
  await getWritablePet(userId, petId);
  const today = todayString();
  // 允许跨时区留一天余量；更晚的日期多半是选错了
  if (data.occurredOn > addDays(today, 1)) throw new AppError("RECORD_DATE_IN_FUTURE", "记录日期不能晚于今天", 422);

  if (data.kind === "weight") {
    const kilograms = Number(data.details.weightKg);
    if (!Number.isFinite(kilograms) || kilograms <= 0) throw new AppError("RECORD_FIELD_REQUIRED", "请填写体重，单位公斤", 422);
    const weight = await recordWeight(userId, petId, { weightGrams: Math.round(kilograms * 1000), measuredOn: data.occurredOn, note: data.note || undefined });
    return { record: { source: "weight" as const, id: weight.id }, urgentAreas: [] as string[] };
  }
  if (data.kind === "care") {
    const careKind = String(data.details.careKind || "");
    if (!CARE_KIND_TEXT[careKind]) throw new AppError("RECORD_FIELD_REQUIRED", "请选择疫苗驱虫的类型", 422);
    const care = await recordCare(userId, petId, {
      kind: careKind,
      label: String(data.details.label || "").trim() || CARE_KIND_TEXT[careKind],
      performedOn: data.occurredOn,
      dueOn: data.details.dueOn ? String(data.details.dueOn) : undefined,
      note: data.note || undefined,
    });
    return { record: { source: "care" as const, id: care.id }, urgentAreas: [] as string[] };
  }

  const details = parseDetails(data.kind, data.details);
  if (!Object.keys(details).length && !data.note && !data.attachmentIds.length) {
    throw new AppError("RECORD_EMPTY", "写点什么再保存吧", 422);
  }
  if (data.kind === "visit" && details.followUpOn && String(details.followUpOn) < data.occurredOn) {
    throw new AppError("RECORD_FIELD_INVALID", "复诊日期不能早于这次看诊", 422);
  }
  if (data.healthSessionId) {
    const owned = await (await getDatabase()).query("SELECT id FROM health_sessions WHERE id=$1 AND user_id=$2 AND pet_id=$3", [data.healthSessionId, userId, petId]);
    if (!owned[0]) throw new AppError("HEALTH_SESSION_NOT_FOUND", "健康记录不存在", 404);
  }

  const id = crypto.randomUUID();
  const now = new Date();
  await inTransaction(async (db) => {
    await db.query(
      "INSERT INTO pet_daily_logs (id,user_id,pet_id,kind,occurred_on,occurred_time,details,note,health_session_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$10)",
      [id, userId, petId, data.kind, data.occurredOn, data.occurredTime || null, JSON.stringify(details), data.note || null, data.healthSessionId || null, now],
    );
    if (data.attachmentIds.length) {
      const linked = await db.query(
        "UPDATE pet_record_attachments SET log_id=$1 WHERE id=ANY($2::uuid[]) AND user_id=$3 AND pet_id=$4 AND log_id IS NULL RETURNING id",
        [id, data.attachmentIds, userId, petId],
      );
      if (linked.length !== data.attachmentIds.length) throw new AppError("RECORD_ATTACHMENT_INVALID", "附图已失效，请重新添加", 422);
    }
  });
  const urgentAreas = data.note ? matchEmergency(data.note) || [] : [];
  return { record: { source: "log" as const, id }, urgentAreas };
}

const listSchema = z.object({
  group: z.enum(["body", "food", "medical", "care", "weight", "life"]).optional(),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(40),
  cursor: z.coerce.number().int().min(0).max(100_000).optional().default(0),
});

/**
 * 时间流。三张表 UNION ALL 后按「哪天 → 几点 → 录入时刻」倒序。
 *
 * 游标是偏移量：单只宠物的记录量级在千条以内，偏移分页足够，
 * 且合并三表后没有一个天然唯一、可比较的复合键。
 */
export async function listRecords(userId: string, petId: string, input: unknown = {}) {
  const options = listSchema.parse(input);
  await getReadablePet(userId, petId);
  const database = await getDatabase();
  const logKinds = options.group ? RECORD_KINDS.filter((spec) => spec.group === options.group && spec.kind !== "weight" && spec.kind !== "care").map((spec) => spec.kind) : DAILY_LOG_KINDS;
  const includeWeight = !options.group || options.group === "weight";
  const includeCare = !options.group || options.group === "care";
  const parts: string[] = [];
  if (logKinds.length) parts.push("SELECT 'log' source,id,kind,occurred_on,occurred_time,details,note,health_session_id,created_at FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 AND kind=ANY($3::text[])");
  if (includeWeight) parts.push("SELECT 'weight',id,'weight',measured_on,NULL,jsonb_build_object('weightGrams',weight_grams),note,NULL,created_at FROM pet_weight_records WHERE pet_id=$1 AND user_id=$2");
  if (includeCare) parts.push("SELECT 'care',id,kind,performed_on,NULL,jsonb_build_object('label',label,'dueOn',due_on),note,NULL,created_at FROM pet_care_records WHERE pet_id=$1 AND user_id=$2");
  const rows = await database.query(
    `SELECT * FROM (${parts.join(" UNION ALL ")}) merged ORDER BY occurred_on DESC, coalesce(occurred_time,'') DESC, created_at DESC LIMIT $4 OFFSET $5`,
    [petId, userId, logKinds, options.pageSize + 1, options.cursor],
  );
  const page = rows.slice(0, options.pageSize);
  const logIds = page.filter((row) => row.source === "log").map((row) => String(row.id));
  const attachments = logIds.length
    ? await database.query("SELECT id,log_id FROM pet_record_attachments WHERE log_id=ANY($1::uuid[]) ORDER BY created_at", [logIds])
    : [];
  const byLog = new Map<string, RecordAttachment[]>();
  for (const row of attachments) {
    const list = byLog.get(String(row.log_id)) || [];
    list.push({ id: String(row.id), url: `/api/record-attachments/${row.id}/media` });
    byLog.set(String(row.log_id), list);
  }
  const items: PetRecord[] = page.map((row) => {
    const details = (row.details || {}) as Record<string, unknown>;
    if (details.dueOn) details.dueOn = asDateString(details.dueOn);
    const kind = String(row.kind);
    const described = describeRecord(kind, details);
    return {
      id: String(row.id),
      source: String(row.source) as Source,
      kind,
      occurredOn: asDateString(row.occurred_on),
      occurredTime: row.occurred_time ? String(row.occurred_time) : undefined,
      details,
      note: row.note ? String(row.note) : undefined,
      title: described.title,
      summary: described.summary,
      attachments: byLog.get(String(row.id)) || [],
      healthSessionId: row.health_session_id ? String(row.health_session_id) : undefined,
      createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
    };
  });
  return { items, nextCursor: rows.length > options.pageSize ? String(options.cursor + options.pageSize) : null };
}

/** 删一条。附图同事务解除登记并进入持久清理，避免对象残留。 */
export async function deleteRecord(userId: string, petId: string, recordId: string, source: unknown) {
  const parsedSource = z.enum(SOURCES).parse(source || "log");
  if (parsedSource === "weight") return deleteWeight(userId, petId, recordId);
  if (parsedSource === "care") return deleteCare(userId, petId, recordId);
  const jobs = await inTransaction(async (db) => {
    const owned = await db.query("SELECT id FROM pet_daily_logs WHERE id=$1 AND pet_id=$2 AND user_id=$3 FOR UPDATE", [recordId, petId, userId]);
    if (!owned[0]) throw new AppError("RECORD_NOT_FOUND", "记录不存在", 404);
    // 先删附图登记：外键是 ON DELETE SET NULL，先删记录会把 log_id 置空，附图就成了找不回来的孤儿
    const keys = await db.query("DELETE FROM pet_record_attachments WHERE log_id=$1 AND user_id=$2 RETURNING storage_key", [recordId, userId]);
    await db.query("DELETE FROM pet_daily_logs WHERE id=$1", [recordId]);
    const ids: string[] = [];
    for (const row of keys) ids.push(await queueObjectCleanup(String(row.storage_key), "record_deleted"));
    return ids;
  });
  for (const job of jobs) await processObjectCleanupJob(job);
  return { deleted: true };
}

/* ---------- 附图 ---------- */

export async function saveRecordAttachment(userId: string, petId: string, input: { storageKey: string; mimeType: string }) {
  await getWritablePet(userId, petId);
  const id = crypto.randomUUID();
  await (await getDatabase()).query(
    "INSERT INTO pet_record_attachments (id,user_id,pet_id,storage_key,mime_type,created_at) VALUES ($1,$2,$3,$4,$5,$6)",
    [id, userId, petId, input.storageKey, input.mimeType, new Date()],
  );
  return { id, url: `/api/record-attachments/${id}/media` };
}

/** 附图只有本人可读。key 前缀再校验一次，防止登记表被篡改后越权读到别人的对象。 */
export async function getRecordAttachmentObject(userId: string, id: string) {
  const rows = await (await getDatabase()).query("SELECT storage_key FROM pet_record_attachments WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new AppError("RECORD_ATTACHMENT_NOT_FOUND", "附图不存在", 404);
  const key = String(rows[0].storage_key);
  if (!key.startsWith(`private/${userId}/records/`)) throw new AppError("RECORD_ATTACHMENT_NOT_FOUND", "附图不存在", 404);
  const object = await objectStorage.get(key);
  if (!object) throw new AppError("RECORD_ATTACHMENT_FILE_MISSING", "附图文件不存在", 404);
  return object;
}

/** 上传后超过一天仍未挂到任何记录上的附图（用户中途放弃），由维护任务登记清理。 */
export async function cleanupOrphanAttachments() {
  const jobs = await inTransaction(async (db) => {
    const rows = await db.query("DELETE FROM pet_record_attachments WHERE log_id IS NULL AND created_at < now()-interval '1 day' RETURNING storage_key");
    const ids: string[] = [];
    for (const row of rows) ids.push(await queueObjectCleanup(String(row.storage_key), "record_attachment_orphan"));
    return ids;
  });
  for (const job of jobs) await processObjectCleanupJob(job);
  return jobs.length;
}

/* ---------- 概览：让记录「被用上」 ---------- */


/**
 * 记录页顶部的概览。全部是**可核对的事实**（日期相减、次数相加），不给评价：
 * 「上次呕吐是 12 天前」「近 7 天记了 3 次呕吐」可以说，「呕吐频繁」不能说。
 */
export async function getRecordOverview(userId: string, petId: string, now = new Date()) {
  const pet = await getReadablePet(userId, petId);
  const database = await getDatabase();
  const today = todayString(now);
  const [days, logs, care, weight] = await Promise.all([
    database.query<{ record_day: unknown }>(
      `SELECT DISTINCT record_day FROM (
         SELECT occurred_on record_day FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2
         UNION ALL SELECT measured_on FROM pet_weight_records WHERE pet_id=$1 AND user_id=$2
         UNION ALL SELECT performed_on FROM pet_care_records WHERE pet_id=$1 AND user_id=$2) d ORDER BY record_day DESC`,
      [petId, userId],
    ),
    database.query<LogRow>(
      "SELECT id,kind,occurred_on,occurred_time,details,note FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 ORDER BY occurred_on DESC, coalesce(occurred_time,'') DESC, created_at DESC LIMIT 400",
      [petId, userId],
    ),
    database.query("SELECT id,kind,label,performed_on,due_on FROM pet_care_records WHERE pet_id=$1 AND user_id=$2 ORDER BY performed_on DESC, created_at DESC LIMIT 200", [petId, userId]),
    getWeightHistory(userId, petId),
  ]);

  const dayList = days.map((row) => asDateString(row.record_day));
  let streak = 0;
  // 今天还没记时从昨天起算：早上打开不该看到连续天数清零
  let cursor = dayList[0] === today ? today : addDays(today, -1);
  const daySet = new Set(dayList);
  while (daySet.has(cursor)) { streak += 1; cursor = addDays(cursor, -1); }

  const logRows = logs.map((row) => ({ ...row, day: asDateString(row.occurred_on), details: (row.details || {}) as Record<string, unknown> }));
  const todayCount = logRows.filter((row) => row.day === today).length
    + (weight.records[0]?.measuredOn === today ? 1 : 0)
    + care.filter((row) => asDateString(row.performed_on) === today).length;

  const lastOf = (match: (row: (typeof logRows)[number]) => boolean) => logRows.find(match)?.day;
  const lastCare = (kind: string) => { const row = care.find((item) => String(item.kind) === kind); return row ? asDateString(row.performed_on) : undefined; };
  const groomed = (item: string) => (row: (typeof logRows)[number]) => row.kind === "grooming" && Array.isArray(row.details.items) && row.details.items.includes(item);
  const intervals = [
    { key: "vomit", label: "上次呕吐", date: lastOf((row) => row.kind === "vomit") },
    { key: "symptom", label: "上次不舒服", date: lastOf((row) => row.kind === "symptom") },
    { key: "visit", label: "上次看诊", date: lastOf((row) => row.kind === "visit") },
    { key: "deworm_internal", label: "上次体内驱虫", date: lastCare("deworm_internal") },
    { key: "deworm_external", label: "上次体外驱虫", date: lastCare("deworm_external") },
    { key: "bath", label: "上次洗澡", date: lastOf(groomed("bath")) },
    { key: "nail", label: "上次剪指甲", date: lastOf(groomed("nail")) },
  ].filter((item) => item.date).map((item) => {
    const ago = daysBetween(item.date as string, today);
    return { ...item, daysAgo: ago, text: ago <= 0 ? `${item.label}：今天` : `${item.label}：${ago} 天前` };
  });

  const weekStart = addDays(today, -6);
  const week = logRows.filter((row) => row.day >= weekStart && row.day <= today);
  const vomitTimes = week.filter((row) => row.kind === "vomit").reduce((sum, row) => sum + (Number(row.details.count) || 1), 0);
  const looseTimes = week.filter((row) => row.kind === "stool" && LOOSE_STOOL.has(String(row.details.form))).reduce((sum, row) => sum + (Number(row.details.count) || 1), 0);
  const symptomDays = new Set(week.filter((row) => row.kind === "symptom").map((row) => row.day)).size;
  const recentFacts = [
    vomitTimes ? `近 7 天记了 ${vomitTimes} 次呕吐` : "",
    looseTimes ? `近 7 天便便偏软或更稀 ${looseTimes} 次` : "",
    symptomDays ? `近 7 天有 ${symptomDays} 天记了不舒服` : "",
  ].filter(Boolean);

  /*
   * 到期与复诊。同一项目（类型 + 项目名）只看最近一次：续打之后旧记录的到期日不该再出现。
   * 只列 30 天内到期和已过期的，其余太远的不占位置。
   */
  const seen = new Set<string>();
  const upcoming: Array<{ key: string; title: string; date: string; daysLeft: number; overdue: boolean }> = [];
  for (const row of care) {
    const key = `${row.kind}:${row.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (!row.due_on) continue;
    const date = asDateString(row.due_on);
    const left = daysBetween(today, date);
    if (left <= 30) upcoming.push({ key: `care:${row.id}`, title: `${CARE_KIND_TEXT[String(row.kind)] || "记录"} · ${row.label}`, date, daysLeft: left, overdue: left < 0 });
  }
  const latestVisit = logRows.find((row) => row.kind === "visit" && row.details.followUpOn);
  if (latestVisit) {
    const date = String(latestVisit.details.followUpOn);
    const left = daysBetween(today, date);
    if (left >= -7 && left <= 30) upcoming.push({ key: `visit:${latestVisit.id}`, title: "复诊", date, daysLeft: left, overdue: left < 0 });
  }
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  /* 用药疗程：带「疗程 N 天」的那条是起点，期间每记一次算一次。 */
  const courses: Array<{ logId: string; name: string; dose?: string; startOn: string; courseDays: number; dayIndex: number; dosesToday: number }> = [];
  const courseNames = new Set<string>();
  for (const row of logRows) {
    if (row.kind !== "medication" || !(Number(row.details.courseDays) > 1)) continue;
    const name = String(row.details.name || "");
    if (!name || courseNames.has(name)) continue;
    courseNames.add(name);
    const total = Number(row.details.courseDays);
    const index = daysBetween(row.day, today) + 1;
    if (index < 1 || index > total) continue;
    courses.push({
      logId: row.id, name, dose: row.details.dose ? String(row.details.dose) : undefined, startOn: row.day, courseDays: total, dayIndex: index,
      dosesToday: logRows.filter((item) => item.kind === "medication" && item.day === today && String(item.details.name || "") === name).length,
    });
  }

  return {
    petId: String(pet.id),
    today,
    totalDays: dayList.length,
    streakDays: streak,
    todayCount,
    intervals,
    recentFacts,
    upcoming,
    courses,
    weight: weight.trend ? { statement: weight.trend.statement, latest: formatGrams(weight.trend.latest.weightGrams), measuredOn: weight.trend.latest.measuredOn, note: weight.note || undefined } : undefined,
  };
}


const SPECIES_TEXT: Record<string, string> = { cat: "猫", dog: "狗", other: "宠物" };

/**
 * 给兽医看的就医摘要（免费）。只做罗列与计数：
 * 基本信息 → 最近体重 → 近 N 天身体状况与用药 → 疫苗驱虫最近一次。
 * 付费的健康档案 PDF 是可打印的完整版，这里是「在诊室里打开手机给医生看」的轻量版。
 */
export async function getVisitSummary(userId: string, petId: string, input: unknown = {}) {
  const { days } = z.object({ days: z.coerce.number().int().min(3).max(60).optional().default(14) }).parse(input);
  const pet = await getReadablePet(userId, petId);
  const database = await getDatabase();
  const since = addDays(todayString(), -(days - 1));
  const [logs, weight, care] = await Promise.all([
    database.query<LogRow>(
      "SELECT id,kind,occurred_on,occurred_time,details,note FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 AND kind=ANY($3::text[]) AND occurred_on >= $4::date ORDER BY occurred_on DESC, coalesce(occurred_time,'') DESC LIMIT 80",
      [petId, userId, MEDICAL_CONTEXT_KINDS, since],
    ),
    getWeightHistory(userId, petId),
    database.query("SELECT kind,label,performed_on FROM pet_care_records WHERE pet_id=$1 AND user_id=$2 ORDER BY performed_on DESC LIMIT 20", [petId, userId]),
  ]);
  const header = [
    `${pet.name} · ${SPECIES_TEXT[String(pet.species)] || "宠物"}${pet.birthday ? ` · 生日 ${asDateString(pet.birthday)}` : ""}`,
    weight.trend ? `最近体重 ${formatGrams(weight.trend.latest.weightGrams)}（${weight.trend.latest.measuredOn}）${weight.trend.previous ? `，${weight.trend.statement}` : ""}` : "还没有体重记录",
  ];
  const counts: string[] = [];
  const vomit = logs.filter((row) => row.kind === "vomit").reduce((sum, row) => sum + (Number(row.details?.count) || 1), 0);
  const loose = logs.filter((row) => row.kind === "stool" && LOOSE_STOOL.has(String(row.details?.form))).reduce((sum, row) => sum + (Number(row.details?.count) || 1), 0);
  if (vomit) counts.push(`呕吐 ${vomit} 次`);
  if (loose) counts.push(`便便偏软或更稀 ${loose} 次`);
  const latestCare = new Map<string, string>();
  for (const row of care) if (!latestCare.has(String(row.kind))) latestCare.set(String(row.kind), `${CARE_KIND_TEXT[String(row.kind)]} ${row.label}（${asDateString(row.performed_on)}）`);
  const lines = logs.filter(isInformative).map(recordLine);
  const careLines = [...latestCare.values()];
  const text = [
    ...header,
    "",
    `近 ${days} 天${counts.length ? `：${counts.join("，")}` : ""}`,
    ...(lines.length ? lines.map((line) => `· ${line}`) : ["· 这段时间没有身体状况或用药记录"]),
    ...(careLines.length ? ["", "疫苗驱虫最近一次", ...careLines.map((line) => `· ${line}`)] : []),
    "",
    "以上由主人在「麻麻抱我」里记录，仅供参考。",
  ].join("\n");
  return { petId: String(pet.id), days, header, counts, lines, care: careLines, text };
}

