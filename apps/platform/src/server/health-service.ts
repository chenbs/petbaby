import "server-only";

import { z } from "zod";

import { computeWeightTrend, notableWeightNote } from "@/domain/weight-trend";
import { getDatabase, inTransaction } from "@/server/db/client";
import { consumePurchasedCredit, purchasedCreditBalance } from "@/server/entitlements";
import { HEALTH_DOCUMENT_COST } from "@/domain/dongan-pricing";
import { getWallet, insufficientError, spend } from "@/server/wallet/service";
import { AppError } from "@/server/errors";
import { documentRecordLines, recentContextLines } from "@/server/daily-log-context";
import { buildHealthDocumentSvg, renderHealthDocumentPdf } from "@/server/health/document";
import { adviseWithMeta, selectTriageProvider } from "@/server/health/provider";
import { emergencyAdvisory, matchEmergency, type TriageAdvisory } from "@/server/health/triage";
import { objectStorage } from "@/server/storage";

/*
 * 健康分诊线（改造方案 A1/A2/A3）。
 *
 * **定位是分诊不是诊断**，全部红线见 16 号文 3.8。这一层负责编排：
 * memorial 屏蔽 → 限额 → 快照档案 → 关键词直通或调模型 → 落库。
 *
 * 独立于 generation_tasks / works：健康线的产出不是作品，不进作品库、
 * 不可分享、不产生 works 行。复用会污染现有 10 个玩法的模型。
 */

/** 免费额度。会员不加次数 —— 加次数是鼓励多刷，产品要鼓励的是多积累。 */
const FREE_TEXT_LIMIT = 3;

const sessionSchema = z.object({
  petId: z.string().uuid(),
  description: z.string().trim().min(4, "请多描述一些症状").max(600),
  /** 2026-10-10 起只接收文字。带图的请求明确拒绝，而不是丢掉图片照常分诊 */
  photoIds: z.array(z.unknown()).max(0, "健康助手只接收文字描述，不支持上传图片").optional(),
  /** 是否把近 7 天的日常记录带给分诊。默认带；用户可在页面上关掉 */
  includeRecords: z.boolean().optional().default(true),
});

/** 生日 → 月龄。生日晚于今天（填错）时不给 */
function ageInMonths(birthday?: string) {
  if (!birthday) return undefined;
  const [year, month, day] = birthday.split("-").map(Number);
  const now = new Date();
  const months = (now.getFullYear() - year) * 12 + (now.getMonth() + 1 - month) - (now.getDate() < day ? 1 : 0);
  return months >= 0 ? months : undefined;
}

export interface HealthSession {
  id: string;
  petId: string;
  description: string;
  /** 只有 2026-10-10 前的历史会话可能非空 */
  photoIds: string[];
  triageLevel: string;
  triageSource: string;
  advisory: TriageAdvisory;
  status: string;
  errorCode?: string;
  /** 分诊时一并参考的日常记录行（快照，见 pet_snapshot.recentRecords） */
  contextRecords: string[];
  createdAt: string;
}

function snapshotRecords(snapshot: unknown): string[] {
  const records = (snapshot as { recentRecords?: unknown } | null)?.recentRecords;
  return Array.isArray(records) ? records.map(String) : [];
}

function mapSession(row: Record<string, unknown>): HealthSession {
  return {
    id: String(row.id),
    petId: String(row.pet_id),
    description: String(row.description),
    photoIds: Array.isArray(row.photo_ids) ? row.photo_ids.map(String) : [],
    triageLevel: String(row.triage_level),
    triageSource: String(row.triage_source),
    advisory: (row.advisory || {}) as TriageAdvisory,
    status: String(row.status),
    errorCode: row.error_code ? String(row.error_code) : undefined,
    contextRecords: snapshotRecords(row.pet_snapshot),
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

/**
 * 额度判定。健康额度**独立于创意生成的 daily_quotas** ——
 * 健康分诊用完不该影响做图额度，那是两种资源。
 */
async function consumeQuota(userId: string) {
  const database = await getDatabase();
  const quotaDate = new Date().toISOString().slice(0, 10);
  const rows = await database.query<{ used: number }>(
    "INSERT INTO health_daily_quotas (id,user_id,quota_date,kind,used,created_at) VALUES ($1,$2,$3,'text',1,$4) ON CONFLICT (user_id,quota_date,kind) DO UPDATE SET used=health_daily_quotas.used+1 RETURNING used",
    [crypto.randomUUID(), userId, quotaDate, new Date()],
  );
  if (Number(rows[0]?.used || 0) > FREE_TEXT_LIMIT) {
    throw new AppError("HEALTH_QUOTA_USED", "今天的健康咨询次数已用完，明天再来", 429);
  }
}

export async function createHealthSession(userId: string, input: unknown): Promise<HealthSession> {
  const data = sessionSchema.parse(input);
  const database = await getDatabase();

  const petRows = await database.query(
    "SELECT id,name,species,birthday,date_type,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [data.petId, userId],
  );
  const pet = petRows[0];
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);

  /*
   * memorial 屏蔽（红线 10）。已离开的宠物不出现任何健康功能 ——
   * 收到体检提醒对这些用户是不可接受的。
   *
   * **服务端拦截与端上隐藏都要做**：只做端上隐藏，接口仍可调；
   * 只做服务端拦截，用户会看到入口点进去报错。
   */
  if (String(pet.life_stage) === "memorial") {
    throw new AppError("HEALTH_UNAVAILABLE_MEMORIAL", "这只宠物的健康记录已经封存", 409);
  }

  /*
   * 紧急关键词先判，命中时不扣额度（2026-10 修正）：原先额度在前，
   * 用完 3 次的用户再输入「尿不出来」只会收到「次数已用完」，而不是「立即就医」。
   * 紧急直通不调模型、没有成本，没有理由让额度挡在它前面。
   */
  const emergencyAreas = matchEmergency(data.description);
  if (!emergencyAreas) await consumeQuota(userId);

  // 体重取最近一次记录，作为模型输入。没有也不阻断。
  const weightRows = await database.query<{ weight_grams: number }>(
    "SELECT weight_grams FROM pet_weight_records WHERE pet_id=$1 ORDER BY measured_on DESC LIMIT 1",
    [data.petId],
  );

  /*
   * 近 7 天的日常记录作为分诊上下文（2026-10）。用户描述「今天吐了」时，
   * 模型能看到「前天也吐过两次、昨天只吃了一点」——这是普通问答拿不到的信息。
   * 一并快照进 pet_snapshot：事后追溯时要知道当时模型看到了什么。
   */
  const recentRecords = data.includeRecords ? await recentContextLines(userId, data.petId) : [];

  const petSnapshot = {
    name: String(pet.name),
    species: String(pet.species),
    lifeStage: String(pet.life_stage),
    birthday: pet.birthday ? asDateString(pet.birthday) : undefined,
    weightGrams: weightRows[0] ? Number(weightRows[0].weight_grams) : undefined,
    recentRecords,
  };

  const id = crypto.randomUUID();
  const now = new Date();

  /*
   * 紧急关键词直通（A3）。**必须在调模型之前** ——
   * 模型有延迟也有失败率，等十几秒对尿闭的猫是实际风险。
   */
  if (emergencyAreas) {
    const advisory = emergencyAdvisory(emergencyAreas);
    await database.query(
      "INSERT INTO health_sessions (id,user_id,pet_id,description,photo_ids,pet_snapshot,triage_level,triage_source,advisory,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,'keyword',$8::jsonb,'succeeded',$9)",
      [id, userId, data.petId, data.description, "[]", JSON.stringify(petSnapshot), advisory.level, JSON.stringify(advisory), now],
    );
    return { id, petId: data.petId, description: data.description, photoIds: [], triageLevel: advisory.level, triageSource: "keyword", advisory, status: "succeeded", contextRecords: recentRecords, createdAt: now.toISOString() };
  }

  const provider = selectTriageProvider();
  try {
    const { advisory, provider: channel, model, errors } = await adviseWithMeta(provider, {
      description: data.description,
      pet: { name: petSnapshot.name, species: petSnapshot.species, ageMonths: ageInMonths(petSnapshot.birthday), weightGrams: petSnapshot.weightGrams, lifeStage: petSnapshot.lifeStage },
      recentRecords,
    });
    await database.query(
      "INSERT INTO health_sessions (id,user_id,pet_id,description,photo_ids,pet_snapshot,triage_level,triage_source,advisory,model_snapshot,status,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,$7,'model',$8::jsonb,$9::jsonb,'succeeded',$10)",
      [id, userId, data.petId, data.description, "[]", JSON.stringify(petSnapshot), advisory.level, JSON.stringify(advisory), JSON.stringify({ provider: channel, modelVersion: model, failedChannels: errors }), now],
    );
    return { id, petId: data.petId, description: data.description, photoIds: [], triageLevel: advisory.level, triageSource: "model", advisory, status: "succeeded", contextRecords: recentRecords, createdAt: now.toISOString() };
  } catch (error) {
    /*
     * 失败也要落库。与 generation_tasks 的口径一致：不落库会让用户
     * 看到空白且无法追溯，而健康场景的追溯要求比创意场景更硬。
     */
    const code = error instanceof Error ? error.message.slice(0, 100) : "HEALTH_PROVIDER_UNAVAILABLE";
    const advisory = emergencyAreas ? emergencyAdvisory(emergencyAreas) : undefined;
    await database.query(
      "INSERT INTO health_sessions (id,user_id,pet_id,description,photo_ids,pet_snapshot,triage_level,triage_source,advisory,status,error_code,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb,'observe','model',$7::jsonb,'failed',$8,$9)",
      [id, userId, data.petId, data.description, "[]", JSON.stringify(petSnapshot), JSON.stringify(advisory || {}), code, now],
    );
    throw new AppError("HEALTH_ADVISORY_FAILED", "健康助手暂时不可用，请稍后再试", 503);
  }
}

export async function listHealthSessions(userId: string, petId?: string): Promise<HealthSession[]> {
  const database = await getDatabase();
  const rows = petId
    ? await database.query("SELECT * FROM health_sessions WHERE user_id=$1 AND pet_id=$2 ORDER BY created_at DESC LIMIT 50", [userId, petId])
    : await database.query("SELECT * FROM health_sessions WHERE user_id=$1 ORDER BY created_at DESC LIMIT 50", [userId]);
  return rows.map(mapSession);
}

export async function getHealthSession(userId: string, id: string): Promise<HealthSession> {
  const database = await getDatabase();
  const rows = await database.query("SELECT * FROM health_sessions WHERE id=$1 AND user_id=$2", [id, userId]);
  if (!rows[0]) throw new AppError("HEALTH_SESSION_NOT_FOUND", "健康记录不存在", 404);
  return mapSession(rows[0]);
}

/* ---------- 体重记录（A4）---------- */

const weightSchema = z.object({
  weightGrams: z.number().int().min(50).max(150_000),
  measuredOn: z.string().date(),
  note: z.string().trim().max(100).optional(),
});

/**
 * 把 `date` 列归一成 `YYYY-MM-DD`。
 *
 * **不能直接 `String(value).slice(0, 10)`**：驱动把 `date` 交回来的可能是
 * JS Date 对象，而 `String(new Date())` 是 `"Sat Aug 01 2026 ..."`，
 * 截前 10 位得到 `"Sat Aug 01"`。
 *
 * Date 分支用本地年月日而不是 `toISOString()`：`date` 列没有时区，
 * 驱动按本地零点构造，转 UTC 会在东八区退回前一天 ——
 * 与 domain/companion.ts 的「纯日期串按本地零点」同一个坑。
 */
function asDateString(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

export async function recordWeight(userId: string, petId: string, input: unknown) {
  const data = weightSchema.parse(input);
  const database = await getDatabase();
  const petRows = await database.query("SELECT id FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [petId, userId]);
  if (!petRows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  /*
   * 同一天覆盖而非堆叠：一天称三次没有趋势意义，
   * 而堆叠会让体重曲线在同一个横坐标上出现多个点。
   */
  const rows = await database.query(
    "INSERT INTO pet_weight_records (id,user_id,pet_id,weight_grams,measured_on,note,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (pet_id,measured_on) DO UPDATE SET weight_grams=EXCLUDED.weight_grams,note=EXCLUDED.note RETURNING id,weight_grams,measured_on,note",
    [crypto.randomUUID(), userId, petId, data.weightGrams, data.measuredOn, data.note || null, new Date()],
  );
  const row = rows[0];
  return { id: String(row.id), weightGrams: Number(row.weight_grams), measuredOn: asDateString(row.measured_on), note: row.note ? String(row.note) : undefined };
}

export async function listWeights(userId: string, petId: string) {
  const database = await getDatabase();
  const rows = await database.query(
    "SELECT id,weight_grams,measured_on,note FROM pet_weight_records WHERE pet_id=$1 AND user_id=$2 ORDER BY measured_on DESC LIMIT 200",
    [petId, userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    weightGrams: Number(row.weight_grams),
    measuredOn: asDateString(row.measured_on),
    note: row.note ? String(row.note) : undefined,
  }));
}

/* ---------- 健康档案与年度健康记录（L1 / L2）---------- */

/** 分诊档位的中文。与端上 LEVEL_TEXT 一致 —— 档案里的措辞不能与页面上的不同 */
const LEVEL_TEXT: Record<string, string> = {
  emergency: "建议立即就医",
  urgent_24h: "建议今天带它去看看",
  observe: "先在家观察",
  routine: "通常无需担心",
};

const CARE_KIND_TEXT: Record<string, string> = {
  vaccine: "疫苗",
  deworm_internal: "体内驱虫",
  deworm_external: "体外驱虫",
  checkup: "体检",
};

/** 冻干上线前单买的健康档案凭据在 entitlement_ledger 里的 kind（历史凭据仍可核销一次） */
export const HEALTH_ARCHIVE_KIND = "health_archive";

function todayString(now = new Date()) {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

/**
 * 生成健康档案（A5）或年度健康记录（A6）。
 *
 * **这是就医准备材料不是体检报告**：内容全部来自用户自己录入的记录，
 * 产品只做罗列与减法（体重变化），不给任何结论性判断 —— 见
 * `server/health/document.ts` 的红线说明。
 *
 * `memorial` 宠物拒绝导出（红线 10）。这一条可能有争议 ——
 * 已离开的宠物的历史病历似乎有保存价值 —— 但红线的口径是「不出现任何健康功能」，
 * 而导出入口本身就是健康功能。要给纪念场景的资料保存，那属纪念线的能力，
 * 不该从健康入口进。
 *
 * @param year 传年份即生成年度记录（A6），不传则是完整档案（A5）
 */
export async function createHealthDocument(userId: string, petId: string, options: { year?: number } = {}) {
  const database = await getDatabase();
  const petRows = await database.query(
    "SELECT id,name,species,birthday,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL",
    [petId, userId],
  );
  const pet = petRows[0];
  if (!pet) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  if (String(pet.life_stage) === "memorial") throw new AppError("HEALTH_UNAVAILABLE_MEMORIAL", "这只宠物的健康记录已经封存", 409);

  const year = options.year;
  const kind = year ? "annual" : "archive";

  /*
   * 计费（2026-10-08 起）：健康档案与年度健康记录各 6 颗冻干，导出时扣。
   * 冻干上线前单买的健康档案凭据仍可抵一次（只抵完整档案），抵不了再扣冻干。
   * 扣费与写入文档记录在同一事务；文件生成失败时事务回滚，冻干不会白扣。
   */

  // 余额不足要先弹充值面板，不能等 PDF 渲染、上传完才告知。
  // 这里只预检；最终扣费仍在下面的事务里校验，防止并发消费导致透支。
  const hasLegacyCredit = kind === "archive" && await purchasedCreditBalance(userId, HEALTH_ARCHIVE_KIND) > 0;
  if (!hasLegacyCredit) {
    const wallet = await getWallet(userId);
    if (wallet.frozen) throw new AppError("WALLET_FROZEN", "账户里的冻干暂时不能使用，请联系客服", 409);
    if (wallet.balance < HEALTH_DOCUMENT_COST) throw insufficientError(HEALTH_DOCUMENT_COST, wallet.balance);
  }

  const [weights, care, sessions, records] = await Promise.all([
    year
      ? database.query("SELECT weight_grams,measured_on FROM pet_weight_records WHERE pet_id=$1 AND user_id=$2 AND extract(year from measured_on)=$3 ORDER BY measured_on DESC LIMIT 200", [petId, userId, year])
      : database.query("SELECT weight_grams,measured_on FROM pet_weight_records WHERE pet_id=$1 AND user_id=$2 ORDER BY measured_on DESC LIMIT 200", [petId, userId]),
    year
      ? database.query("SELECT kind,label,performed_on,due_on FROM pet_care_records WHERE pet_id=$1 AND user_id=$2 AND extract(year from performed_on)=$3 ORDER BY performed_on DESC LIMIT 100", [petId, userId, year])
      : database.query("SELECT kind,label,performed_on,due_on FROM pet_care_records WHERE pet_id=$1 AND user_id=$2 ORDER BY performed_on DESC LIMIT 100", [petId, userId]),
    year
      ? database.query("SELECT created_at,triage_level,advisory FROM health_sessions WHERE pet_id=$1 AND user_id=$2 AND status='succeeded' AND extract(year from created_at)=$3 ORDER BY created_at DESC LIMIT 50", [petId, userId, year])
      : database.query("SELECT created_at,triage_level,advisory FROM health_sessions WHERE pet_id=$1 AND user_id=$2 AND status='succeeded' ORDER BY created_at DESC LIMIT 50", [petId, userId]),
    documentRecordLines(userId, petId, year),
  ]);

  const svg = buildHealthDocumentSvg({
    petName: String(pet.name),
    species: String(pet.species),
    birthday: pet.birthday ? asDateString(pet.birthday) : undefined,
    lifeStage: String(pet.life_stage),
    generatedOn: todayString(),
    year,
    weights: weights.map((row) => ({ weightGrams: Number(row.weight_grams), measuredOn: asDateString(row.measured_on) })),
    care: care.map((row) => ({
      kindText: CARE_KIND_TEXT[String(row.kind)] || String(row.kind),
      label: String(row.label),
      performedOn: asDateString(row.performed_on),
      dueOn: row.due_on ? asDateString(row.due_on) : undefined,
    })),
    sessions: sessions.map((row) => {
      const advisory = (row.advisory || {}) as { summary?: string };
      return {
        date: asDateString(row.created_at instanceof Date ? row.created_at : new Date(String(row.created_at))),
        levelText: LEVEL_TEXT[String(row.triage_level)] || String(row.triage_level),
        summary: String(advisory.summary || ""),
      };
    }),
    records,
  });

  const id = crypto.randomUUID();
  const key = `private/${userId}/health/${kind}-${petId}-${id}.pdf`;
  await objectStorage.put(key, await renderHealthDocumentPdf(svg), "application/pdf");
  const summary = { weights: weights.length, care: care.length, sessions: sessions.length, records: records.length, petName: String(pet.name) };
  try {
    await inTransaction(async (transaction) => {
      const legacyCredit = kind === "archive" && await consumePurchasedCredit(userId, HEALTH_ARCHIVE_KIND, "健康档案导出", id);
      if (!legacyCredit) await spend(userId, { units: HEALTH_DOCUMENT_COST, bizKey: `spend:health:${id}`, title: year ? `${year} 年度健康记录` : "健康档案", refType: "health_document", refId: id });
  await transaction.query(
    "INSERT INTO health_documents (id,user_id,pet_id,kind,year,output_key,summary,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)",
    [id, userId, petId, kind, year || null, key, JSON.stringify(summary), new Date()],
  );
    });
  } catch (error) {
    await objectStorage.delete(key);
    throw error;
  }
  return { id, petId, kind, year, createdAt: new Date().toISOString(), ...summary };
}

export async function listHealthDocuments(userId: string, petId?: string) {
  const database = await getDatabase();
  const rows = petId
    ? await database.query("SELECT id,pet_id,kind,year,summary,created_at FROM health_documents WHERE revoked_at IS NULL AND user_id=$1 AND pet_id=$2 ORDER BY created_at DESC LIMIT 50", [userId, petId])
    : await database.query("SELECT id,pet_id,kind,year,summary,created_at FROM health_documents WHERE revoked_at IS NULL AND user_id=$1 ORDER BY created_at DESC LIMIT 50", [userId]);
  return rows.map((row) => ({
    id: String(row.id),
    petId: String(row.pet_id),
    kind: String(row.kind),
    year: row.year ? Number(row.year) : undefined,
    summary: (row.summary || {}) as Record<string, unknown>,
    createdAt: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  }));
}

/**
 * 取档案文件字节。
 *
 * **不可分享**：健康线的产出是私密记录，没有 share_token 也没有公开路径
 * （见 0019 与 16 号文 3.9）。只有本人能下载。
 */
export async function getHealthDocumentFile(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query("SELECT output_key,kind,year FROM health_documents WHERE id=$1 AND user_id=$2 AND revoked_at IS NULL", [id, userId]);
  if (!rows[0]) throw new AppError("HEALTH_DOCUMENT_NOT_FOUND", "健康档案不存在", 404);
  const key = String(rows[0].output_key);
  // 越权兜底：key 必须落在这个用户的私有前缀下。
  if (!key.startsWith(`private/${userId}/`)) throw new AppError("HEALTH_DOCUMENT_NOT_FOUND", "健康档案不存在", 404);
  const object = await objectStorage.get(key);
  if (!object) throw new AppError("HEALTH_DOCUMENT_FILE_MISSING", "档案文件不存在", 404);
  const suffix = rows[0].year ? `-${rows[0].year}` : "";
  return { body: object.body, contentType: "application/pdf", filename: `health-${rows[0].kind}${suffix}.pdf` };
}

/* ---------- 免疫与驱虫记录（L5 的数据来源）---------- */

const careSchema = z.object({
  kind: z.enum(["vaccine", "deworm_internal", "deworm_external", "checkup"]),
  /** 项目名由用户填，不做枚举：疫苗品牌与组合太多，枚举必然漏 */
  label: z.string().trim().min(1).max(40),
  performedOn: z.string().date(),
  /** 下次到期日。为空表示不需要提醒 */
  dueOn: z.string().date().optional(),
  note: z.string().trim().max(100).optional(),
});

/**
 * 记一次免疫 / 驱虫 / 体检。
 *
 * **只存事实不存结论**：记「打了什么、哪天打的、下次哪天」，
 * 不记「是否达标」「保护力如何」—— 后者是评价性判断，接近诊断（红线 1）。
 * 下次日期由用户或厂商说明决定，产品只负责替他记住。
 *
 * `memorial` 宠物拒绝写入（红线 10）：已封存的档案不再接受健康记录，
 * 否则会被 L5 的提示扫到 —— 虽然那边也过滤了，但两处都拦才是这条红线的口径。
 */
export async function recordCare(userId: string, petId: string, input: unknown) {
  const data = careSchema.parse(input);
  const database = await getDatabase();
  const petRows = await database.query("SELECT id,life_stage FROM pets WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [petId, userId]);
  if (!petRows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  if (String(petRows[0].life_stage) === "memorial") throw new AppError("HEALTH_UNAVAILABLE_MEMORIAL", "这只宠物的健康记录已经封存", 409);
  if (data.dueOn && data.dueOn < data.performedOn) throw new AppError("CARE_DUE_BEFORE_PERFORMED", "下次到期日不能早于本次日期", 422);
  const rows = await database.query(
    "INSERT INTO pet_care_records (id,user_id,pet_id,kind,label,performed_on,due_on,note,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id,kind,label,performed_on,due_on,note",
    [crypto.randomUUID(), userId, petId, data.kind, data.label, data.performedOn, data.dueOn || null, data.note || null, new Date()],
  );
  const row = rows[0];
  return {
    id: String(row.id),
    kind: String(row.kind),
    label: String(row.label),
    performedOn: asDateString(row.performed_on),
    dueOn: row.due_on ? asDateString(row.due_on) : undefined,
    note: row.note ? String(row.note) : undefined,
  };
}

export async function listCare(userId: string, petId: string) {
  const database = await getDatabase();
  const rows = await database.query(
    "SELECT id,kind,label,performed_on,due_on,note FROM pet_care_records WHERE pet_id=$1 AND user_id=$2 ORDER BY performed_on DESC LIMIT 200",
    [petId, userId],
  );
  return rows.map((row) => ({
    id: String(row.id),
    kind: String(row.kind),
    label: String(row.label),
    performedOn: asDateString(row.performed_on),
    dueOn: row.due_on ? asDateString(row.due_on) : undefined,
    note: row.note ? String(row.note) : undefined,
  }));
}

/** 删一次称重。填错的体重会让趋势与体重变化提示一直错下去，必须能删。 */
export async function deleteWeight(userId: string, petId: string, id: string) {
  const rows = await (await getDatabase()).query("DELETE FROM pet_weight_records WHERE id=$1 AND pet_id=$2 AND user_id=$3 RETURNING id", [id, petId, userId]);
  if (!rows[0]) throw new AppError("WEIGHT_RECORD_NOT_FOUND", "记录不存在", 404);
  return { deleted: true };
}

export async function deleteCare(userId: string, petId: string, id: string) {
  const rows = await (await getDatabase()).query("DELETE FROM pet_care_records WHERE id=$1 AND pet_id=$2 AND user_id=$3 RETURNING id", [id, petId, userId]);
  if (!rows[0]) throw new AppError("CARE_RECORD_NOT_FOUND", "记录不存在", 404);
  return { deleted: true };
}

/**
 * 体重记录 + 趋势（改造项 L6）。
 *
 * 趋势在服务端算并随列表下发，端上不自己算：口径（含「±1% 内算持平」
 * 与「5% 以上值得提一句」两个阈值）必须只有一份 —— 两端各算一遍，
 * 改了阈值就会出现「小程序说持平、PDF 说增加了」。
 *
 * **趋势是事实陈述不是评价**：给「较上次 +6.2%」，不给「偏胖」。
 * BMI 与肥胖评级接近诊断，见 domain/weight-trend.ts 的说明。
 */
export async function getWeightHistory(userId: string, petId: string) {
  const records = await listWeights(userId, petId);
  const trend = computeWeightTrend(records);
  return { records, trend, note: notableWeightNote(trend) };
}
