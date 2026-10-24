import "server-only";

import { getDatabase } from "@/server/db/client";
import { getWallet } from "@/server/wallet/service";
import { decryptAddress } from "@/server/commerce/address";
import { pluginName } from "./analytics";
import { escapeLike, PAID_SQL, toNumber } from "./sql";

/*
 * 运营后台的列表与详情查询（用户、订单、任务、消息、履约、审计）。
 * 写操作仍走既有的 /api/admin/* 接口（守卫、校验、审计都在那里），这里只读。
 */

export const PAGE_SIZE = 20;

export type Page<T> = { items: T[]; total: number; page: number; pageSize: number };

function paging(page: number | undefined, pageSize = PAGE_SIZE) {
  const current = Math.max(1, Math.floor(page || 1));
  return { page: current, pageSize, offset: (current - 1) * pageSize };
}

function pattern(q?: string) {
  const value = q?.trim();
  return value ? `%${escapeLike(value)}%` : null;
}

/* ------------------------------------------------------------------ 用户 */

export type UserFilter = { q?: string; status?: "all" | "active" | "suspended" | "deleted"; segment?: "all" | "paying" | "holders" | "new7"; page?: number };

export async function listUsers(filter: UserFilter): Promise<Page<Record<string, unknown>>> {
  const database = await getDatabase();
  const { page, pageSize, offset } = paging(filter.page);
  const rows = await database.query(
    `WITH paid AS (SELECT user_id, count(*)::int orders, sum(amount)::float8 amount, max(at) last_paid FROM (${PAID_SQL}) p GROUP BY user_id)
     SELECT u.id, u.display_name, u.account_name, u.created_at, u.deleted_at, u.admin_suspended_at, u.admin_suspension_reason,
       (u.wechat_unionid IS NOT NULL) wechat,
       (SELECT count(*)::int FROM pets p WHERE p.user_id=u.id AND p.deleted_at IS NULL) pets,
       (SELECT count(*)::int FROM works w WHERE w.user_id=u.id AND w.deleted_at IS NULL) works,
       coalesce(a.balance,0)::int balance,
       coalesce(paid.orders,0)::int orders, coalesce(paid.amount,0)::float8 revenue, paid.last_paid,
       greatest(
         (SELECT max(created_at) FROM events e WHERE e.user_id=u.id),
         (SELECT max(created_at) FROM ai_runs r WHERE r.user_id=u.id),
         (SELECT max(created_at) FROM photos ph WHERE ph.user_id=u.id)
       ) last_active,
       count(*) OVER()::int total
     FROM users u
     LEFT JOIN wallet_accounts a ON a.user_id=u.id
     LEFT JOIN paid ON paid.user_id=u.id
     WHERE ($1::text IS NULL OR u.id::text ILIKE $1 OR coalesce(u.display_name,'') ILIKE $1 OR coalesce(u.account_name,'') ILIKE $1
            OR coalesce(u.wechat_unionid,'') ILIKE $1 OR coalesce(u.wechat_openid,'') ILIKE $1)
       AND ($2='all'
         OR ($2='active' AND u.deleted_at IS NULL AND u.admin_suspended_at IS NULL)
         OR ($2='suspended' AND u.deleted_at IS NULL AND u.admin_suspended_at IS NOT NULL)
         OR ($2='deleted' AND u.deleted_at IS NOT NULL))
       AND ($3='all'
         OR ($3='paying' AND paid.user_id IS NOT NULL)
         OR ($3='holders' AND coalesce(a.balance,0) > 0)
         OR ($3='new7' AND u.created_at >= now()-interval '7 days'))
     ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
    [pattern(filter.q), filter.status || "all", filter.segment || "all", pageSize, offset],
  );
  return { items: rows, total: toNumber(rows[0]?.total), page, pageSize };
}

export async function getUserDetail(userId: string) {
  const database = await getDatabase();
  const [user] = await database.query(
    `SELECT id, display_name, account_name, created_at, deleted_at, admin_suspended_at, admin_suspended_by, admin_suspension_reason,
       wechat_unionid IS NOT NULL wechat, password_hash IS NOT NULL password,
       acquisition_channel, acquisition_src, acquisition_scene, invited_by,
       (SELECT count(*)::int FROM users i WHERE i.invited_by=users.id) invited_count FROM users WHERE id=$1`,
    [userId],
  );
  if (!user) return null;
  const [wallet, pets, works, payments, ledger, lots, creations, audit, stats] = await Promise.all([
    getWallet(userId),
    database.query(
      `SELECT p.id, p.name, p.species, p.life_stage, p.birthday, p.created_at, p.deleted_at,
         (SELECT count(*)::int FROM photos ph WHERE ph.pet_id=p.id AND ph.deleted_at IS NULL) photos,
         (SELECT count(*)::int FROM pet_daily_logs l WHERE l.pet_id=p.id) logs
       FROM pets p WHERE p.user_id=$1 ORDER BY p.created_at`,
      [userId],
    ),
    database.query("SELECT id, plugin_id, title, locked, public, created_at FROM works WHERE user_id=$1 AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 12", [userId]),
    database.query(
      `SELECT t.id, t.order_kind, t.order_id, t.sku, t.amount_fen, t.provider, t.status, t.refunded_fen, t.created_at,
         g.kind growth_kind, g.paid_at
       FROM payment_transactions t LEFT JOIN growth_orders g ON t.order_kind='growth' AND g.id=t.order_id
       WHERE t.user_id=$1 ORDER BY t.created_at DESC LIMIT 20`,
      [userId],
    ),
    database.query("SELECT id, title, reason, delta, balance_after, ref_type, created_at FROM wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 30", [userId]),
    database.query("SELECT id, pocket, source, units, remaining, status, expires_at, created_at FROM wallet_lots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]),
    database.query(
      `SELECT * FROM (
         SELECT id, 'image' kind, plugin_id, coalesce(options->>'templateId','') detail, status, error_code, created_at FROM ai_runs WHERE user_id=$1
         UNION ALL SELECT id, 'layout', plugin_id, '', status, error_code, created_at FROM generation_tasks WHERE user_id=$1
         UNION ALL SELECT id, 'video', plugin_id, coalesce(config->>'kind',''), status, error_code, created_at FROM video_renders WHERE user_id=$1
       ) x ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ),
    database.query("SELECT id, actor_id, action, target_type, metadata->>'reason' reason, created_at FROM audit_logs WHERE user_id=$1 OR (target_type IN ('user','wallet') AND target_id=$2) ORDER BY created_at DESC LIMIT 20", [userId, userId]),
    database.query(
      `SELECT (SELECT count(*)::int FROM photos WHERE user_id=$1 AND deleted_at IS NULL) photos,
         (SELECT count(*)::int FROM ai_runs WHERE user_id=$1) ai_runs,
         (SELECT count(*)::int FROM generation_tasks WHERE user_id=$1) tasks,
         (SELECT count(*)::int FROM video_renders WHERE user_id=$1) videos,
         (SELECT count(*)::int FROM health_sessions WHERE user_id=$1) health,
         (SELECT count(*)::int FROM pet_daily_logs WHERE user_id=$1) logs,
         (SELECT coalesce(sum(amount),0)::float8 FROM (${PAID_SQL}) p WHERE p.user_id=$1) revenue,
         (SELECT coalesce(-sum(delta),0)::int FROM wallet_ledger WHERE user_id=$1 AND reason='spend') spent`,
      [userId],
    ),
  ]);
  return { user, wallet, pets, works: works.map((work): Record<string, unknown> => ({ ...work, plugin_name: pluginName(work.plugin_id) })), payments, ledger, lots, creations, audit, stats: stats[0] || {} };
}

/* ------------------------------------------------------------------ 订单 */

export type OrderFilter = { q?: string; kind?: string; status?: string; page?: number };

/** 统一以支付流水为主表：每一笔真实收款（或待支付）都在 payment_transactions 里有且仅有一行。 */
export async function listPayments(filter: OrderFilter): Promise<Page<Record<string, unknown>>> {
  const database = await getDatabase();
  const { page, pageSize, offset } = paging(filter.page);
  const rows = await database.query(
    `SELECT t.id, t.user_id, u.display_name, t.order_kind, t.order_id, t.sku, t.amount_fen, t.provider, t.status, t.refunded_fen,
       t.out_trade_no, t.created_at, t.updated_at, g.kind growth_kind, g.status growth_status,
       (SELECT r.status FROM payment_refunds r WHERE r.payment_id=t.id ORDER BY r.created_at DESC LIMIT 1) refund_status,
       count(*) OVER()::int total
     FROM payment_transactions t
     LEFT JOIN users u ON u.id=t.user_id
     LEFT JOIN growth_orders g ON t.order_kind='growth' AND g.id=t.order_id
     WHERE ($1::text IS NULL OR t.out_trade_no ILIKE $1 OR t.user_id::text ILIKE $1 OR t.order_id::text ILIKE $1 OR t.sku ILIKE $1 OR coalesce(u.display_name,'') ILIKE $1)
       AND ($2::text IS NULL OR t.order_kind=$2 OR g.kind=$2)
       AND ($3::text IS NULL OR t.status=$3)
     ORDER BY t.created_at DESC LIMIT $4 OFFSET $5`,
    [pattern(filter.q), filter.kind || null, filter.status || null, pageSize, offset],
  );
  return { items: rows, total: toNumber(rows[0]?.total), page, pageSize };
}

export async function paymentSummary() {
  const database = await getDatabase();
  const [row] = await database.query(
    `SELECT count(*) FILTER (WHERE status='paid')::int paid, count(*) FILTER (WHERE status='pending')::int pending,
       count(*) FILTER (WHERE status='refunded')::int refunded, count(*) FILTER (WHERE status='closed')::int closed,
       (SELECT count(*)::int FROM payment_refunds WHERE status IN ('pending','processing')) refunding,
       count(*) FILTER (WHERE status='pending' AND created_at < now()-interval '30 minutes')::int stale_pending
     FROM payment_transactions`,
  );
  return row || {};
}

export async function listPhysicalOrders(status?: string) {
  const database = await getDatabase();
  const rows = await database.query(
    `SELECT o.*, u.display_name,
       (SELECT coalesce(json_agg(e ORDER BY e.created_at DESC), '[]'::json) FROM (SELECT from_status, to_status, note, created_at FROM physical_order_events WHERE order_id=o.id ORDER BY created_at DESC LIMIT 6) e) events
     FROM physical_orders o LEFT JOIN users u ON u.id=o.user_id
     WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.created_at DESC LIMIT 60`,
    [status || null],
  );
  return rows.map((row): Record<string, unknown> => ({ ...row, address: maskAddress(row.address_ciphertext), address_ciphertext: undefined, events: typeof row.events === "string" ? JSON.parse(row.events) : row.events }));
}

function maskAddress(ciphertext: unknown) {
  if (!ciphertext) return null;
  try {
    const address = decryptAddress(String(ciphertext));
    const phone = String(address.phone || "");
    const name = String(address.name || "");
    return {
      name: name ? `${name.slice(0, 1)}**` : "",
      phone: phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "****",
      region: `${address.region || address.province || ""} ${address.city || ""}`.trim(),
      detail: address.detail ? `${String(address.detail).slice(0, 4)}***` : "",
    };
  } catch {
    return { invalid: true };
  }
}

/* ------------------------------------------------------------------ 任务 */

export type TaskKind = "image" | "layout" | "video";
export type TaskFilter = { kind?: TaskKind; status?: string; q?: string; page?: number };

export async function listTasks(filter: TaskFilter): Promise<Page<Record<string, unknown>>> {
  const database = await getDatabase();
  const { page, pageSize, offset } = paging(filter.page);
  const kind = filter.kind || "image";
  const source = {
    image: "SELECT id, user_id, plugin_id, coalesce(options->>'templateId', role_inputs->>'templateId','') detail, status, error_code, provider, attempt, retry_count, created_at, locked_at, (options ? 'artPhotoBatchId') in_bundle FROM ai_runs",
    layout: "SELECT id, user_id, plugin_id, '' detail, status, error_code, NULL provider, attempt, 0 retry_count, created_at, locked_at, false in_bundle FROM generation_tasks",
    video: "SELECT id, user_id, plugin_id, coalesce(config->>'kind','memory') detail, status, error_code, NULL provider, attempt, 0 retry_count, created_at, locked_at, false in_bundle FROM video_renders",
  }[kind];
  const rows = await database.query(
    `SELECT t.*, u.display_name, count(*) OVER()::int total FROM (${source}) t LEFT JOIN users u ON u.id=t.user_id
     WHERE ($1::text IS NULL OR t.status=$1)
       AND ($2::text IS NULL OR t.id::text ILIKE $2 OR t.user_id::text ILIKE $2 OR coalesce(t.error_code,'') ILIKE $2 OR t.detail ILIKE $2)
     ORDER BY (t.status='failed') DESC, t.created_at DESC LIMIT $3 OFFSET $4`,
    [filter.status || null, pattern(filter.q), pageSize, offset],
  );
  return { items: rows.map((row): Record<string, unknown> => ({ ...row, plugin_name: pluginName(row.plugin_id) })), total: toNumber(rows[0]?.total), page, pageSize };
}

export async function taskHealth() {
  const database = await getDatabase();
  const [counts, circuits, usage, cost] = await Promise.all([
    database.query(
      `SELECT kind, status, count(*)::int n FROM (
         SELECT 'image' kind, status FROM ai_runs WHERE created_at >= now()-interval '24 hours' OR status IN ('queued','processing')
         UNION ALL SELECT 'layout', status FROM generation_tasks WHERE created_at >= now()-interval '24 hours' OR status IN ('queued','processing')
         UNION ALL SELECT 'video', status FROM video_renders WHERE created_at >= now()-interval '24 hours' OR status IN ('queued','processing')
       ) x GROUP BY 1,2`,
    ),
    database.query("SELECT provider, failures, opened_at, manual_open, updated_at FROM ai_provider_circuits ORDER BY provider"),
    database.query("SELECT usage_date, generation_count, estimated_cost::float8 estimated_cost, circuit_open FROM system_usage ORDER BY usage_date DESC LIMIT 7"),
    database.query(
      `SELECT provider, model_version, count(*)::int calls, coalesce(sum(amount),0)::float8 amount,
         count(*) FILTER (WHERE status<>'succeeded')::int failures
       FROM ai_cost_ledger WHERE created_at >= now()-interval '7 days' GROUP BY 1,2 ORDER BY amount DESC`,
    ),
  ]);
  const byKind: Record<string, Record<string, number>> = { image: {}, layout: {}, video: {} };
  for (const row of counts) byKind[String(row.kind)][String(row.status)] = toNumber(row.n);
  return {
    byKind,
    circuits,
    usage,
    cost,
    dailyLimit: Number(process.env.DAILY_GENERATION_LIMIT || 500),
    costLimit: Number(process.env.DAILY_COST_LIMIT || 50),
  };
}

/* ------------------------------------------------------------------ 消息与年度报告 */

export async function listSubscriptions(status?: string) {
  const database = await getDatabase();
  const [items, stats] = await Promise.all([
    database.query(
      `SELECT s.id, s.user_id, s.event_type, s.template_code, s.status, s.attempts, s.scheduled_at, s.sent_at, s.last_error, s.created_at
       FROM message_subscriptions s WHERE ($1::text IS NULL OR s.status=$1) ORDER BY (s.status='failed') DESC, s.created_at DESC LIMIT 60`,
      [status || null],
    ),
    database.query("SELECT status, count(*)::int n FROM message_subscriptions GROUP BY status"),
  ]);
  return { items, stats: Object.fromEntries(stats.map((row) => [String(row.status), toNumber(row.n)])) };
}

export async function listAnnualReports() {
  const database = await getDatabase();
  const [reports, templates] = await Promise.all([
    database.query(
      `SELECT r.id, r.user_id, r.year, r.status, r.locked, r.template_version, r.created_at,
         (SELECT count(*)::int FROM annual_report_visits v WHERE v.report_id=r.id) visits
       FROM annual_reports r ORDER BY (r.status='failed') DESC, r.created_at DESC LIMIT 40`,
    ),
    database.query("SELECT id, code, label, version, status, is_default, created_at FROM annual_report_templates ORDER BY code, version DESC LIMIT 20"),
  ]);
  return { reports, templates };
}

/* ------------------------------------------------------------------ 审计 */

export type AuditFilter = { q?: string; targetType?: string; page?: number };

export async function listAudit(filter: AuditFilter): Promise<Page<Record<string, unknown>>> {
  const database = await getDatabase();
  const { page, pageSize, offset } = paging(filter.page, 30);
  const rows = await database.query(
    `SELECT a.id, a.user_id, a.actor_id, actor.display_name actor_name, a.action, a.target_type, a.target_id, a.metadata, a.created_at, count(*) OVER()::int total
     FROM audit_logs a LEFT JOIN users actor ON actor.id=a.actor_id
     WHERE ($1::text IS NULL OR a.action ILIKE $1 OR coalesce(a.target_id,'') ILIKE $1 OR coalesce(a.metadata->>'reason','') ILIKE $1)
       AND ($2::text IS NULL OR a.target_type=$2)
     ORDER BY a.created_at DESC LIMIT $3 OFFSET $4`,
    [pattern(filter.q), filter.targetType || null, pageSize, offset],
  );
  return { items: rows, total: toNumber(rows[0]?.total), page, pageSize };
}

export async function auditTargetTypes() {
  const rows = await (await getDatabase()).query("SELECT DISTINCT target_type FROM audit_logs ORDER BY target_type");
  return rows.map((row) => String(row.target_type));
}

/* ------------------------------------------------------------------ 全局搜索 */

/** 顶栏搜索：按用户、订单号、任务 ID 模糊查，各取前几条。 */
export async function globalSearch(q: string) {
  const value = q.trim();
  if (value.length < 2) return { users: [], payments: [] };
  const database = await getDatabase();
  const like = `%${escapeLike(value)}%`;
  const [users, payments] = await Promise.all([
    database.query(
      `SELECT id, display_name, account_name, created_at FROM users
       WHERE id::text ILIKE $1 OR coalesce(display_name,'') ILIKE $1 OR coalesce(account_name,'') ILIKE $1 OR coalesce(wechat_unionid,'') ILIKE $1 OR coalesce(wechat_openid,'') ILIKE $1
       ORDER BY created_at DESC LIMIT 6`,
      [like],
    ),
    database.query("SELECT id, user_id, sku, amount_fen, status, out_trade_no, created_at FROM payment_transactions WHERE out_trade_no ILIKE $1 OR order_id::text ILIKE $1 ORDER BY created_at DESC LIMIT 6", [like]),
  ]);
  return { users, payments };
}
