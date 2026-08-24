import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";
import { requestRefund } from "@/server/platform-service";

const querySchema = z.object({ from: z.string().date().optional(), to: z.string().date().optional(), pluginId: z.string().max(80).optional(), channel: z.string().max(80).optional(), format: z.enum(["json", "csv"]).default("json") });

async function report(query: z.infer<typeof querySchema>) {
  const database = await getDatabase();
  const params: unknown[] = [];
  const conditions = ["true"];
  if (query.from) { params.push(new Date(`${query.from}T00:00:00Z`)); conditions.push(`created_at >= $${params.length}`); }
  if (query.to) { params.push(new Date(`${query.to}T23:59:59Z`)); conditions.push(`created_at <= $${params.length}`); }
  if (query.pluginId) { params.push(query.pluginId); conditions.push(`plugin_id = $${params.length}`); }
  if (query.channel) { params.push(query.channel); conditions.push(`channel = $${params.length}`); }
  const where = conditions.join(" AND ");
  const [events, tasks, orders, shares, usage, aiRuns, aiCosts, aiCircuits] = await Promise.all([
    database.query(`SELECT name,plugin_id,coalesce(channel,'unknown') channel,count(*)::int count FROM events WHERE ${where} GROUP BY name,plugin_id,channel ORDER BY name`, params),
    database.query("SELECT id,user_id,plugin_id,status,attempt,error_code,created_at FROM generation_tasks ORDER BY (status='failed') DESC,created_at DESC LIMIT 200"),
    database.query("SELECT id,user_id,work_id,plugin_id,sku,amount,status,refunded_amount,created_at FROM orders ORDER BY created_at DESC LIMIT 50"),
    database.query("SELECT work_id,event_name,source,count(*)::int count,count(DISTINCT visitor_key)::int visitors FROM share_visits GROUP BY work_id,event_name,source ORDER BY event_name"),
    database.query("SELECT * FROM system_usage ORDER BY usage_date DESC LIMIT 30"),
    database.query("SELECT id,user_id,plugin_id,status,provider,model_version,attempt,retry_count,reroll_count,cost,error_code,work_id,order_id,created_at FROM ai_runs ORDER BY (status='failed') DESC,created_at DESC LIMIT 200"),
    database.query("SELECT l.id,l.run_id,l.provider,l.model_version,l.units,l.amount,l.status,l.created_at FROM ai_cost_ledger l ORDER BY l.created_at DESC LIMIT 100"),
    database.query("SELECT provider,failures,opened_at,manual_open,updated_at FROM ai_provider_circuits ORDER BY provider"),
  ]);
  return { events, tasks, orders, shares, usage, aiRuns, aiCosts, aiCircuits };
}

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const data = await report(query);
    if (query.format === "csv") {
      const rows = ["name,plugin_id,channel,count", ...data.events.map((item) => [item.name, item.plugin_id || "", item.channel, item.count].map((value) => `"${String(value).replaceAll('"', '""')}"`).join(","))];
      return new NextResponse(`\ufeff${rows.join("\n")}`, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": "attachment; filename=petbaby-funnel.csv" } });
    }
    return NextResponse.json({ data });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("retry_task"), taskId: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("refund_order"), orderId: z.string().uuid(), refundReason: z.enum(["generation_failed", "dissatisfied"]).default("generation_failed"), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("close_share"), workId: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("set_circuit"), open: z.boolean(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("retry_ai"), runId: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("cancel_ai"), runId: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.literal("set_ai_circuit"), provider: z.string().min(1).max(80), open: z.boolean(), reason: z.string().trim().min(2).max(200) }),
    ]).parse(await request.json());
    const database = await getDatabase();
    if (input.action === "retry_task") {
      const rows = await database.query("UPDATE generation_tasks SET status='queued',attempt=0,progress=8,error_code=NULL,available_at=now(),locked_at=NULL,updated_at=now() WHERE id=$1 AND status='failed' RETURNING id", [input.taskId]);
      if (!rows[0]) throw new AppError("TASK_NOT_RETRYABLE", "任务不存在或当前不可重试", 409);
    }
    if (input.action === "refund_order") {
      const rows = await database.query("SELECT user_id FROM orders WHERE id=$1", [input.orderId]);
      if (!rows[0]) throw new AppError("ORDER_NOT_FOUND", "订单不存在", 404);
      await requestRefund(String(rows[0].user_id), input.orderId, input.refundReason);
    }
    if (input.action === "close_share") await database.query("UPDATE works SET public=false,share_token=NULL,share_expires_at=NULL,share_access_code_hash=NULL WHERE id=$1", [input.workId]);
    if (input.action === "set_circuit") await database.query("INSERT INTO system_usage (usage_date,generation_count,estimated_cost,circuit_open,updated_at) VALUES ($1,0,0,$2,now()) ON CONFLICT (usage_date) DO UPDATE SET circuit_open=$2,updated_at=now()", [new Date().toISOString().slice(0, 10), input.open]);
    if (input.action === "retry_ai") {
      const rows = await database.query("UPDATE ai_runs SET status='queued',error_code=NULL,retry_count=retry_count+1,available_at=now(),locked_at=NULL WHERE id=$1 AND status='failed' RETURNING id", [input.runId]);
      if (!rows[0]) throw new AppError("AI_RUN_NOT_RETRYABLE", "AI 任务不存在或当前不可重试", 409);
    }
    if (input.action === "cancel_ai") {
      const rows = await database.query("UPDATE ai_runs SET status='cancelled',cancelled_at=now(),locked_at=NULL WHERE id=$1 AND status IN ('queued','processing') RETURNING id", [input.runId]);
      if (!rows[0]) throw new AppError("AI_RUN_NOT_CANCELLABLE", "AI 任务不存在或当前不可取消", 409);
    }
    if (input.action === "set_ai_circuit") await database.query("INSERT INTO ai_provider_circuits (provider,failures,opened_at,manual_open,updated_at) VALUES ($1,0,$2,$3,now()) ON CONFLICT (provider) DO UPDATE SET failures=CASE WHEN $3=false THEN 0 ELSE ai_provider_circuits.failures END,opened_at=$2,manual_open=$3,updated_at=now()", [input.provider, input.open ? new Date() : null, input.open]);
    const targetId = "taskId" in input ? input.taskId : "orderId" in input ? input.orderId : "workId" in input ? input.workId : "runId" in input ? input.runId : "provider" in input ? input.provider : "system";
    await database.query("INSERT INTO audit_logs (id,actor_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7)", [crypto.randomUUID(), actorId, `admin_${input.action}`, input.action.includes("order") ? "order" : input.action.includes("task") ? "task" : input.action.includes("share") ? "work" : "system", String(targetId), JSON.stringify(input), new Date()]);
    return NextResponse.json({ data: { completed: true } });
  } catch (error) { return routeError(error); }
}
