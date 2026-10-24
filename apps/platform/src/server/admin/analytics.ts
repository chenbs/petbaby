import "server-only";

import { getDatabase } from "@/server/db/client";
import { getImageTemplate, imageTemplateEntries } from "@/server/image-template-registry";
import { plugins } from "@/plugins/registry";
import { funTests } from "@/domain/fun-tests";
import { KIND_SPEC } from "@/server/daily-log-kinds";
import { PET_ART_PHOTO_TEMPLATE_ID } from "@/domain/pet-art-photo";
import { addDays, rangeInstants, type AdminRange } from "@/lib/admin-range";
import { activitySql, PAID_SQL, REFUND_SQL, toNumber } from "./sql";

/*
 * 运营后台的分析查询（总览 / 增长 / 功能 / 收入）。
 * 页面是服务端组件，直接调这里；区间口径见 lib/admin-range.ts，取数口径见 ./sql.ts。
 */

const dayKey = (column: string) => `to_char(timezone('Asia/Shanghai', ${column}), 'YYYY-MM-DD')`;

type Window = { start: Date; end: Date };

function windows(range: AdminRange) {
  return { current: rangeInstants(range.from, range.to), previous: rangeInstants(range.previousFrom, range.previousTo) };
}

/** 生成连续日期轴，缺数据的天补 0，避免折线断开或柱子错位。 */
function fillDays<T extends Record<string, unknown>>(from: string, to: string, rows: T[], empty: Omit<T, "day">): Array<T> {
  const byDay = new Map(rows.map((row) => [String(row.day), row]));
  const result: T[] = [];
  for (let day = from; day <= to; day = addDays(day, 1)) result.push((byDay.get(day) || { ...empty, day }) as T);
  return result;
}

const pluginNames = new Map(plugins.map((plugin) => [plugin.id, plugin.name]));
export function pluginName(id: unknown) {
  const key = String(id ?? "");
  return pluginNames.get(key) || key || "未知玩法";
}

const entryTitles = new Map<string, string>(imageTemplateEntries.map((entry) => [entry.id, entry.title]));

function templateInfo(templateId: unknown) {
  const id = String(templateId ?? "");
  if (id === PET_ART_PHOTO_TEMPLATE_ID) return { title: "宠物艺术写真", entry: "宠物写真" };
  const template = id ? getImageTemplate(id, { includePending: true }) : undefined;
  return { title: template?.title || id || "未登记模板", entry: template ? entryTitles.get(template.entryId) || template.entryId : "其他" };
}

/* ------------------------------------------------------------------ 核心指标 */

async function headline(window: Window) {
  const database = await getDatabase();
  const params = [window.start, window.end];
  const [row] = await database.query(
    `SELECT
       (SELECT count(*)::int FROM users WHERE created_at >= $1 AND created_at < $2) new_users,
       (SELECT count(DISTINCT user_id)::int FROM (${activitySql("$1", "$2")}) a) active_users,
       (SELECT coalesce(sum(amount),0)::float8 FROM (${PAID_SQL}) p WHERE at >= $1 AND at < $2) revenue,
       (SELECT count(DISTINCT user_id)::int FROM (${PAID_SQL}) p WHERE at >= $1 AND at < $2) paying_users,
       (SELECT count(*)::int FROM (${PAID_SQL}) p WHERE at >= $1 AND at < $2) paid_orders,
       (SELECT coalesce(sum(amount),0)::float8 FROM (${REFUND_SQL}) r WHERE at >= $1 AND at < $2) refunds,
       (SELECT coalesce(-sum(delta),0)::int FROM wallet_ledger WHERE reason='spend' AND created_at >= $1 AND created_at < $2) spent_units,
       (SELECT coalesce(sum(delta),0)::int FROM wallet_ledger WHERE reason='spend_return' AND created_at >= $1 AND created_at < $2) returned_units,
       ((SELECT count(*) FROM ai_runs WHERE created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM generation_tasks WHERE created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM video_renders WHERE created_at >= $1 AND created_at < $2 AND retry_of IS NULL))::int creations,
       ((SELECT count(*) FROM ai_runs WHERE status='succeeded' AND created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM generation_tasks WHERE status='succeeded' AND created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM video_renders WHERE status IN ('ready','preview_ready') AND created_at >= $1 AND created_at < $2))::int succeeded,
       ((SELECT count(*) FROM ai_runs WHERE status='failed' AND created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM generation_tasks WHERE status='failed' AND created_at >= $1 AND created_at < $2)
         +(SELECT count(*) FROM video_renders WHERE status='failed' AND created_at >= $1 AND created_at < $2))::int failed,
       (SELECT count(*)::int FROM share_visits WHERE created_at >= $1 AND created_at < $2) share_visits`,
    params,
  );
  const creations = toNumber(row?.creations);
  const finished = toNumber(row?.succeeded) + toNumber(row?.failed);
  return {
    newUsers: toNumber(row?.new_users),
    activeUsers: toNumber(row?.active_users),
    revenue: toNumber(row?.revenue),
    refunds: toNumber(row?.refunds),
    payingUsers: toNumber(row?.paying_users),
    paidOrders: toNumber(row?.paid_orders),
    spentUnits: toNumber(row?.spent_units) - toNumber(row?.returned_units),
    creations,
    succeeded: toNumber(row?.succeeded),
    failed: toNumber(row?.failed),
    successRate: finished ? toNumber(row?.succeeded) / finished : null,
    shareVisits: toNumber(row?.share_visits),
  };
}

export type Headline = Awaited<ReturnType<typeof headline>>;

async function dailyCore(range: AdminRange) {
  const database = await getDatabase();
  const { start, end } = rangeInstants(range.from, range.to);
  const rows = await database.query(
    `WITH act AS (SELECT DISTINCT user_id, ${dayKey("at")} AS day FROM (${activitySql("$1", "$2")}) a),
     registered AS (SELECT id, ${dayKey("created_at")} AS day FROM users WHERE created_at >= $1 AND created_at < $2)
     SELECT day,
       coalesce((SELECT count(*) FROM registered r WHERE r.day=d.day),0)::int new_users,
       coalesce((SELECT count(*) FROM act a WHERE a.day=d.day),0)::int active_users,
       coalesce((SELECT count(*) FROM act a JOIN registered r ON r.id=a.user_id AND r.day=a.day WHERE a.day=d.day),0)::int new_active,
       coalesce((SELECT sum(amount) FROM (${PAID_SQL}) p WHERE p.at >= $1 AND p.at < $2 AND ${dayKey("p.at")}=d.day),0)::float8 revenue,
       coalesce((SELECT count(DISTINCT user_id) FROM (${PAID_SQL}) p WHERE p.at >= $1 AND p.at < $2 AND ${dayKey("p.at")}=d.day),0)::int paying_users
     FROM (SELECT to_char(g, 'YYYY-MM-DD') AS day FROM generate_series($3::date, $4::date, interval '1 day') g) d
     ORDER BY day`,
    [start, end, range.from, range.to],
  );
  return rows.map((row) => ({
    day: String(row.day),
    newUsers: toNumber(row.new_users),
    activeUsers: toNumber(row.active_users),
    returningUsers: Math.max(0, toNumber(row.active_users) - toNumber(row.new_active)),
    revenue: toNumber(row.revenue),
    payingUsers: toNumber(row.paying_users),
  }));
}

/* ------------------------------------------------------------------ 总览 */

export async function getOverview(range: AdminRange) {
  const database = await getDatabase();
  const { current, previous } = windows(range);
  const [now, before, daily, features, attention, totals, audit] = await Promise.all([
    headline(current),
    headline(previous),
    dailyCore(range),
    featureSummary(current),
    attentionQueue(),
    database.query(
      `SELECT (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) users,
         (SELECT count(*)::int FROM pets WHERE deleted_at IS NULL) pets,
         (SELECT count(*)::int FROM photos WHERE deleted_at IS NULL) photos,
         (SELECT count(*)::int FROM works WHERE deleted_at IS NULL) works,
         (SELECT count(DISTINCT user_id)::int FROM (${PAID_SQL}) p) paying_users_all_time`,
    ),
    database.query("SELECT id,actor_id,action,target_type,target_id,metadata->>'reason' reason,created_at FROM audit_logs ORDER BY created_at DESC LIMIT 6"),
  ]);
  return {
    now,
    before,
    daily,
    features,
    attention,
    totals: {
      users: toNumber(totals[0]?.users),
      pets: toNumber(totals[0]?.pets),
      photos: toNumber(totals[0]?.photos),
      works: toNumber(totals[0]?.works),
      payingUsersAllTime: toNumber(totals[0]?.paying_users_all_time),
    },
    audit,
  };
}

/** 需要人处理的事项。每一项都带去处，点进去就能操作。 */
export async function attentionQueue() {
  const database = await getDatabase();
  const [row] = await database.query(
    `SELECT
       (SELECT count(*)::int FROM ai_runs WHERE status='failed' AND created_at >= now()-interval '7 days') failed_ai,
       (SELECT count(*)::int FROM generation_tasks WHERE status='failed' AND created_at >= now()-interval '7 days') failed_tasks,
       (SELECT count(*)::int FROM video_renders WHERE status='failed' AND created_at >= now()-interval '7 days') failed_videos,
       ((SELECT count(*) FROM ai_runs WHERE status='processing' AND locked_at < now()-interval '5 minutes')
         +(SELECT count(*) FROM generation_tasks WHERE status='processing' AND locked_at < now()-interval '5 minutes')
         +(SELECT count(*) FROM video_renders WHERE status='processing' AND locked_at < now()-interval '15 minutes'))::int stale_tasks,
       ((SELECT count(*) FROM ai_runs WHERE status='queued' AND available_at < now()-interval '10 minutes')
         +(SELECT count(*) FROM generation_tasks WHERE status='queued' AND available_at < now()-interval '10 minutes'))::int backlog,
       (SELECT count(*)::int FROM message_subscriptions WHERE status='failed') failed_messages,
       (SELECT count(*)::int FROM physical_orders WHERE status IN ('paid','producing','after_sale')) physical_pending,
       (SELECT count(*)::int FROM payment_refunds WHERE status IN ('pending','processing')) pending_refunds,
       (SELECT count(*)::int FROM ai_provider_circuits WHERE manual_open OR opened_at IS NOT NULL) open_circuits,
       (SELECT coalesce(bool_or(circuit_open),false) FROM system_usage WHERE usage_date=to_char(now() AT TIME ZONE 'UTC','YYYY-MM-DD')) generation_circuit`,
  );
  return {
    failedAi: toNumber(row?.failed_ai),
    failedTasks: toNumber(row?.failed_tasks),
    failedVideos: toNumber(row?.failed_videos),
    staleTasks: toNumber(row?.stale_tasks),
    backlog: toNumber(row?.backlog),
    failedMessages: toNumber(row?.failed_messages),
    physicalPending: toNumber(row?.physical_pending),
    pendingRefunds: toNumber(row?.pending_refunds),
    openCircuits: toNumber(row?.open_circuits),
    generationCircuit: Boolean(row?.generation_circuit),
  };
}

/* ------------------------------------------------------------------ 增长 */

/*
 * 渠道归因（迁移 0044）：区间内新注册用户，按首次进入的渠道 / 投放标记分组，看到建档、消耗冻干、付费与累计实收。
 * 付费与实收不限在区间内发生：要回答的是「这批人最后值多少钱」。
 */
const CHANNEL_COHORT_SQL = `WITH paid AS (SELECT user_id, sum(amount)::float8 amount FROM (${PAID_SQL}) p GROUP BY user_id),
  cohort AS (
    SELECT u.id, u.acquisition_channel, u.acquisition_src, coalesce(paid.amount,0) revenue, paid.user_id IS NOT NULL is_paid
    FROM users u LEFT JOIN paid ON paid.user_id=u.id
    WHERE u.created_at >= $1 AND u.created_at < $2 AND u.deleted_at IS NULL)`;
const CHANNEL_STEPS_SQL = `count(*)::int registered,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pets p WHERE p.user_id=c.id))::int has_pet,
  count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_ledger l WHERE l.user_id=c.id AND l.reason='spend'))::int spent,
  count(*) FILTER (WHERE c.is_paid)::int paid,
  coalesce(sum(c.revenue),0)::float8 revenue`;

function mapChannelRow(row: Record<string, unknown>) {
  return { key: String(row.key), registered: toNumber(row.registered), hasPet: toNumber(row.has_pet), spent: toNumber(row.spent), paid: toNumber(row.paid), revenue: toNumber(row.revenue) };
}

export async function getGrowth(range: AdminRange) {
  const database = await getDatabase();
  const { current, previous } = windows(range);
  const today = range.to;
  const mauStart = rangeInstants(addDays(today, -29), today);
  const wauStart = rangeInstants(addDays(today, -6), today);
  const dauStart = rangeInstants(today, today);
  const cohortFrom = addDays(today, -7 * 8 + 1);
  const cohortWindow = rangeInstants(cohortFrom, today);
  const [now, before, daily, stickiness, funnel, retention, cohortRows, mix, channelRows, sourceRows, inviteRows] = await Promise.all([
    headline(current),
    headline(previous),
    dailyCore(range),
    database.query(
      `SELECT
         (SELECT count(DISTINCT user_id)::int FROM (${activitySql("$1", "$2")}) a) mau,
         (SELECT count(DISTINCT user_id)::int FROM (${activitySql("$3", "$2")}) a) wau,
         (SELECT count(DISTINCT user_id)::int FROM (${activitySql("$4", "$2")}) a) dau`,
      [mauStart.start, mauStart.end, wauStart.start, dauStart.start],
    ),
    // 区间内新注册用户的激活漏斗：每一步只看「是否曾经做到」，不限在区间内完成。
    database.query(
      `WITH cohort AS (SELECT id FROM users WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL)
       SELECT count(*)::int registered,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM pets p WHERE p.user_id=c.id))::int has_pet,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM photos p WHERE p.user_id=c.id))::int uploaded,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM ai_runs r WHERE r.user_id=c.id) OR EXISTS (SELECT 1 FROM generation_tasks t WHERE t.user_id=c.id) OR EXISTS (SELECT 1 FROM video_renders v WHERE v.user_id=c.id))::int created,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM wallet_ledger l WHERE l.user_id=c.id AND l.reason='spend'))::int spent,
         count(*) FILTER (WHERE EXISTS (SELECT 1 FROM (${PAID_SQL}) p WHERE p.user_id=c.id))::int paid
       FROM cohort c`,
      [current.start, current.end],
    ),
    // 次日留存与 7 日内回访：只统计「已经过了观察期」的注册日，否则最近几天天然是 0。
    database.query(
      `WITH cohort AS (SELECT id, timezone('Asia/Shanghai', created_at)::date AS reg FROM users WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL),
       act AS (SELECT DISTINCT user_id, timezone('Asia/Shanghai', at)::date AS day FROM (${activitySql("$1", "now()")}) a)
       SELECT
         count(*) FILTER (WHERE c.reg <= $3::date - 1)::int d1_base,
         count(*) FILTER (WHERE c.reg <= $3::date - 1 AND EXISTS (SELECT 1 FROM act a WHERE a.user_id=c.id AND a.day = c.reg + 1))::int d1,
         count(*) FILTER (WHERE c.reg <= $3::date - 7)::int d7_base,
         count(*) FILTER (WHERE c.reg <= $3::date - 7 AND EXISTS (SELECT 1 FROM act a WHERE a.user_id=c.id AND a.day > c.reg AND a.day <= c.reg + 7))::int d7
       FROM cohort c`,
      [current.start, current.end, today],
    ),
    // 周留存矩阵：最近 8 个注册周，按北京时间周一切周。
    database.query(
      `WITH cohort AS (SELECT id, date_trunc('week', timezone('Asia/Shanghai', created_at))::date AS wk FROM users WHERE created_at >= $1 AND created_at < $2 AND deleted_at IS NULL),
       act AS (SELECT DISTINCT user_id, date_trunc('week', timezone('Asia/Shanghai', at))::date AS wk FROM (${activitySql("$1", "$2")}) a)
       SELECT to_char(c.wk, 'YYYY-MM-DD') cohort, (SELECT count(*) FROM cohort x WHERE x.wk=c.wk)::int size,
         ((a.wk - c.wk) / 7)::int week_offset, count(DISTINCT a.user_id)::int retained
       FROM cohort c JOIN act a ON a.user_id=c.id AND a.wk >= c.wk
       GROUP BY c.wk, a.wk ORDER BY c.wk, week_offset`,
      [cohortWindow.start, cohortWindow.end],
    ),
    database.query(
      `SELECT
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL) users,
         (SELECT count(*)::int FROM users WHERE deleted_at IS NULL AND EXISTS (SELECT 1 FROM pets p WHERE p.user_id=users.id AND p.deleted_at IS NULL)) with_pet,
         (SELECT count(*)::int FROM users WHERE deleted_at IS NOT NULL) deleted,
         (SELECT count(*)::int FROM users WHERE admin_suspended_at IS NOT NULL AND deleted_at IS NULL) suspended,
         (SELECT coalesce(json_agg(json_build_object('key', species, 'count', n)), '[]'::json) FROM (SELECT species, count(*)::int n FROM pets WHERE deleted_at IS NULL GROUP BY species ORDER BY n DESC) s) species,
         (SELECT coalesce(json_agg(json_build_object('key', life_stage, 'count', n)), '[]'::json) FROM (SELECT life_stage, count(*)::int n FROM pets WHERE deleted_at IS NULL GROUP BY life_stage ORDER BY n DESC) s) stages,
         (SELECT coalesce(json_agg(json_build_object('key', bucket, 'count', n)), '[]'::json) FROM (
            SELECT CASE WHEN c=1 THEN '1 只' WHEN c=2 THEN '2 只' ELSE '3 只及以上' END bucket, count(*)::int n
            FROM (SELECT user_id, count(*) c FROM pets WHERE deleted_at IS NULL GROUP BY user_id) x GROUP BY 1 ORDER BY 1) s) pets_per_user`,
    ),
    database.query(
      `${CHANNEL_COHORT_SQL}
       SELECT coalesce(c.acquisition_channel,'unknown') AS key, ${CHANNEL_STEPS_SQL}
       FROM cohort c GROUP BY 1 ORDER BY registered DESC`,
      [current.start, current.end],
    ),
    database.query(
      `${CHANNEL_COHORT_SQL}
       SELECT c.acquisition_src AS key, ${CHANNEL_STEPS_SQL}
       FROM cohort c WHERE c.acquisition_src IS NOT NULL GROUP BY 1 ORDER BY registered DESC LIMIT 30`,
      [current.start, current.end],
    ),
    database.query(
      `SELECT count(*) FILTER (WHERE status='granted')::int granted, count(*) FILTER (WHERE status='capped')::int capped,
         coalesce(sum(units),0)::int units, count(DISTINCT inviter_id)::int inviters
       FROM invite_rewards WHERE created_at >= $1 AND created_at < $2`,
      [current.start, current.end],
    ),
  ]);

  const cohorts = new Map<string, { cohort: string; size: number; weeks: number[] }>();
  for (const row of cohortRows) {
    const key = String(row.cohort);
    const item = cohorts.get(key) || { cohort: key, size: toNumber(row.size), weeks: [] };
    item.weeks[toNumber(row.week_offset)] = toNumber(row.retained);
    cohorts.set(key, item);
  }
  const todayWeek = mondayOf(today);
  const cohortList = [...cohorts.values()].map((item) => {
    const elapsed = Math.floor((Date.parse(`${todayWeek}T00:00:00Z`) - Date.parse(`${item.cohort}T00:00:00Z`)) / (7 * 86_400_000));
    return { ...item, weeks: Array.from({ length: elapsed + 1 }, (_, index) => item.weeks[index] || 0) };
  });

  const r = retention[0] || {};
  const parseMix = (value: unknown) => (typeof value === "string" ? JSON.parse(value) : value || []) as Array<{ key: string; count: number }>;
  const m = mix[0] || {};
  return {
    now,
    before,
    daily,
    stickiness: { dau: toNumber(stickiness[0]?.dau), wau: toNumber(stickiness[0]?.wau), mau: toNumber(stickiness[0]?.mau) },
    funnel: [
      { key: "registered", label: "注册", value: toNumber(funnel[0]?.registered) },
      { key: "has_pet", label: "建立宠物档案", value: toNumber(funnel[0]?.has_pet) },
      { key: "uploaded", label: "上传照片", value: toNumber(funnel[0]?.uploaded) },
      { key: "created", label: "首次创作", value: toNumber(funnel[0]?.created) },
      { key: "spent", label: "首次消耗冻干", value: toNumber(funnel[0]?.spent) },
      { key: "paid", label: "首次付费", value: toNumber(funnel[0]?.paid) },
    ],
    retention: {
      d1: toNumber(r.d1_base) ? toNumber(r.d1) / toNumber(r.d1_base) : null,
      d1Base: toNumber(r.d1_base),
      d7: toNumber(r.d7_base) ? toNumber(r.d7) / toNumber(r.d7_base) : null,
      d7Base: toNumber(r.d7_base),
    },
    cohorts: cohortList,
    channels: channelRows.map(mapChannelRow),
    sources: sourceRows.map(mapChannelRow),
    invites: { granted: toNumber(inviteRows[0]?.granted), capped: toNumber(inviteRows[0]?.capped), units: toNumber(inviteRows[0]?.units), inviters: toNumber(inviteRows[0]?.inviters) },
    base: {
      users: toNumber(m.users),
      withPet: toNumber(m.with_pet),
      deleted: toNumber(m.deleted),
      suspended: toNumber(m.suspended),
      species: parseMix(m.species),
      stages: parseMix(m.stages),
      petsPerUser: parseMix(m.pets_per_user),
    },
  };
}

function mondayOf(day: string) {
  const date = new Date(`${day}T00:00:00Z`);
  const offset = (date.getUTCDay() + 6) % 7;
  return addDays(day, -offset);
}

/* ------------------------------------------------------------------ 功能使用 */

export const FEATURE_GROUPS = [
  { key: "image", label: "创意照片" },
  { key: "bundle", label: "写真套餐" },
  { key: "layout", label: "排版玩法" },
  { key: "video", label: "短片" },
  { key: "health", label: "健康助手" },
  { key: "records", label: "日常记录" },
  { key: "funtest", label: "趣测" },
  { key: "memorial", label: "纪念空间" },
] as const;

export type FeatureKey = (typeof FEATURE_GROUPS)[number]["key"];

/** 功能日趋势单独着色的业务线（固定顺序 = 固定色槽），其余并入「其他」。 */
export const CHART_FEATURES = ["image", "bundle", "layout", "video"] as const satisfies readonly FeatureKey[];

/** 每类功能在窗口内的使用次数、人数、成功 / 失败。写真套餐里的每一张单独记在套餐名下，不算进创意照片。 */
async function featureSummary(window: Window) {
  const database = await getDatabase();
  const rows = await database.query(
    `SELECT 'image' feature, count(*)::int uses, count(DISTINCT user_id)::int users,
        count(*) FILTER (WHERE status='succeeded')::int succeeded, count(*) FILTER (WHERE status='failed')::int failed
       FROM ai_runs WHERE created_at >= $1 AND created_at < $2 AND NOT (options ? 'artPhotoBatchId')
     UNION ALL SELECT 'bundle', count(*)::int, count(DISTINCT user_id)::int,
        count(*) FILTER (WHERE status IN ('completed','partial'))::int, count(*) FILTER (WHERE status='failed')::int
       FROM art_photo_batches WHERE created_at >= $1 AND created_at < $2 AND status <> 'pending'
     UNION ALL SELECT 'layout', count(*)::int, count(DISTINCT user_id)::int,
        count(*) FILTER (WHERE status='succeeded')::int, count(*) FILTER (WHERE status='failed')::int
       FROM generation_tasks WHERE created_at >= $1 AND created_at < $2
     UNION ALL SELECT 'video', count(*)::int, count(DISTINCT user_id)::int,
        count(*) FILTER (WHERE status IN ('ready','preview_ready'))::int, count(*) FILTER (WHERE status='failed')::int
       FROM video_renders WHERE created_at >= $1 AND created_at < $2 AND retry_of IS NULL
     UNION ALL SELECT 'health', count(*)::int, count(DISTINCT user_id)::int,
        count(*) FILTER (WHERE status='succeeded')::int, count(*) FILTER (WHERE status<>'succeeded')::int
       FROM health_sessions WHERE created_at >= $1 AND created_at < $2
     UNION ALL SELECT 'records', count(*)::int, count(DISTINCT user_id)::int, count(*)::int, 0
       FROM pet_daily_logs WHERE created_at >= $1 AND created_at < $2
     UNION ALL SELECT 'funtest', count(*)::int, count(DISTINCT user_id)::int, count(*)::int, 0
       FROM fun_test_results WHERE created_at >= $1 AND created_at < $2
     UNION ALL SELECT 'memorial', count(*)::int, count(DISTINCT user_id)::int, count(*)::int, 0
       FROM memorial_spaces WHERE created_at >= $1 AND created_at < $2`,
    [window.start, window.end],
  );
  const byKey = new Map(rows.map((row) => [String(row.feature), row]));
  return FEATURE_GROUPS.map((group) => {
    const row = byKey.get(group.key) || {};
    const succeeded = toNumber(row.succeeded);
    const failed = toNumber(row.failed);
    return { key: group.key, label: group.label, uses: toNumber(row.uses), users: toNumber(row.users), succeeded, failed, successRate: succeeded + failed ? succeeded / (succeeded + failed) : null };
  });
}

export async function getFeatures(range: AdminRange) {
  const database = await getDatabase();
  const { current, previous } = windows(range);
  const params = [current.start, current.end];
  const [summary, previousSummary, dailyRows, templateRows, layoutRows, videoRows, healthRows, recordRows, funRows, spendRows, errorRows, shareRows] = await Promise.all([
    featureSummary(current),
    featureSummary(previous),
    database.query(
      `SELECT day, feature, count(*)::int uses FROM (
         SELECT ${dayKey("created_at")} AS day, CASE WHEN options ? 'artPhotoBatchId' THEN 'bundle' ELSE 'image' END AS feature FROM ai_runs WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT ${dayKey("created_at")}, 'layout' FROM generation_tasks WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT ${dayKey("created_at")}, 'video' FROM video_renders WHERE created_at >= $1 AND created_at < $2 AND retry_of IS NULL
         UNION ALL SELECT ${dayKey("created_at")}, 'health' FROM health_sessions WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT ${dayKey("created_at")}, 'records' FROM pet_daily_logs WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT ${dayKey("created_at")}, 'funtest' FROM fun_test_results WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT ${dayKey("created_at")}, 'memorial' FROM memorial_spaces WHERE created_at >= $1 AND created_at < $2
       ) x GROUP BY day, feature`,
      params,
    ),
    database.query(
      `SELECT coalesce(options->>'templateId', role_inputs->>'templateId', '') template_id, count(*)::int uses, count(DISTINCT user_id)::int users,
         count(*) FILTER (WHERE status='succeeded')::int succeeded, count(*) FILTER (WHERE status='failed')::int failed,
         count(*) FILTER (WHERE options ? 'rerollOf')::int rerolls
       FROM ai_runs WHERE created_at >= $1 AND created_at < $2 AND NOT (options ? 'artPhotoBatchId')
       GROUP BY 1 ORDER BY uses DESC`,
      params,
    ),
    database.query(
      `SELECT plugin_id, count(*)::int uses, count(DISTINCT user_id)::int users,
         count(*) FILTER (WHERE status='succeeded')::int succeeded, count(*) FILTER (WHERE status='failed')::int failed
       FROM generation_tasks WHERE created_at >= $1 AND created_at < $2 GROUP BY plugin_id ORDER BY uses DESC`,
      params,
    ),
    database.query(
      `SELECT CASE WHEN config->>'kind'='annual-film' THEN 'annual' WHEN EXISTS (SELECT 1 FROM memorial_spaces m WHERE m.product_jobs->'video'->>'renderId'=r.id::text) THEN 'memorial' ELSE 'memory' END kind,
         count(*)::int uses, count(DISTINCT user_id)::int users,
         count(*) FILTER (WHERE status IN ('ready','preview_ready'))::int succeeded, count(*) FILTER (WHERE status='failed')::int failed
       FROM video_renders r WHERE created_at >= $1 AND created_at < $2 AND retry_of IS NULL GROUP BY 1 ORDER BY uses DESC`,
      params,
    ),
    database.query(
      `SELECT triage_level, triage_source, count(*)::int sessions FROM health_sessions WHERE created_at >= $1 AND created_at < $2 GROUP BY 1,2 ORDER BY sessions DESC`,
      params,
    ),
    database.query(
      `SELECT kind, count(*)::int logs, count(DISTINCT user_id)::int users FROM (
         SELECT kind, user_id FROM pet_daily_logs WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT 'weight', user_id FROM pet_weight_records WHERE created_at >= $1 AND created_at < $2
         UNION ALL SELECT 'care', user_id FROM pet_care_records WHERE created_at >= $1 AND created_at < $2
       ) x GROUP BY kind ORDER BY logs DESC`,
      params,
    ),
    database.query("SELECT test_id, count(*)::int results, count(DISTINCT user_id)::int users FROM fun_test_results WHERE created_at >= $1 AND created_at < $2 GROUP BY test_id ORDER BY results DESC", params),
    database.query(
      `SELECT coalesce(ref_type,'other') ref_type, count(*)::int spends, coalesce(-sum(delta),0)::int units
       FROM wallet_ledger WHERE reason='spend' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY units DESC`,
      params,
    ),
    database.query(
      `SELECT source, error_code, count(*)::int failures FROM (
         SELECT '创意照片' source, coalesce(error_code,'UNKNOWN') error_code FROM ai_runs WHERE status='failed' AND created_at >= $1 AND created_at < $2
         UNION ALL SELECT '排版玩法', coalesce(error_code,'UNKNOWN') FROM generation_tasks WHERE status='failed' AND created_at >= $1 AND created_at < $2
         UNION ALL SELECT '短片', coalesce(error_code,'UNKNOWN') FROM video_renders WHERE status='failed' AND created_at >= $1 AND created_at < $2
       ) x GROUP BY 1,2 ORDER BY failures DESC LIMIT 12`,
      params,
    ),
    database.query(
      `SELECT count(*)::int visits, count(DISTINCT visitor_key)::int visitors, count(DISTINCT work_id)::int works,
         (SELECT count(*)::int FROM events WHERE name='shared' AND created_at >= $1 AND created_at < $2) shares
       FROM share_visits WHERE created_at >= $1 AND created_at < $2`,
      params,
    ),
  ]);

  /*
   * 日趋势的系列是固定的：4 条创作线各占一个经校验的分类色槽位，陪伴类（健康、记录、趣测、纪念）并成「其他」。
   * 不按当期排名挑前 4 —— 那样换个区间颜色就会换主人（颜色必须跟着业务线走，不跟排名走）。
   */
  const top: FeatureKey[] = [...CHART_FEATURES];
  const series = top.map((key) => ({ key, label: FEATURE_GROUPS.find((group) => group.key === key)!.label }));
  const dailyMap = new Map<string, Record<string, number>>();
  for (const row of dailyRows) {
    const day = String(row.day);
    const bucket = top.includes(String(row.feature) as FeatureKey) ? String(row.feature) : "other";
    const entry = dailyMap.get(day) || {};
    entry[bucket] = (entry[bucket] || 0) + toNumber(row.uses);
    dailyMap.set(day, entry);
  }
  const empty = Object.fromEntries([...top, "other"].map((key) => [key, 0]));
  const daily = fillDays(range.from, range.to, [...dailyMap.entries()].map(([day, values]) => ({ day, ...empty, ...values })), empty);
  const hasOther = daily.some((row) => Number((row as Record<string, unknown>).other) > 0);

  const previousByKey = new Map(previousSummary.map((item) => [item.key, item]));
  const templateByEntry = new Map<string, number>();
  const templates = templateRows.map((row) => {
    const info = templateInfo(row.template_id);
    templateByEntry.set(info.entry, (templateByEntry.get(info.entry) || 0) + toNumber(row.uses));
    const succeeded = toNumber(row.succeeded);
    const failed = toNumber(row.failed);
    return { templateId: String(row.template_id), title: info.title, entry: info.entry, uses: toNumber(row.uses), users: toNumber(row.users), succeeded, failed, rerolls: toNumber(row.rerolls), successRate: succeeded + failed ? succeeded / (succeeded + failed) : null };
  });
  const videoLabels: Record<string, string> = { annual: "年度短片", memorial: "纪念短片", memory: "记忆短片" };
  const funTitles = new Map(funTests.map((test) => [test.id, test.title]));
  return {
    summary: summary.map((item) => ({ ...item, previousUses: previousByKey.get(item.key)?.uses || 0 })),
    daily,
    series,
    hasOther,
    templates: templates.slice(0, 20),
    entries: [...templateByEntry.entries()].map(([entry, uses]) => ({ entry, uses })).sort((left, right) => right.uses - left.uses),
    layouts: layoutRows.map((row) => ({ pluginId: String(row.plugin_id), name: pluginName(row.plugin_id), uses: toNumber(row.uses), users: toNumber(row.users), succeeded: toNumber(row.succeeded), failed: toNumber(row.failed) })),
    videos: videoRows.map((row) => ({ kind: String(row.kind), label: videoLabels[String(row.kind)] || String(row.kind), uses: toNumber(row.uses), users: toNumber(row.users), succeeded: toNumber(row.succeeded), failed: toNumber(row.failed) })),
    health: healthRows.map((row) => ({ level: String(row.triage_level), source: String(row.triage_source), sessions: toNumber(row.sessions) })),
    records: recordRows.map((row) => ({ kind: String(row.kind), label: KIND_SPEC[String(row.kind)]?.label || String(row.kind), logs: toNumber(row.logs), users: toNumber(row.users) })),
    funTests: funRows.map((row) => ({ testId: String(row.test_id), title: funTitles.get(String(row.test_id)) || String(row.test_id), results: toNumber(row.results), users: toNumber(row.users) })),
    spend: spendRows.map((row) => ({ refType: String(row.ref_type), spends: toNumber(row.spends), units: toNumber(row.units) })),
    errors: errorRows.map((row) => ({ source: String(row.source), errorCode: String(row.error_code), failures: toNumber(row.failures) })),
    shares: { visits: toNumber(shareRows[0]?.visits), visitors: toNumber(shareRows[0]?.visitors), works: toNumber(shareRows[0]?.works), shares: toNumber(shareRows[0]?.shares) },
  };
}

/* ------------------------------------------------------------------ 收入 */

export const REVENUE_SOURCES = ["topup", "growth", "physical", "work"] as const;

export async function getRevenue(range: AdminRange) {
  const database = await getDatabase();
  const { current, previous } = windows(range);
  const params = [current.start, current.end];
  const [now, before, dailyRows, sourceRows, packageRows, economyRows, liabilityRows, spendRows, payerRows, firstTopup, refundRows] = await Promise.all([
    headline(current),
    headline(previous),
    database.query(`SELECT ${dayKey("at")} AS day, source, coalesce(sum(amount),0)::float8 amount FROM (${PAID_SQL}) p WHERE at >= $1 AND at < $2 GROUP BY 1,2`, params),
    database.query(`SELECT source, count(*)::int orders, count(DISTINCT user_id)::int users, coalesce(sum(amount),0)::float8 amount FROM (${PAID_SQL}) p WHERE at >= $1 AND at < $2 GROUP BY 1`, params),
    database.query(
      `SELECT sku, count(*)::int orders, coalesce(sum(amount),0)::float8 amount, coalesce(sum((entitlement_snapshot->>'units')::int),0)::int units
       FROM growth_orders WHERE kind='wallet_topup' AND paid_at >= $1 AND paid_at < $2 GROUP BY sku ORDER BY amount DESC`,
      params,
    ),
    database.query(
      `SELECT ${dayKey("created_at")} AS day,
         coalesce(sum(delta) FILTER (WHERE reason='topup'),0)::int topup,
         coalesce(sum(delta) FILTER (WHERE reason IN ('newcomer_gift','admin_grant','invite_reward')),0)::int gift,
         coalesce(-sum(delta) FILTER (WHERE reason='spend'),0)::int spent,
         coalesce(sum(delta) FILTER (WHERE reason='spend_return'),0)::int returned,
         coalesce(-sum(delta) FILTER (WHERE reason IN ('expire','topup_refund')),0)::int expired
       FROM wallet_ledger WHERE created_at >= $1 AND created_at < $2 GROUP BY 1`,
      params,
    ),
    database.query(
      `SELECT coalesce(sum(remaining) FILTER (WHERE pocket='purchased'),0)::int purchased_units,
         coalesce(sum(remaining*coalesce(unit_price_fen,0)) FILTER (WHERE pocket='purchased'),0)::float8 purchased_fen,
         coalesce(sum(remaining) FILTER (WHERE pocket='gift'),0)::int gift_units,
         coalesce(sum(remaining) FILTER (WHERE pocket='gift' AND expires_at < now()+interval '7 days'),0)::int gift_expiring,
         (SELECT count(*)::int FROM wallet_accounts WHERE balance > 0) holders
       FROM wallet_lots WHERE status='active' AND (expires_at IS NULL OR expires_at > now())`,
    ),
    database.query(
      `SELECT coalesce(ref_type,'other') ref_type, count(*)::int spends, count(DISTINCT user_id)::int users, coalesce(-sum(delta),0)::int units
       FROM wallet_ledger WHERE reason='spend' AND created_at >= $1 AND created_at < $2 GROUP BY 1 ORDER BY units DESC`,
      params,
    ),
    database.query(
      `SELECT p.user_id, u.display_name, count(*)::int orders, coalesce(sum(p.amount),0)::float8 amount, max(p.at) last_paid_at
       FROM (${PAID_SQL}) p JOIN users u ON u.id=p.user_id WHERE p.at >= $1 AND p.at < $2
       GROUP BY p.user_id, u.display_name ORDER BY amount DESC LIMIT 10`,
      params,
    ),
    database.query(
      `SELECT count(*)::int first_topups,
         (SELECT count(*)::int FROM wallet_accounts WHERE newcomer_gift_at >= $1 AND newcomer_gift_at < $2) gifted
       FROM wallet_accounts WHERE first_topup_at >= $1 AND first_topup_at < $2`,
      params,
    ),
    database.query(
      `SELECT t.order_kind, count(*)::int refunds, coalesce(sum(r.amount_fen),0)::int amount_fen
       FROM payment_refunds r JOIN payment_transactions t ON t.id=r.payment_id
       WHERE r.status='succeeded' AND coalesce(r.completed_at, r.created_at) >= $1 AND coalesce(r.completed_at, r.created_at) < $2 GROUP BY 1`,
      params,
    ),
  ]);

  const emptyRevenue = Object.fromEntries(REVENUE_SOURCES.map((key) => [key, 0])) as Record<(typeof REVENUE_SOURCES)[number], number>;
  const revenueMap = new Map<string, Record<string, number>>();
  for (const row of dailyRows) {
    const entry = revenueMap.get(String(row.day)) || { ...emptyRevenue };
    entry[String(row.source)] = toNumber(row.amount);
    revenueMap.set(String(row.day), entry);
  }
  const daily = fillDays(range.from, range.to, [...revenueMap.entries()].map(([day, values]) => ({ day, ...emptyRevenue, ...values })), emptyRevenue);
  const economyEmpty = { topup: 0, gift: 0, spent: 0, returned: 0, expired: 0 };
  const economy = fillDays(range.from, range.to, economyRows.map((row) => ({ day: String(row.day), topup: toNumber(row.topup), gift: toNumber(row.gift), spent: toNumber(row.spent), returned: toNumber(row.returned), expired: toNumber(row.expired) })), economyEmpty);
  const totals = economy.reduce((sum, row) => ({ topup: sum.topup + row.topup, gift: sum.gift + row.gift, spent: sum.spent + row.spent, returned: sum.returned + row.returned, expired: sum.expired + row.expired }), economyEmpty);
  const l = liabilityRows[0] || {};
  return {
    now,
    before,
    arppu: now.payingUsers ? now.revenue / now.payingUsers : 0,
    previousArppu: before.payingUsers ? before.revenue / before.payingUsers : 0,
    payRate: now.activeUsers ? now.payingUsers / now.activeUsers : null,
    previousPayRate: before.activeUsers ? before.payingUsers / before.activeUsers : null,
    daily,
    sources: REVENUE_SOURCES.map((source) => {
      const row = sourceRows.find((item) => item.source === source) || {};
      return { source, orders: toNumber(row.orders), users: toNumber(row.users), amount: toNumber(row.amount) };
    }),
    packages: packageRows.map((row) => ({ sku: String(row.sku), orders: toNumber(row.orders), amount: toNumber(row.amount), units: toNumber(row.units) })),
    economy,
    economyTotals: totals,
    liability: {
      purchasedUnits: toNumber(l.purchased_units),
      purchasedAmount: Math.round(toNumber(l.purchased_fen)) / 100,
      giftUnits: toNumber(l.gift_units),
      giftExpiring: toNumber(l.gift_expiring),
      holders: toNumber(l.holders),
    },
    spend: spendRows.map((row) => ({ refType: String(row.ref_type), spends: toNumber(row.spends), users: toNumber(row.users), units: toNumber(row.units) })),
    payers: payerRows.map((row) => ({ userId: String(row.user_id), displayName: row.display_name ? String(row.display_name) : "", orders: toNumber(row.orders), amount: toNumber(row.amount), lastPaidAt: row.last_paid_at as string })),
    firstTopups: toNumber(firstTopup[0]?.first_topups),
    newcomerGifts: toNumber(firstTopup[0]?.gifted),
    refunds: refundRows.map((row) => ({ kind: String(row.order_kind), refunds: toNumber(row.refunds), amount: toNumber(row.amount_fen) / 100 })),
  };
}
