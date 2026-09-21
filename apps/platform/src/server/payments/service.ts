import "server-only";
import { z } from "zod";
import { getDatabase, inTransaction, type Database, type SqlRow } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { isRealProduction } from "@/server/runtime-mode";
import { selectPaymentChannel, virtualEnvironment, virtualProduct } from "./config";
import { paymentProviderFor } from "./provider";
import type { OrderKind, Payment, PaymentConfirmation, PaymentRefund } from "./types";

const orderTables = { work: "orders", growth: "growth_orders", physical: "physical_orders" } as const;

async function sourceOrder(database: Database, kind: OrderKind, orderId: string, userId: string, lock = false) {
  z.string().uuid().parse(orderId);
  const rows = await database.query(`SELECT * FROM ${orderTables[kind]} WHERE id=$1 AND user_id=$2${lock ? " FOR UPDATE" : ""}`, [orderId, userId]);
  if (!rows[0]) throw new AppError("ORDER_NOT_FOUND", "订单不存在", 404);
  return rows[0];
}

export async function ensurePayment(userId: string, kind: OrderKind, orderId: string): Promise<Payment> {
  return inTransaction(async (database) => {
    const order = await sourceOrder(database, kind, orderId, userId, true);
    const existing = await database.query<Payment>("SELECT * FROM payment_transactions WHERE order_kind=$1 AND order_id=$2", [kind, orderId]);
    if (existing[0]) return existing[0];
    if (order.status !== "pending") throw new AppError("ORDER_NOT_PAYABLE", "当前订单不能创建支付，请联系客服核对历史订单", 409);
    const amountFen = Math.round(Number(order.amount) * 100);
    if (!Number.isSafeInteger(amountFen) || amountFen < 100) throw new AppError("ORDER_AMOUNT_INVALID", "订单金额不符合支付要求", 422);
    const sku = String(order.sku);
    const provider = selectPaymentChannel(kind, sku);
    const users = await database.query("SELECT wechat_openid FROM users WHERE id=$1", [userId]);
    const openid = users[0]?.wechat_openid || null;
    if (provider !== "development" && !openid) throw new AppError("WECHAT_OPENID_REQUIRED", "请在小程序登录后支付", 422);
    const productId = provider === "virtual" ? virtualProduct(sku, amountFen) : null;
    const environment = provider === "virtual" ? virtualEnvironment() : 0;
    const id = crypto.randomUUID();
    return (await database.query<Payment>(
      "INSERT INTO payment_transactions (id,user_id,order_id,order_kind,sku,amount_fen,provider,out_trade_no,openid,product_id,environment) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *",
      [id, userId, orderId, kind, sku, amountFen, provider, id.replaceAll("-", ""), openid, productId, environment],
    ))[0];
  });
}

export async function prepareOrderPayment(userId: string, kind: OrderKind, orderId: string, client: "miniprogram" | "web") {
  if (client === "web" && (isRealProduction() || process.env.PAYMENT_PROVIDER !== "development" && process.env.PAYMENT_PROVIDER)) {
    throw new AppError("MINIPROGRAM_PAYMENT_REQUIRED", "本页面暂不支持付款", 409);
  }
  const payment = await ensurePayment(userId, kind, orderId);
  if (payment.provider !== "development" && client !== "miniprogram") throw new AppError("MINIPROGRAM_PAYMENT_REQUIRED", "本页面暂不支持付款", 409);
  if (payment.status !== "pending") throw new AppError("ORDER_NOT_PAYABLE", "当前订单不能支付", 409);
  return { ...await paymentProviderFor(payment.provider).create(payment), paymentId: payment.id };
}

async function grantPayment(database: Database, payment: Payment, order: SqlRow) {
  if (payment.order_kind === "work") {
    await database.query("UPDATE works SET locked=false WHERE id=$1", [order.work_id]);
    await database.query("UPDATE ai_runs SET selected_unlocked=true WHERE work_id=$1", [order.work_id]);
    await database.query("UPDATE video_projects SET status='ready',updated_at=now() WHERE work_id=$1", [order.work_id]);
    await database.query("UPDATE video_renders SET status='ready' WHERE work_id=$1 AND status='preview_ready'", [order.work_id]);
    await database.query("INSERT INTO events (id,user_id,plugin_id,name,created_at) VALUES ($1,$2,$3,'paid',now())", [crypto.randomUUID(), payment.user_id, order.plugin_id]);
    return;
  }
  if (payment.order_kind === "physical") {
    await database.query("UPDATE physical_orders SET provider_order_id=$2 WHERE id=$1", [payment.order_id, payment.provider_transaction_id]);
    return;
  }
  if (order.kind === "membership") {
    const memberships = await database.query("UPDATE memberships SET status='active',quota=COALESCE((entitlements->>'monthlyQuota')::int,0),used=0,status_updated_at=now(),expires_at=now()+CASE WHEN plan='yearly' THEN interval '365 days' ELSE interval '30 days' END,quota_reset_at=now()+interval '30 days' WHERE id=$1 AND user_id=$2 RETURNING id", [order.resource_id, payment.user_id]);
    if (!memberships[0]) throw new AppError("MEMBERSHIP_NOT_FOUND", "会员记录不存在", 409);
    await database.query("INSERT INTO entitlement_ledger (id,user_id,membership_id,order_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,$4,'membership',1,'granted','会员支付到账',now())", [crypto.randomUUID(), payment.user_id, order.resource_id, payment.order_id]);
  } else if (order.kind === "annual_report") {
    const reports = await database.query("UPDATE annual_reports SET locked=false WHERE id=$1 AND user_id=$2 RETURNING id", [order.resource_id, payment.user_id]);
    if (!reports[0]) throw new AppError("REPORT_NOT_FOUND", "年度报告不存在", 409);
  } else if (order.kind === "health_archive") {
    await database.query("INSERT INTO entitlement_ledger (id,user_id,order_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,'health_archive',1,'granted','单次购买健康档案导出',now())", [crypto.randomUUID(), payment.user_id, payment.order_id]);
  } else {
    throw new AppError("PAYMENT_SKU_UNSUPPORTED", "未知权益订单，已拒绝发放", 409);
  }
}

export async function applyPaymentConfirmation(paymentId: string, confirmation: PaymentConfirmation) {
  await inTransaction(async (database) => {
    const payment = (await database.query<Payment>("SELECT * FROM payment_transactions WHERE id=$1 FOR UPDATE", [paymentId]))[0];
    if (!payment) throw new AppError("PAYMENT_NOT_FOUND", "支付记录不存在", 404);
    if (payment.status === "refunded" || payment.status === "paid") return;
    if (!confirmation.paid) {
      if (confirmation.closed) await database.query("UPDATE payment_transactions SET status='closed',checked_at=now(),updated_at=now() WHERE id=$1", [payment.id]);
      return;
    }
    if (!confirmation.transactionId) throw new AppError("PAYMENT_UNCONFIRMED", "缺少渠道支付凭据", 409);
    const order = await sourceOrder(database, payment.order_kind, payment.order_id, payment.user_id, true);
    if (!["pending", "closed"].includes(String(order.status))) throw new AppError("ORDER_STATE_CONFLICT", "订单状态需要对账", 409);
    payment.provider_transaction_id = confirmation.transactionId;
    await grantPayment(database, payment, order);
    await database.query(`UPDATE ${orderTables[payment.order_kind]} SET status='paid',paid_at=now() WHERE id=$1`, [payment.order_id]);
    await database.query("UPDATE payment_transactions SET status='paid',provider_transaction_id=$2,channel=$3,delivered_at=now(),checked_at=now(),updated_at=now() WHERE id=$1", [payment.id, confirmation.transactionId, confirmation.channel || payment.provider]);
  });
}

async function revokePayment(database: Database, payment: Payment) {
  const order = await sourceOrder(database, payment.order_kind, payment.order_id, payment.user_id, true);
  await database.query(`UPDATE ${orderTables[payment.order_kind]} SET status='refunded' WHERE id=$1`, [payment.order_id]);
  if (payment.order_kind === "work") {
    await database.query("UPDATE works SET locked=true,public=false,share_token=NULL,share_expires_at=NULL,share_access_code_hash=NULL WHERE id=$1", [order.work_id]);
    await database.query("UPDATE ai_runs SET selected_unlocked=false WHERE work_id=$1", [order.work_id]);
    await database.query("UPDATE video_projects SET status='preview_ready',updated_at=now() WHERE work_id=$1", [order.work_id]);
    await database.query("UPDATE video_renders SET status='preview_ready' WHERE work_id=$1 AND status='ready'", [order.work_id]);
  } else if (payment.order_kind === "growth") {
    await database.query("UPDATE growth_orders SET refunded_at=now(),updated_at=now() WHERE id=$1", [payment.order_id]);
    if (order.kind === "membership") {
      await database.query("UPDATE memberships SET status='expired',quota=0,used=0,status_updated_at=now() WHERE id=$1", [order.resource_id]);
      const redeemed = await database.query("SELECT kind,resource_id FROM entitlement_ledger WHERE membership_id=$1 AND status='consumed'", [order.resource_id]);
      for (const item of redeemed) {
        if (item.kind === "annual_report") {
          const resourceId = item.resource_id;
          if (resourceId) await database.query("UPDATE annual_reports SET locked=true,share_token=NULL,revoked_at=now() WHERE id=$1 AND user_id=$2", [resourceId, payment.user_id]);
        }
      }
      await database.query("UPDATE health_documents SET revoked_at=now() WHERE id IN (SELECT resource_id FROM entitlement_ledger WHERE membership_id=$1)", [order.resource_id]);
      await database.query("UPDATE entitlement_ledger SET status='revoked' WHERE membership_id=$1", [order.resource_id]);
    } else if (order.kind === "annual_report") {
      await database.query("UPDATE annual_reports SET locked=true,share_token=NULL,revoked_at=now() WHERE id=$1", [order.resource_id]);
    }
    await database.query("UPDATE health_documents SET revoked_at=now() WHERE id IN (SELECT resource_id FROM entitlement_ledger WHERE order_id=$1)", [payment.order_id]);
    await database.query("UPDATE entitlement_ledger SET status='revoked' WHERE order_id=$1", [payment.order_id]);
  } else {
    await database.query("UPDATE physical_orders SET refunded_at=now() WHERE id=$1", [payment.order_id]);
  }
}

export async function applyRefundedTotal(paymentId: string, totalFen: number) {
  await inTransaction(async (database) => {
    const payment = (await database.query<Payment>("SELECT * FROM payment_transactions WHERE id=$1 FOR UPDATE", [paymentId]))[0];
    if (!payment || !Number.isSafeInteger(totalFen) || totalFen < 0 || totalFen > payment.amount_fen) throw new AppError("REFUND_AMOUNT_INVALID", "退款金额不匹配", 409);
    if (totalFen <= payment.refunded_fen) return;
    if (!["paid", "refunded"].includes(payment.status)) throw new AppError("REFUND_ORDER_UNPAID", "订单未确认收款", 409);
    if (totalFen === payment.amount_fen) await revokePayment(database, payment);
    if (payment.order_kind === "work") await database.query("UPDATE orders SET refunded_amount=$2 WHERE id=$1", [payment.order_id, totalFen / 100]);
    await database.query("UPDATE payment_transactions SET refunded_fen=$2,status=CASE WHEN amount_fen=$2 THEN 'refunded' ELSE status END,updated_at=now() WHERE id=$1", [paymentId, totalFen]);
  });
}

export async function getPayment(paymentId: string): Promise<Payment> {
  const row = (await (await getDatabase()).query<Payment>("SELECT * FROM payment_transactions WHERE id=$1", [paymentId]))[0];
  if (!row) throw new AppError("PAYMENT_NOT_FOUND", "支付记录不存在", 404);
  return row;
}

export async function reconcilePayment(payment: Payment) {
  if (payment.provider === "development") return payment;
  const provider = paymentProviderFor(payment.provider);
  const confirmation = await provider.query(payment);
  await applyPaymentConfirmation(payment.id, confirmation);
  if (confirmation.refundedFen) await applyRefundedTotal(payment.id, confirmation.refundedFen);
  const updated = await getPayment(payment.id);
  if (updated.status === "paid" && !updated.acknowledged_at && provider.acknowledge) {
    await provider.acknowledge(updated);
    await (await getDatabase()).query("UPDATE payment_transactions SET acknowledged_at=now() WHERE id=$1", [payment.id]);
  }
  await (await getDatabase()).query("UPDATE payment_transactions SET checked_at=now() WHERE id=$1", [payment.id]);
  return updated;
}

export async function confirmOrderPayment(userId: string, kind: OrderKind, orderId: string, simulate = false) {
  const payment = await ensurePayment(userId, kind, orderId);
  if (simulate) {
    if (isRealProduction() || payment.provider !== "development" || selectPaymentChannel(kind, payment.sku) !== "development") throw new AppError("PAYMENT_ADAPTER_REQUIRED", "当前订单必须由渠道确认收款", 503);
    await applyPaymentConfirmation(payment.id, { paid: true, transactionId: `dev-${payment.id}`, channel: "development" });
  } else {
    await reconcilePayment(payment);
  }
  return sourceOrder(await getDatabase(), kind, orderId, userId);
}

export async function paymentStatus(userId: string, kind: OrderKind, orderId: string) {
  await sourceOrder(await getDatabase(), kind, orderId, userId);
  const payment = (await (await getDatabase()).query<Payment>("SELECT * FROM payment_transactions WHERE order_kind=$1 AND order_id=$2 AND user_id=$3", [kind, orderId, userId]))[0];
  if (!payment) return { status: "pending", refundedAmount: 0 };
  const checkedAt = payment.checked_at ? new Date(String(payment.checked_at)).getTime() : 0;
  if (Date.now() - checkedAt > 3000 && payment.status !== "refunded") await reconcilePayment(payment);
  const updated = await getPayment(payment.id);
  const refunds = await (await getDatabase()).query("SELECT id,status,amount_fen FROM payment_refunds WHERE payment_id=$1 ORDER BY created_at DESC LIMIT 1", [payment.id]);
  return { status: updated.status, refundedAmount: updated.refunded_fen / 100, refund: refunds[0] ? { id: refunds[0].id, status: refunds[0].status, amount: Number(refunds[0].amount_fen) / 100 } : null };
}

export async function completeRefund(refundId: string) {
  const database = await getDatabase();
  const refund = (await database.query<PaymentRefund>("SELECT * FROM payment_refunds WHERE id=$1", [refundId]))[0];
  if (!refund) throw new AppError("REFUND_NOT_FOUND", "退款记录不存在", 404);
  const payment = await getPayment(refund.payment_id);
  const provider = paymentProviderFor(payment.provider);
  const status = await provider.queryRefund(payment, refund);
  if (status === "processing") return;
  const confirmed = payment.provider === "virtual" && status === "succeeded" ? await provider.query(payment) : undefined;
  await inTransaction(async (transaction) => {
    await transaction.query("SELECT id FROM payment_transactions WHERE id=$1 FOR UPDATE", [payment.id]);
    await transaction.query("UPDATE payment_refunds SET status=$2,checked_at=now(),completed_at=now() WHERE id=$1 AND status<>'succeeded'", [refundId, status]);
    await transaction.query("UPDATE refunds SET status=$2,completed_at=now() WHERE id=$1", [refundId, status]);
    if (status !== "succeeded") return;
    const sums = await transaction.query("SELECT COALESCE(sum(amount_fen),0)::int total FROM payment_refunds WHERE payment_id=$1 AND status='succeeded'", [payment.id]);
    await applyRefundedTotal(payment.id, confirmed?.refundedFen ?? Number(sums[0].total));
  });
}

async function submitRefund(payment: Payment, refund: PaymentRefund) {
  const provider = paymentProviderFor(payment.provider);
  await provider.refund(payment, refund);
  await (await getDatabase()).query("UPDATE payment_refunds SET status='processing',checked_at=now() WHERE id=$1 AND status='pending'", [refund.id]);
  if (payment.provider === "development") await completeRefund(refund.id);
}

export async function refundOrderPayment(userId: string, kind: OrderKind, orderId: string, reason: "generation_failed" | "dissatisfied" | "requested" = "requested") {
  const payment = await ensurePayment(userId, kind, orderId);
  if (kind === "physical") {
    const order = await sourceOrder(await getDatabase(), kind, orderId, userId);
    if (order.status !== "paid") throw new AppError("PHYSICAL_AFTER_SALE_REQUIRED", "订单已进入履约，请联系客服申请售后", 409);
  }
  if (payment.channel === "ios") throw new AppError("IOS_REFUND_VIA_APPLE", "此订单请在 Apple 购买记录中申请退款", 409);
  const refund = await inTransaction(async (database) => {
    await database.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const locked = (await database.query<Payment>("SELECT * FROM payment_transactions WHERE id=$1 FOR UPDATE", [payment.id]))[0];
    const existing = (await database.query<PaymentRefund>("SELECT * FROM payment_refunds WHERE payment_id=$1 AND status IN ('pending','processing')", [payment.id]))[0];
    if (existing) return existing;
    if (locked.status !== "paid" || locked.refunded_fen >= locked.amount_fen) throw new AppError("ALREADY_REFUNDED", "订单未付款或已完成退款", 409);
    if (reason === "dissatisfied") {
      const used = await database.query("SELECT id FROM refunds WHERE user_id=$1 AND reason='dissatisfied' AND status IN ('pending','succeeded')", [userId]);
      if (used.length) throw new AppError("DISSATISFIED_REFUND_USED", "每位用户仅有一次效果不满意退款机会", 409);
    }
    const amount = Math.min(locked.amount_fen - locked.refunded_fen, reason === "dissatisfied" ? Math.round(locked.amount_fen / 2) : locked.amount_fen);
    const id = crypto.randomUUID();
    const created = (await database.query<PaymentRefund>("INSERT INTO payment_refunds (id,payment_id,out_refund_no,amount_fen,reason) VALUES ($1,$2,$3,$4,$5) RETURNING *", [id, payment.id, id.replaceAll("-", ""), amount, reason]))[0];
    if (kind === "work") await database.query("INSERT INTO refunds (id,user_id,order_id,amount,reason,status,created_at) VALUES ($1,$2,$3,$4,$5,'pending',now())", [id, userId, orderId, amount / 100, reason]);
    return created;
  });
  if (refund.status === "pending") await submitRefund(payment, refund);
  const updated = (await (await getDatabase()).query<PaymentRefund>("SELECT * FROM payment_refunds WHERE id=$1", [refund.id]))[0];
  return { id: updated.id, amount: updated.amount_fen / 100, status: updated.status };
}

export async function listPaymentOrders(userId: string) {
  const rows = await (await getDatabase()).query(`
    SELECT source.*,p.status payment_status,COALESCE(p.refunded_fen,0) refunded_fen,
      (SELECT status FROM payment_refunds WHERE payment_id=p.id ORDER BY created_at DESC LIMIT 1) refund_status
    FROM (
      SELECT id,user_id,sku,amount,status,created_at,'work' payment_kind FROM orders
      UNION ALL SELECT id,user_id,sku,amount,status,created_at,'growth' payment_kind FROM growth_orders
      UNION ALL SELECT id,user_id,sku,amount,status,created_at,'physical' payment_kind FROM physical_orders
    ) source LEFT JOIN payment_transactions p ON p.order_id=source.id AND p.order_kind=source.payment_kind
    WHERE source.user_id=$1 ORDER BY source.created_at DESC LIMIT 100`, [userId]);
  return rows.map((row) => ({
    id: String(row.id), paymentKind: String(row.payment_kind), sku: String(row.sku),
    amount: Number(row.amount), status: ["pending", "processing"].includes(String(row.refund_status)) ? "refunding" : String(row.status),
    refundedAmount: Number(row.refunded_fen) / 100, refundStatus: row.refund_status || null,
  }));
}

export async function reconcilePayments(limit = 20) {
  const database = await getDatabase();
  const payments = await database.query<Payment>("SELECT * FROM payment_transactions WHERE provider<>'development' AND (status='pending' OR (status='paid' AND (acknowledged_at IS NULL OR provider='virtual'))) AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY checked_at NULLS FIRST LIMIT $1", [limit]);
  let failed = 0;
  for (const payment of payments) {
    await database.query("UPDATE payment_transactions SET checked_at=now() WHERE id=$1", [payment.id]);
    try { await reconcilePayment(payment); } catch { failed += 1; }
  }
  const refunds = await database.query<PaymentRefund>("SELECT * FROM payment_refunds WHERE status IN ('pending','processing') AND (checked_at IS NULL OR checked_at<now()-interval '1 minute') ORDER BY checked_at NULLS FIRST LIMIT $1", [limit]);
  for (const refund of refunds) {
    await database.query("UPDATE payment_refunds SET checked_at=now() WHERE id=$1", [refund.id]);
    try {
      if (refund.status === "pending") await submitRefund(await getPayment(refund.payment_id), refund);
      await completeRefund(refund.id);
    } catch { failed += 1; }
  }
  return { payments: payments.length, refunds: refunds.length, failed };
}
