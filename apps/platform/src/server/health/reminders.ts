import "server-only";

import { computeWeightTrend, notableWeightNote } from "@/domain/weight-trend";
import { getDatabase } from "@/server/db/client";

/*
 * 健康主动提示（改造项 L5）。
 *
 * 20 号文 3.1 与 6.2 判断三：健康线是「日常打开理由」的全部依据，而它 100% 被动。
 * **合规不产生留存** —— 分诊的合规实现质量很高（关键词直通、药物后置过滤、
 * 13 条对抗测试），但用户不会每天想起来问一次「我的猫怎么了」。
 * 让健康线成为高频场景的是这里的主动提示。
 *
 * 三条铁律：
 *
 * 1. **`memorial` 宠物一律排除**（红线 10）。已离开的宠物收到体检提醒
 *    是不可接受的。SQL 里逐条 `life_stage <> 'memorial'`，不依赖调用方过滤。
 * 2. **只陈述事实，不给结论**。「疫苗到期了」「体重变化了 6%」是事实；
 *    「该打疫苗了」勉强算提醒，「体重异常」是评价，不能出现。
 * 3. **每条提示只推一次**（`health_reminders` 的唯一约束）。Worker 每 60 秒
 *    跑一轮运维动作，没有去重会把同一条每分钟推一次。
 *
 * 走站内通知（`user_notifications`）而不是微信订阅消息：后者是一次授权一次下发，
 * 需要用户逐次授权（见 timeline-service 的授权门），而健康提示的价值在于
 * 用户打开小程序时看得到 —— 站内通知不需要授权，也不会打扰。
 */

/** 到期前多少天开始提示。提前一周够安排时间，又不会早到让人忘记 */
const CARE_DUE_LEAD_DAYS = 7;

/** senior 宠物的体检提示间隔（天）。方案 3.3 的「健康提醒加密」落点 */
const SENIOR_CHECKUP_INTERVAL_DAYS = 90;

/**
 * 单次运行最多推多少条。
 *
 * 上限不是性能考虑而是**体验考虑**：一个养了五只宠物、每只都有疫苗到期的用户
 * 一次收到十几条通知，等于没有通知。宁可这轮推几条、下轮再推。
 */
const MAX_PER_RUN = 20;

type ReminderKind = "care_due" | "weight_change" | "senior_checkup";

export interface HealthReminder {
  petId: string;
  petName: string;
  kind: ReminderKind;
  title: string;
  body: string;
}

/** 纯日期串归一。与 domain/companion.ts 的「纯日期按本地零点」同口径 */
function asDateString(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

/**
 * 写一条提示。已推过（唯一约束冲突）时返回 false，不重复通知。
 *
 * 通知与去重记录**必须一起写**：先写通知再写去重记录时，
 * 两步之间的失败会让同一条提示下一轮再推一次。
 * 这里先插去重记录 —— 冲突就说明推过了，直接跳过，不产生通知。
 */
async function emit(reminder: HealthReminder & { userId: string; subjectKey: string; targetPath: string }): Promise<boolean> {
  const database = await getDatabase();
  const inserted = await database.query(
    "INSERT INTO health_reminders (id,user_id,pet_id,kind,subject_key,created_at) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (pet_id,kind,subject_key) DO NOTHING RETURNING id",
    [crypto.randomUUID(), reminder.userId, reminder.petId, reminder.kind, reminder.subjectKey, new Date()],
  );
  if (!inserted[0]) return false;
  await database.query(
    "INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [crypto.randomUUID(), reminder.userId, `health_${reminder.kind}`, reminder.title, reminder.body, reminder.targetPath, new Date()],
  );
  return true;
}

/**
 * 疫苗 / 驱虫到期提示。
 *
 * 提示语只说「到期日是哪天」这个事实 —— 打不打、打什么由兽医决定，
 * 产品只负责替用户记住日子。**不推荐任何疫苗品牌或驱虫药**（红线 2）。
 */
async function remindCareDue(now: Date, limit: number): Promise<HealthReminder[]> {
  const database = await getDatabase();
  const today = asDateString(now);
  const rows = await database.query<{ id: string; user_id: string; pet_id: string; pet_name: string; label: string; kind: string; due_on: unknown }>(
    `SELECT c.id,c.user_id,c.pet_id,p.name pet_name,c.label,c.kind,c.due_on
       FROM pet_care_records c JOIN pets p ON p.id = c.pet_id
      WHERE c.due_on IS NOT NULL
        AND c.due_on <= ($1::date + $2::int)
        AND p.deleted_at IS NULL
        AND p.life_stage <> 'memorial'
      ORDER BY c.due_on
      LIMIT $3`,
    [today, CARE_DUE_LEAD_DAYS, limit],
  );
  const sent: HealthReminder[] = [];
  for (const row of rows) {
    const dueOn = asDateString(row.due_on);
    const petName = String(row.pet_name);
    const overdue = dueOn < today;
    const reminder: HealthReminder = {
      petId: String(row.pet_id),
      petName,
      kind: "care_due",
      title: overdue ? `${petName}的${row.label}已过期` : `${petName}的${row.label}即将到期`,
      // 只给日期这个事实。不写「请尽快接种」——打什么、打不打由兽医决定。
      body: overdue ? `到期日是 ${dueOn}，可以和兽医确认下一次安排。` : `到期日是 ${dueOn}。`,
    };
    /*
     * subject_key 带上到期日：明年同一条记录续期后 due_on 变了，
     * key 也变，于是能再推一次。只用 record id 会让续期后永远不再提示。
     */
    if (await emit({ ...reminder, userId: String(row.user_id), subjectKey: `${row.id}:${dueOn}`, targetPath: "/pages/health/health" })) sent.push(reminder);
  }
  return sent;
}

/**
 * 体重变化提示（与 L6 同一套口径）。
 *
 * **不说「异常」，只说变化了多少并建议就医时提一下** ——
 * 「异常」是评价性判断，而我们没有资格给正常范围。
 * 文案直接复用 `notableWeightNote`，与页面上的那句逐字一致。
 */
async function remindWeightChange(limit: number): Promise<HealthReminder[]> {
  const database = await getDatabase();
  /*
   * 只看最近有称重的宠物。取每只最近两条 —— 趋势只需要这两个点，
   * 拉全部记录再在 JS 里截断会把上百行读进内存。
   */
  const pets = await database.query<{ id: string; user_id: string; name: string }>(
    `SELECT DISTINCT p.id,p.user_id,p.name
       FROM pets p JOIN pet_weight_records w ON w.pet_id = p.id
      WHERE p.deleted_at IS NULL AND p.life_stage <> 'memorial'
        AND w.measured_on >= (CURRENT_DATE - 30)
      LIMIT $1`,
    [limit],
  );
  const sent: HealthReminder[] = [];
  for (const pet of pets) {
    const rows = await database.query<{ id: string; weight_grams: number; measured_on: unknown }>(
      "SELECT id,weight_grams,measured_on FROM pet_weight_records WHERE pet_id=$1 ORDER BY measured_on DESC LIMIT 2",
      [pet.id],
    );
    const trend = computeWeightTrend(rows.map((row) => ({ weightGrams: Number(row.weight_grams), measuredOn: asDateString(row.measured_on) })));
    const note = notableWeightNote(trend);
    if (!note || !trend) continue;
    const reminder: HealthReminder = {
      petId: String(pet.id),
      petName: String(pet.name),
      kind: "weight_change",
      title: `${pet.name}的体重有变化`,
      body: note,
    };
    // subject_key 用最近一条记录的 id：同一次称重只提醒一次，下次称重才会再判。
    if (await emit({ ...reminder, userId: String(pet.user_id), subjectKey: String(rows[0].id), targetPath: "/pages/health/health" })) sent.push(reminder);
  }
  return sent;
}

/**
 * `senior` 宠物的季度体检提示（方案 3.3 的「健康提醒加密」）。
 *
 * 只对手动设为 `senior` 的宠物生效 —— **生命阶段不按年龄推断**（品种寿命
 * 差异极大，见 CLAUDE.md）。这也是 L4 之外 `senior` 的第一个实际行为：
 * 在此之前把宠物设成晚年后什么都不会变，那比没有这个选项更差。
 *
 * 「季度」的起点取上一条同类提示的时间，而不是固定日历季度：
 * 用户可能在任何时候把宠物设成 senior，按日历季度会让刚设置完就收到提示。
 */
async function remindSeniorCheckup(now: Date, limit: number): Promise<HealthReminder[]> {
  const database = await getDatabase();
  const rows = await database.query<{ id: string; user_id: string; name: string }>(
    `SELECT p.id,p.user_id,p.name
       FROM pets p
      WHERE p.deleted_at IS NULL AND p.life_stage = 'senior'
        AND NOT EXISTS (
          SELECT 1 FROM health_reminders r
           WHERE r.pet_id = p.id AND r.kind = 'senior_checkup'
             AND r.created_at > $1::timestamptz - ($2::int * interval '1 day')
        )
      LIMIT $3`,
    [now.toISOString(), SENIOR_CHECKUP_INTERVAL_DAYS, limit],
  );
  const sent: HealthReminder[] = [];
  for (const pet of rows) {
    const reminder: HealthReminder = {
      petId: String(pet.id),
      petName: String(pet.name),
      kind: "senior_checkup",
      /*
       * 措辞克制。晚年阶段的提醒不能带紧迫感或恐吓 ——
       * 「该做体检了」是提醒，「再不检查就晚了」是恐吓。
       * 也不列具体检查项目：那是兽医根据触诊决定的。
       */
      title: `${pet.name}的季度检查`,
      body: "晚年阶段建议每季度做一次基础检查，具体项目由兽医决定。",
    };
    // 每季度一条：subject_key 带上年份与季度序号，同一季度内不重复。
    const quarter = `${now.getFullYear()}Q${Math.floor(now.getMonth() / 3) + 1}`;
    if (await emit({ ...reminder, userId: String(pet.user_id), subjectKey: quarter, targetPath: "/pages/health/health" })) sent.push(reminder);
  }
  return sent;
}

/**
 * 跑一轮健康提示。由 Worker 的运维轮次调用。
 *
 * 三类提示各自限量，合计不超过 `MAX_PER_RUN` ——
 * 见上面对上限的说明：一次十几条等于没有通知。
 *
 * @param now 注入当天，便于测试
 */
export async function runHealthReminders(now = new Date()) {
  const care = await remindCareDue(now, MAX_PER_RUN);
  const remaining = Math.max(0, MAX_PER_RUN - care.length);
  const weight = remaining ? await remindWeightChange(remaining) : [];
  const senior = remaining - weight.length > 0 ? await remindSeniorCheckup(now, remaining - weight.length) : [];
  return { care: care.length, weight: weight.length, senior: senior.length, total: care.length + weight.length + senior.length };
}
