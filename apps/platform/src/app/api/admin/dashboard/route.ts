import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError } from "@/server/errors";

const querySchema = z.object({
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "开始日期不能晚于结束日期" });

function dateWindow(query: z.infer<typeof querySchema>) {
  const end = query.to ? new Date(`${query.to}T23:59:59.999Z`) : new Date();
  const start = query.from
    ? new Date(`${query.from}T00:00:00.000Z`)
    : new Date(end.getTime() - 29 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const { start, end } = dateWindow(query);
    const database = await getDatabase();
    const params = [start, end];
    const [summaryRows, daily, plugins, queue, audit] = await Promise.all([
      database.query(
        `SELECT
          (SELECT count(*)::int FROM users WHERE created_at >= $1 AND created_at <= $2) new_users,
          (SELECT count(DISTINCT user_id)::int FROM events WHERE created_at >= $1 AND created_at <= $2) active_users,
          (SELECT count(*)::int FROM generation_tasks WHERE created_at >= $1 AND created_at <= $2) generations,
          (SELECT count(*)::int FROM generation_tasks WHERE status='succeeded' AND created_at >= $1 AND created_at <= $2) succeeded_generations,
          (SELECT count(*)::int FROM generation_tasks WHERE status='failed' AND created_at >= $1 AND created_at <= $2) failed_generations,
          ((SELECT count(*) FROM orders WHERE status IN ('paid','completed','partially_refunded','refunded') AND created_at >= $1 AND created_at <= $2)
            +(SELECT count(*) FROM physical_orders WHERE paid_at >= $1 AND paid_at <= $2)
            +(SELECT count(*) FROM growth_orders WHERE paid_at >= $1 AND paid_at <= $2))::int paid_orders,
          ((SELECT coalesce(sum(amount),0) FROM orders WHERE status IN ('paid','completed','partially_refunded','refunded') AND created_at >= $1 AND created_at <= $2)
            +(SELECT coalesce(sum(amount),0) FROM physical_orders WHERE paid_at >= $1 AND paid_at <= $2)
            +(SELECT coalesce(sum(amount),0) FROM growth_orders WHERE paid_at >= $1 AND paid_at <= $2))::numeric revenue,
          ((SELECT coalesce(sum(refunded_amount),0) FROM orders WHERE created_at >= $1 AND created_at <= $2)
            +(SELECT coalesce(sum(amount),0) FROM physical_orders WHERE refunded_at >= $1 AND refunded_at <= $2)
            +(SELECT coalesce(sum(amount),0) FROM growth_orders WHERE refunded_at >= $1 AND refunded_at <= $2))::numeric refunds,
          (SELECT coalesce(sum(amount),0)::numeric FROM orders WHERE status IN ('paid','completed','partially_refunded','refunded') AND created_at >= $1 AND created_at <= $2) standard_revenue,
          (SELECT coalesce(sum(amount),0)::numeric FROM physical_orders WHERE paid_at >= $1 AND paid_at <= $2) physical_revenue,
          (SELECT coalesce(sum(amount),0)::numeric FROM growth_orders WHERE paid_at >= $1 AND paid_at <= $2) growth_revenue,
          (SELECT count(*)::int FROM works WHERE public=true AND created_at >= $1 AND created_at <= $2) public_works,
          (SELECT count(*)::int FROM share_visits WHERE created_at >= $1 AND created_at <= $2) share_visits`,
        params,
      ),
      database.query(
        `SELECT series_day::date::text metric_date,
          coalesce(events,0)::int events,
          coalesce(generations,0)::int generations,
          coalesce(succeeded,0)::int succeeded,
          coalesce(paid_orders,0)::int paid_orders,
          coalesce(revenue,0)::numeric revenue
        FROM generate_series($1::date, $2::date, interval '1 day') AS calendar(series_day)
        LEFT JOIN (SELECT created_at::date metric_day, count(*) events FROM events WHERE created_at >= $1 AND created_at <= $2 GROUP BY created_at::date) e ON e.metric_day = series_day::date
        LEFT JOIN (SELECT created_at::date metric_day, count(*) generations FROM generation_tasks WHERE created_at >= $1 AND created_at <= $2 GROUP BY created_at::date) g ON g.metric_day = series_day::date
        LEFT JOIN (SELECT created_at::date metric_day, count(*) succeeded FROM generation_tasks WHERE status='succeeded' AND created_at >= $1 AND created_at <= $2 GROUP BY created_at::date) s ON s.metric_day = series_day::date
        LEFT JOIN (
          SELECT metric_day,count(*) paid_orders,sum(amount) revenue FROM (
            SELECT created_at::date metric_day,amount FROM orders WHERE status IN ('paid','completed','partially_refunded','refunded') AND created_at >= $1 AND created_at <= $2
            UNION ALL SELECT paid_at::date,amount FROM physical_orders WHERE paid_at >= $1 AND paid_at <= $2
            UNION ALL SELECT paid_at::date,amount FROM growth_orders WHERE paid_at >= $1 AND paid_at <= $2
          ) paid GROUP BY metric_day
        ) o ON o.metric_day = series_day::date
        ORDER BY series_day`,
        params,
      ),
      database.query(
        `SELECT plugin_id,
          count(*)::int generations,
          count(*) FILTER (WHERE status='succeeded')::int succeeded,
          count(*) FILTER (WHERE status='failed')::int failed
        FROM generation_tasks WHERE created_at >= $1 AND created_at <= $2
        GROUP BY plugin_id ORDER BY generations DESC LIMIT 12`,
        params,
      ),
      database.query(
        `SELECT
          (SELECT count(*)::int FROM generation_tasks WHERE status='failed') failed_tasks,
          (SELECT count(*)::int FROM generation_tasks WHERE status IN ('queued','processing')) active_tasks,
          (SELECT count(*)::int FROM video_renders WHERE status='failed') failed_videos,
          (SELECT count(*)::int FROM message_subscriptions WHERE status='failed') failed_messages,
          (SELECT count(*)::int FROM physical_orders WHERE status IN ('paid','producing','shipped','after_sale')) pending_physical_orders,
          (SELECT count(*)::int FROM refunds WHERE status IN ('pending','processing')) pending_refunds`,
      ),
      database.query(
        `SELECT id, action, target_type, target_id, actor_id, created_at
         FROM audit_logs ORDER BY created_at DESC LIMIT 12`,
      ),
    ]);
    const summary = summaryRows[0] || {};
    return NextResponse.json({ data: { window: { from: start.toISOString(), to: end.toISOString() }, summary, daily, plugins, queue: queue[0] || {}, audit } });
  } catch (error) {
    return routeError(error);
  }
}
