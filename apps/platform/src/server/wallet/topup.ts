import "server-only";

import { z } from "zod";
import { getDatabase, inTransaction, type Database, type SqlRow } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { DONGAN_NAME, DONGAN_UNIT } from "@/domain/dongan-pricing";
import { credit } from "./service";

/*
 * 冻干充值档（36 号文第 6 章）。每次充值新建一张 growth_orders(kind='wallet_topup')，
 * 走现有虚拟支付「道具直购」链路：支付确认后在同一事务里入账，回调重复投递只到账一次。
 *
 * 用户只看到「付 ¥38，到账 50 颗冻干」，看不到任何代币或兑换步骤。
 */

export type TopupPackage = { id: string; sku: string; amount: number; units: number; first?: boolean; badge?: string };

/** 新人首充：每个账号一次。到账时再校验一次资格，并发两单首充只有一单按首充到账。 */
export const FIRST_TOPUP: TopupPackage = { id: "first", sku: "fd-topup-6-first", amount: 6, units: 12, first: true, badge: "新人首充 · 仅此一次" };

export const TOPUP_PACKAGES: TopupPackage[] = [
  { id: "p6", sku: "fd-topup-6", amount: 6, units: 6 },
  { id: "p18", sku: "fd-topup-18", amount: 18, units: 22 },
  { id: "p38", sku: "fd-topup-38", amount: 38, units: 50, badge: "最多人选" },
  { id: "p68", sku: "fd-topup-68", amount: 68, units: 95 },
  { id: "p128", sku: "fd-topup-128", amount: 128, units: 188, badge: "最划算" },
];

/** 单日累计充值上限（元）。未成年人保护口径，见 35 号文第 8 章。 */
export const DAILY_TOPUP_LIMIT = 300;

const ALL_PACKAGES = [FIRST_TOPUP, ...TOPUP_PACKAGES];
export const TOPUP_SKU_PATTERN = /^fd-topup-(6-first|6|18|38|68|128)$/;

function packageBySku(sku: string) {
  return ALL_PACKAGES.find((item) => item.sku === sku);
}

/** 加送比例与折扣都按「6 元 6 颗」这个真实在售的基础档折算，不是虚构的划线价。 */
function describePackage(item: TopupPackage) {
  const gift = item.units - item.amount;
  return {
    ...item,
    gift,
    giftPercent: item.amount ? Math.round((gift / item.amount) * 100) : 0,
    discount: item.units ? Math.floor((item.amount / item.units) * 100) / 10 : 10,
    /** 「够做 N 张写真」：写真单张 2 颗 */
    photos: Math.floor(item.units / 2),
  };
}

async function firstTopupUsed(database: Database, userId: string) {
  const rows = await database.query("SELECT first_topup_at FROM wallet_accounts WHERE user_id=$1", [userId]);
  return Boolean(rows[0]?.first_topup_at);
}

export async function listTopupPackages(userId: string) {
  const database = await getDatabase();
  const firstAvailable = !(await firstTopupUsed(database, userId));
  return {
    name: DONGAN_NAME,
    unit: DONGAN_UNIT,
    first: firstAvailable ? describePackage(FIRST_TOPUP) : undefined,
    packages: TOPUP_PACKAGES.map(describePackage),
    notice: `${DONGAN_NAME}仅限本小程序使用，不可提现或转让；充值到账的${DONGAN_NAME}长期有效，赠送的${DONGAN_NAME}有有效期。`,
  };
}

const createSchema = z.object({ packageId: z.enum(["first", "p6", "p18", "p38", "p68", "p128"]) });

export async function createTopupOrder(userId: string, input: unknown) {
  const { packageId } = createSchema.parse(input);
  const item = ALL_PACKAGES.find((entry) => entry.id === packageId)!;
  return inTransaction(async (database) => {
    await database.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    if (item.first && await firstTopupUsed(database, userId)) throw new AppError("FIRST_TOPUP_USED", "新人首充已经用过了，换一档吧", 409);
    const today = await database.query<{ total: number }>(
      "SELECT coalesce(sum(amount),0)::float total FROM growth_orders WHERE user_id=$1 AND kind='wallet_topup' AND status IN ('pending','paid') AND created_at>=date_trunc('day',now())",
      [userId],
    );
    if (Number(today[0]?.total || 0) + item.amount > DAILY_TOPUP_LIMIT) throw new AppError("TOPUP_DAILY_LIMIT", `今天的充值已达上限 ¥${DAILY_TOPUP_LIMIT}，明天再来吧`, 429);
    const id = crypto.randomUUID();
    const rows = await database.query(
      "INSERT INTO growth_orders (id,user_id,kind,resource_id,sku,amount,status,entitlement_snapshot,created_at,updated_at) VALUES ($1,$2,'wallet_topup',NULL,$3,$4,'pending',$5::jsonb,now(),now()) RETURNING *",
      [id, userId, item.sku, item.amount, JSON.stringify({ units: item.units, first: Boolean(item.first), packageId: item.id })],
    );
    return mapTopupOrder(rows[0]);
  });
}

export function mapTopupOrder(row: SqlRow) {
  const snapshot = (row.entitlement_snapshot || {}) as { units?: number; first?: boolean };
  return { id: String(row.id), sku: String(row.sku), amount: Number(row.amount), units: Number(snapshot.units || 0), first: Boolean(snapshot.first), status: String(row.status), createdAt: new Date(String(row.created_at)).toISOString() };
}

/**
 * 支付确认后的到账（在 applyPaymentConfirmation 的事务里调用）。
 *
 * 首充资格在这里再校验一次：两张首充单同时付款时，第二张按普通 6 元档到账 6 颗 ——
 * 钱已经付了，不能拒收，只能按实际可享的档位到账，并在流水标题里写明。
 */
export async function grantTopup(database: Database, order: SqlRow, amountFen: number) {
  const item = packageBySku(String(order.sku));
  if (!item) throw new AppError("PAYMENT_SKU_UNSUPPORTED", "未知充值档位，已拒绝到账", 409);
  const userId = String(order.user_id);
  await database.query("INSERT INTO wallet_accounts (user_id,balance,updated_at) VALUES ($1,0,now()) ON CONFLICT (user_id) DO NOTHING", [userId]);
  const account = (await database.query("SELECT first_topup_at FROM wallet_accounts WHERE user_id=$1 FOR UPDATE", [userId]))[0];
  const downgraded = Boolean(item.first && account?.first_topup_at);
  const units = downgraded ? TOPUP_PACKAGES[0].units : item.units;
  await credit(userId, {
    pocket: "purchased", source: "topup", units, bizKey: `topup:${String(order.id)}`,
    unitPriceFen: Math.round((amountFen / units) * 100) / 100, growthOrderId: String(order.id),
    title: downgraded ? `充值 ¥${item.amount}（首充已用过，按普通档到账）` : `充值 ¥${item.amount}`,
    refType: "growth_order", refId: String(order.id),
  });
  await database.query("UPDATE wallet_accounts SET first_topup_at=coalesce(first_topup_at,now()) WHERE user_id=$1", [userId]);
  if (downgraded) await database.query("UPDATE growth_orders SET entitlement_snapshot=entitlement_snapshot||$2::jsonb WHERE id=$1", [order.id, JSON.stringify({ units, first: false, downgraded: true })]);
}

/**
 * 充值单全额退款后扣回这笔冻干（在 revokePayment 的事务里调用）。
 *
 * 先扣这一批的剩余；不够时从其他购买批次按入账先后补扣；仍不够说明已经花掉，
 * 冻结账户等人工处理 —— 不能让余额变负，也不能当作没发生。
 */
export async function revokeTopup(database: Database, order: SqlRow) {
  const userId = String(order.user_id);
  const account = (await database.query("SELECT balance FROM wallet_accounts WHERE user_id=$1 FOR UPDATE", [userId]))[0];
  const lot = (await database.query("SELECT * FROM wallet_lots WHERE growth_order_id=$1 FOR UPDATE", [order.id]))[0];
  if (!lot || String(lot.status) === "refunded") return;
  let owed = Number(lot.units);
  const allocations: Array<{ lotId: string; units: number }> = [];
  const fromSelf = Math.min(owed, Number(lot.remaining));
  if (fromSelf > 0) allocations.push({ lotId: String(lot.id), units: fromSelf });
  owed -= fromSelf;
  await database.query("UPDATE wallet_lots SET remaining=0,status='refunded' WHERE id=$1", [lot.id]);
  if (owed > 0) {
    const others = await database.query("SELECT id,remaining FROM wallet_lots WHERE user_id=$1 AND pocket='purchased' AND status='active' AND remaining>0 AND id<>$2 ORDER BY created_at FOR UPDATE", [userId, lot.id]);
    for (const other of others) {
      if (owed <= 0) break;
      const take = Math.min(owed, Number(other.remaining));
      await database.query("UPDATE wallet_lots SET remaining=remaining-$2 WHERE id=$1", [other.id, take]);
      allocations.push({ lotId: String(other.id), units: take });
      owed -= take;
    }
  }
  const taken = allocations.reduce((sum, item) => sum + item.units, 0);
  const after = Number(account?.balance || 0) - taken;
  await database.query("UPDATE wallet_accounts SET balance=$2,frozen_reason=CASE WHEN $3 THEN 'refund_shortfall' ELSE frozen_reason END,updated_at=now() WHERE user_id=$1", [userId, after, owed > 0]);
  if (taken > 0) {
    await database.query(
      "INSERT INTO wallet_ledger (id,user_id,delta,balance_after,reason,biz_key,ref_type,ref_id,allocations,title,created_at) VALUES ($1,$2,$3,$4,'topup_refund',$5,'growth_order',$6,$7::jsonb,$8,now()) ON CONFLICT (biz_key) DO NOTHING",
      [crypto.randomUUID(), userId, -taken, after, `refund:${String(order.id)}`, String(order.id), JSON.stringify(allocations), `充值退款 ¥${Number(order.amount)}`],
    );
  }
  if (owed > 0) {
    await database.query("INSERT INTO user_notifications (id,user_id,type,title,body,target_path,created_at) VALUES ($1,$2,'wallet_frozen',$3,$4,'/pages/wallet/wallet',now())", [crypto.randomUUID(), userId, `${DONGAN_NAME}暂时冻结`, `退款的那笔${DONGAN_NAME}已经用掉一部分，账户暂时不能消耗，客服会联系你核对`]);
  }
}

/** iOS 退款问询的判据：这笔充值到账的冻干是否已经被花掉。 */
export async function topupConsumption(database: Database, orderId: string) {
  const lot = (await database.query("SELECT units,remaining,status FROM wallet_lots WHERE growth_order_id=$1", [orderId]))[0];
  if (!lot) return { found: false, consumed: 0 };
  return { found: true, consumed: Number(lot.units) - Number(lot.remaining), status: String(lot.status) };
}
