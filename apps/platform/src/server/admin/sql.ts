import "server-only";

/*
 * 运营分析共用的 SQL 片段。
 *
 * - 切日一律按北京时间：`timezone('Asia/Shanghai', ts)::date`，与数据库会话时区无关。
 * - 「活跃」= 窗口内产生过任何一种用户行为：埋点事件、创意照片、排版任务、短片、上传照片、日常记录、健康助手、趣测。
 *   只看 events 会漏掉不打点的链路（例如写真套餐的每一张、日常记录），所以并集取数。
 * - 现金收入只算真实收款：冻干充值单、其他增值单、实体单、冻干上线前的历史作品单。
 *   冻干消耗不是收入，不能重复计（与钱包后台口径一致）。
 */

export const localDay = (column: string) => `(timezone('Asia/Shanghai', ${column}))::date`;

/** 窗口 [$start, $end) 内的用户行为流水：(user_id, at) */
export function activitySql(start: string, end: string) {
  const where = (column = "created_at") => `${column} >= ${start} AND ${column} < ${end}`;
  return `
    SELECT user_id, created_at AS at FROM events WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM ai_runs WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM generation_tasks WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM video_renders WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM photos WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM pet_daily_logs WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM health_sessions WHERE ${where()}
    UNION ALL SELECT user_id, created_at FROM fun_test_results WHERE ${where()}`;
}

/** 全部已收款流水：(source, user_id, amount, at)。退款不在这里扣，单独统计。 */
export const PAID_SQL = `
  SELECT 'topup'::text AS source, user_id, amount::float8 AS amount, paid_at AS at, id, sku FROM growth_orders WHERE kind='wallet_topup' AND paid_at IS NOT NULL
  UNION ALL SELECT 'growth', user_id, amount::float8, paid_at, id, sku FROM growth_orders WHERE kind<>'wallet_topup' AND paid_at IS NOT NULL
  UNION ALL SELECT 'physical', user_id, amount::float8, paid_at, id, sku FROM physical_orders WHERE paid_at IS NOT NULL
  UNION ALL SELECT 'work', user_id, amount::float8, coalesce(paid_at, created_at), id, sku FROM orders WHERE status IN ('paid','completed','partially_refunded','refunded')`;

/** 已成功的退款：(user_id, amount, at)。2026-03 起全部走 payment_refunds；更早的作品单退款只在 refunds 里。 */
export const REFUND_SQL = `
  SELECT t.user_id, (r.amount_fen / 100.0)::float8 AS amount, coalesce(r.completed_at, r.created_at) AS at
    FROM payment_refunds r JOIN payment_transactions t ON t.id=r.payment_id WHERE r.status='succeeded'
  UNION ALL SELECT f.user_id, f.amount::float8, coalesce(f.completed_at, f.created_at) FROM refunds f
    WHERE f.status IN ('succeeded','completed') AND NOT EXISTS (SELECT 1 FROM payment_refunds p WHERE p.id=f.id)`;

export function escapeLike(value: string) {
  return value.replaceAll("\\", "\\\\").replaceAll("%", "\\%").replaceAll("_", "\\_");
}

export const toNumber = (value: unknown) => Number(value ?? 0) || 0;
