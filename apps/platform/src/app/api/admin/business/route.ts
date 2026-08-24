import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdminAudit } from "@/server/admin/audit";
import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { decryptAddress } from "@/server/commerce/address";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";
import { createAnnualReport } from "@/server/growth-service";

function maskAddress(ciphertext: unknown) {
  if (!ciphertext) return null;
  try {
    const address = decryptAddress(String(ciphertext));
    const phone = String(address.phone || "");
    const name = String(address.name || "");
    return {
      name: name ? `${name.slice(0, 1)}**` : "",
      phone: phone.length >= 7 ? `${phone.slice(0, 3)}****${phone.slice(-4)}` : "****",
      region: address.region || address.province || "",
      city: address.city || "",
      detail: address.detail ? `${String(address.detail).slice(0, 4)}***` : "",
    };
  } catch {
    return { invalid: true };
  }
}

async function ensureBusinessCatalogs() {
  const database = await getDatabase();
  const now = new Date();
  await database.query(
    `INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_at)
     VALUES ($1,'monthly','月度会员',29.9,'month',$2::jsonb,'inactive',1,$3)
     ON CONFLICT (code,version) DO NOTHING`,
    /*
     * 这条种子只为让后台的套餐表格有东西可看，**必须是 inactive**：
     * 原先它以 'active' 插入，而 `createMembership` 查的正是 status='active' ——
     * 于是一次后台访问就能把月度会员重新上架，抵消迁移 0020/0021 的下架动作。
     * 权益给空对象而不是 monthlyQuota：那一项已被判为负向卖点（D6）。
     */
    [crypto.randomUUID(), JSON.stringify({}), now],
  );
  await database.query(
    `INSERT INTO annual_report_templates (id,code,label,config,status,version,is_default,created_at)
     VALUES ($1,'wrapped','年度回忆录',$2::jsonb,'active',1,true,$3)
     ON CONFLICT (code,version) DO NOTHING`,
    [crypto.randomUUID(), JSON.stringify({ chapters: ["moments", "works", "interactions"] }), now],
  );
}

const businessQuerySchema = z.object({
  status: z.string().max(40).optional(),
  templateCode: z.string().max(80).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  section: z.enum(["all", "subscriptions", "physical", "memberships", "reports"]).default("all"),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "开始日期不能晚于结束日期" });

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    await ensureBusinessCatalogs();
    const database = await getDatabase();
    const query = businessQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const status = query.status || null;
    const templateCode = query.templateCode || null;
    const from = query.from ? new Date(`${query.from}T00:00:00Z`) : null;
    const to = query.to ? new Date(`${query.to}T23:59:59.999Z`) : null;
    const section = query.section;
    const page = query.page;
    const pageSize = query.pageSize;
    const offset = (page - 1) * pageSize;
    const [subscriptions, attempts, physicalRows, physicalEvents, memberships, ledger, plans, reports, reportVisits, reportTemplates, orders] = await Promise.all([
      section === "all" || section === "subscriptions" ? database.query("SELECT * FROM message_subscriptions WHERE ($1::text IS NULL OR status=$1) AND ($2::text IS NULL OR template_code=$2) AND ($3::timestamptz IS NULL OR created_at >= $3) AND ($4::timestamptz IS NULL OR created_at <= $4) ORDER BY created_at DESC LIMIT $5 OFFSET $6", [status, templateCode, from, to, pageSize, offset]) : [],
      database.query("SELECT * FROM message_delivery_attempts ORDER BY created_at DESC LIMIT 300"),
      section === "all" || section === "physical" ? database.query("SELECT * FROM physical_orders WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3", [status, pageSize, offset]) : [],
      database.query("SELECT * FROM physical_order_events ORDER BY created_at DESC LIMIT 500"),
      section === "all" || section === "memberships" ? database.query("SELECT * FROM memberships WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3", [status, pageSize, offset]) : [],
      database.query("SELECT * FROM entitlement_ledger ORDER BY created_at DESC LIMIT 300"),
      database.query("SELECT * FROM membership_plan_versions ORDER BY code,version DESC"),
      section === "all" || section === "reports" ? database.query("SELECT * FROM annual_reports WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3", [status, pageSize, offset]) : [],
      database.query("SELECT report_id,count(*)::int visits,coalesce(sum(duration_ms),0)::int duration_ms FROM annual_report_visits GROUP BY report_id"),
      database.query("SELECT * FROM annual_report_templates ORDER BY code,version DESC"),
      database.query("SELECT * FROM growth_orders WHERE ($1::text IS NULL OR status=$1) ORDER BY created_at DESC LIMIT $2 OFFSET $3", [status, pageSize, offset]),
    ]);
    const attemptsBySubscription = new Map<string, unknown[]>();
    for (const attempt of attempts) {
      const key = String(attempt.subscription_id);
      attemptsBySubscription.set(key, [...(attemptsBySubscription.get(key) || []), attempt].slice(0, 10));
    }
    const eventsByOrder = new Map<string, unknown[]>();
    for (const event of physicalEvents) {
      const key = String(event.order_id);
      eventsByOrder.set(key, [...(eventsByOrder.get(key) || []), event].slice(0, 20));
    }
    const ledgerByMembership = new Map<string, unknown[]>();
    for (const entry of ledger) {
      const key = String(entry.membership_id || "");
      ledgerByMembership.set(key, [...(ledgerByMembership.get(key) || []), entry].slice(0, 20));
    }
    const visitsByReport = new Map(reportVisits.map((item) => [String(item.report_id), item]));
    const physical = physicalRows.map((item) => ({ ...item, address: maskAddress(item.address_ciphertext), address_ciphertext: undefined, events: eventsByOrder.get(String(item.id)) || [] }));
    return NextResponse.json({ data: {
      page,
      pageSize,
      subscriptions: subscriptions.map((item) => ({ ...item, deliveryAttempts: attemptsBySubscription.get(String(item.id)) || [] })),
      physical,
      memberships: memberships.map((item) => ({ ...item, ledger: ledgerByMembership.get(String(item.id)) || [] })),
      plans,
      reports: reports.map((item) => ({ ...item, visits: visitsByReport.get(String(item.id)) || { visits: 0, duration_ms: 0 } })),
      reportTemplates,
      orders,
    } });
  } catch (error) {
    return routeError(error);
  }
}

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("retry_subscription"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("close_subscription"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
  /*
   * 建套餐收**权益本身**而不是 monthlyQuota。
   *
   * 原实现把 `{ monthlyQuota }` 当成整个权益 JSON 写进去，于是后台建出来的套餐
   * 一项可兑付权益都没有（monthlyQuota 在迁移 0020 已被判为负向卖点并移除），
   * 却是 status='active' 可售的 —— 与用户侧 M2 修掉的是同一个缺陷：卖没有兑付的东西。
   *
   * 只收**已实现兑付**的权益 —— 后台能勾就等于能卖，
   * 而卖一项没有兑付代码的权益是收钱不给东西。
   *
   * 健康两项在第三批（L1/L2）实施后放开：
   * `healthExportUnlimited` → createHealthDocument 的 archive 路径，
   * `annualHealthReport` → 同一函数的 annual 路径（走 claimEntitlement 按次核销）。
   */
  z.object({
    action: z.literal("create_plan"),
    code: z.string().trim().min(1).max(80),
    label: z.string().trim().min(1).max(80),
    amount: z.number().nonnegative(),
    period: z.enum(["month", "year"]),
    entitlements: z.object({
      tierUnlock: z.boolean().optional(),
      healthExportUnlimited: z.boolean().optional(),
      annualHealthReport: z.number().int().min(0).max(12).optional(),
      annualReport: z.number().int().min(0).max(12).optional(),
      // 折扣率直接乘在钱上，上下界必须在入口挡住：一个手误的 0 会让实体订单变 0 元。
      physicalDiscount: z.number().min(0.1).max(1).optional(),
    }).default({}),
    status: z.enum(["active", "paused"]),
    reason: z.string().trim().min(2).max(200),
  }),
  z.object({ action: z.literal("adjust_entitlement"), membershipId: z.string().uuid(), units: z.number().int().refine((value) => value !== 0), reason: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("create_report_template"), code: z.string().trim().min(1).max(80), label: z.string().trim().min(1).max(80), config: z.record(z.string(), z.unknown()), status: z.enum(["active", "paused"]), isDefault: z.boolean(), reason: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("retry_report"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
  z.object({ action: z.literal("refund_growth_order"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
]);

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = actionSchema.parse(await request.json());
    const database = await getDatabase();
    if (input.action === "retry_subscription") {
      const before = (await database.query("SELECT * FROM message_subscriptions WHERE id=$1", [input.id]))[0];
      const rows = await database.query("UPDATE message_subscriptions SET status='scheduled',scheduled_at=now(),last_error=NULL,admin_closed_at=NULL,admin_closed_by=NULL,admin_closed_reason=NULL WHERE id=$1 AND status='failed' RETURNING *", [input.id]);
      if (!rows[0]) throw new AppError("SUBSCRIPTION_NOT_RETRYABLE", "订阅任务当前不可重试", 409);
      await recordAdminAudit({ actorId, action: input.action, targetType: "subscription", targetId: input.id, reason: input.reason, before, after: rows[0], userId: String(rows[0].user_id) });
      return NextResponse.json({ data: rows[0] });
    }
    if (input.action === "close_subscription") {
      const before = (await database.query("SELECT * FROM message_subscriptions WHERE id=$1", [input.id]))[0];
      const rows = await database.query("UPDATE message_subscriptions SET status='closed',admin_closed_at=now(),admin_closed_by=$2,admin_closed_reason=$3 WHERE id=$1 AND status NOT IN ('sent','unsubscribed','closed') RETURNING *", [input.id, actorId, input.reason]);
      if (!rows[0]) throw new AppError("SUBSCRIPTION_NOT_CLOSABLE", "订阅任务当前不可关闭", 409);
      await recordAdminAudit({ actorId, action: input.action, targetType: "subscription", targetId: input.id, reason: input.reason, before, after: rows[0], userId: String(rows[0].user_id) });
      return NextResponse.json({ data: rows[0] });
    }
    if (input.action === "create_plan") {
      const versions = await database.query("SELECT coalesce(max(version),0)+1 version FROM membership_plan_versions WHERE code=$1", [input.code]);
      const rows = await database.query("INSERT INTO membership_plan_versions (id,code,label,amount,period,entitlements,status,version,created_by,created_at) VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8,$9,$10) RETURNING *", [crypto.randomUUID(), input.code, input.label, input.amount, input.period, JSON.stringify(input.entitlements), input.status, Number(versions[0]?.version || 1), actorId, new Date()]);
      await recordAdminAudit({ actorId, action: input.action, targetType: "membership_plan", targetId: String(rows[0].id), reason: input.reason, after: rows[0] });
      return NextResponse.json({ data: rows[0] }, { status: 201 });
    }
    if (input.action === "adjust_entitlement") {
      const before = (await database.query("SELECT * FROM memberships WHERE id=$1", [input.membershipId]))[0];
      if (!before) throw new AppError("MEMBERSHIP_NOT_FOUND", "会员不存在", 404);
      const rows = await database.query("UPDATE memberships SET quota=greatest(used,quota+$2),status_updated_at=now() WHERE id=$1 RETURNING *", [input.membershipId, input.units]);
      const adjustmentId = crypto.randomUUID();
      await database.query("INSERT INTO entitlement_adjustments (id,user_id,membership_id,actor_id,units,reason,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [adjustmentId, before.user_id, input.membershipId, actorId, input.units, input.reason, new Date()]);
      await database.query("INSERT INTO entitlement_ledger (id,user_id,membership_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,'manual_adjustment',$4,'adjusted',$5,$6)", [crypto.randomUUID(), before.user_id, input.membershipId, input.units, input.reason, new Date()]);
      await recordAdminAudit({ actorId, action: input.action, targetType: "membership", targetId: input.membershipId, reason: input.reason, before, after: rows[0], userId: String(before.user_id) });
      return NextResponse.json({ data: rows[0] });
    }
    if (input.action === "create_report_template") {
      if (input.isDefault) await database.query("UPDATE annual_report_templates SET is_default=false WHERE is_default=true", []);
      const versions = await database.query("SELECT coalesce(max(version),0)+1 version FROM annual_report_templates WHERE code=$1", [input.code]);
      const rows = await database.query("INSERT INTO annual_report_templates (id,code,label,config,status,version,is_default,created_by,created_at) VALUES ($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9) RETURNING *", [crypto.randomUUID(), input.code, input.label, JSON.stringify(input.config), input.status, Number(versions[0]?.version || 1), input.isDefault, actorId, new Date()]);
      await recordAdminAudit({ actorId, action: input.action, targetType: "annual_report_template", targetId: String(rows[0].id), reason: input.reason, after: rows[0] });
      return NextResponse.json({ data: rows[0] }, { status: 201 });
    }
    if (input.action === "retry_report") {
      const report = (await database.query("SELECT * FROM annual_reports WHERE id=$1 AND status='failed'", [input.id]))[0];
      if (!report) throw new AppError("REPORT_NOT_RETRYABLE", "年度报告当前不可重试", 409);
      const result = await createAnnualReport(String(report.user_id), Number(report.year));
      await recordAdminAudit({ actorId, action: input.action, targetType: "annual_report", targetId: input.id, reason: input.reason, before: report, after: result, userId: String(report.user_id) });
      return NextResponse.json({ data: result });
    }
    const order = (await database.query("SELECT * FROM growth_orders WHERE id=$1", [input.id]))[0];
    if (!order || order.status !== "paid") throw new AppError("GROWTH_ORDER_NOT_REFUNDABLE", "权益订单当前不可退款", 409);
    const rows = await database.query("UPDATE growth_orders SET status='refunded',refunded_at=now(),updated_at=now() WHERE id=$1 RETURNING *", [input.id]);
    if (order.kind === "membership") await database.query("UPDATE memberships SET status='expired',quota=0,used=0,status_updated_at=now() WHERE id=$1", [order.resource_id]);
    if (order.kind === "annual_report") await database.query("UPDATE annual_reports SET locked=true,share_token=NULL,revoked_at=now() WHERE id=$1", [order.resource_id]);
    await recordAdminAudit({ actorId, action: input.action, targetType: "growth_order", targetId: input.id, reason: input.reason, before: order, after: rows[0], userId: String(order.user_id) });
    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    return routeError(error);
  }
}
