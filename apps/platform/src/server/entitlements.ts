import "server-only";

import { getDatabase } from "@/server/db/client";

/*
 * 会员权益判定。
 *
 * 会员方案在 2026-08-03 重做（迁移 0020）：原先卖「每月 10 次生成」，
 * 而免费用户每天 1 次约等于每月 30 次 —— 付费买到的比免费的还少。
 * 新权益跨健康 + 创意两线，且**不卖次数**：加次数是在鼓励用户多生成，
 * 而产品要鼓励的是多积累，这两件事不同。
 */

interface MembershipEntitlements {
  /**
   * 交付物规格上限解锁：画册/短片按最高**规格**交付，但按最低档**计价**。
   *
   * 规格与计价是两件事，判定在 `domain/pricing.ts` 的 `resolveOrderPricing`。
   * 早期实现把「给最高档」直接喂给计价函数，结果会员比免费用户多付钱 ——
   * 这里的注释措辞刻意区分「规格」与「计价」，就是为了不再被读成同一件事。
   */
  tierUnlock?: boolean;
  /** 健康档案 PDF 无限导出。A5 未实施期间不挂进任何在售套餐。 */
  healthExportUnlimited?: boolean;
  annualHealthReport?: number;
  annualReport?: number;
  /** 实体商品折扣率，0.9 表示九折。缺失按不打折（1）处理。 */
  physicalDiscount?: number;
}

/** 按次消耗的权益。键是权益名，值是 `entitlement_ledger.kind`。 */
const COUNTED_KINDS = {
  annualReport: "annual_report",
  annualHealthReport: "annual_health_report",
} as const;

export type CountedEntitlement = keyof typeof COUNTED_KINDS;

/**
 * 取当前有效会员及其权益。无有效会员返回 undefined。
 *
 * 只认 `status='active'` 且未过期的记录 —— 与 platform-service 的额度扣减
 * 同一个判定条件，避免「额度那边认、权益这边不认」。
 *
 * 一并返回 membershipId：按次权益的核销要写 `entitlement_ledger.membership_id`，
 * 否则同一用户续过费的两段会员分不清是哪一段用掉的额度。
 */
async function activeMembership(userId: string): Promise<{ id: string; entitlements: MembershipEntitlements } | undefined> {
  const database = await getDatabase();
  const rows = await database.query<{ id: string; entitlements: unknown }>(
    "SELECT id,entitlements FROM memberships WHERE user_id=$1 AND status='active' AND expires_at>now() ORDER BY expires_at DESC LIMIT 1",
    [userId],
  );
  if (!rows[0]) return undefined;
  const value = rows[0].entitlements;
  return { id: String(rows[0].id), entitlements: (typeof value === "object" && value ? value : {}) as MembershipEntitlements };
}

/** 是否享有「交付物规格上限解锁」。 */
export async function hasTierUnlock(userId: string): Promise<boolean> {
  return Boolean((await activeMembership(userId))?.entitlements.tierUnlock);
}

/** 是否享有健康档案无限导出。 */
export async function hasHealthExport(userId: string): Promise<boolean> {
  return Boolean((await activeMembership(userId))?.entitlements.healthExportUnlimited);
}

/**
 * 实体商品折扣率。无会员或未配置该权益时返回 1（不打折）。
 *
 * 夹在 (0,1] 内：权益 JSON 是运营在后台可编辑的，一个手误的 0 会让实体订单变成
 * 0 元、一个 1.2 会变成加价。折扣率这种「直接乘在钱上」的值必须在读取侧兜底。
 */
export async function physicalDiscountRate(userId: string): Promise<number> {
  const value = (await activeMembership(userId))?.entitlements.physicalDiscount;
  if (typeof value !== "number" || !Number.isFinite(value)) return 1;
  return Math.min(1, Math.max(0.1, value));
}

/**
 * 按次权益的剩余量。`entitlements` 里的数字是**周期总量**，
 * 已用量从 `entitlement_ledger` 数同一段会员内 `status='consumed'` 的条数。
 *
 * 不在 `memberships` 上加计数列：quota/used 那两列是给旧的「每月 N 次生成」用的，
 * 混进来会让「配额重置」（resetMembershipQuotas 每 30 天清 used）把年度权益也一起清掉。
 */
export async function entitlementBalance(userId: string, kind: CountedEntitlement): Promise<number> {
  const membership = await activeMembership(userId);
  if (!membership) return 0;
  const total = membership.entitlements[kind];
  if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return 0;
  const database = await getDatabase();
  const rows = await database.query<{ used: number }>(
    "SELECT count(*)::int used FROM entitlement_ledger WHERE membership_id=$1 AND kind=$2 AND status='consumed'",
    [membership.id, COUNTED_KINDS[kind]],
  );
  return Math.max(0, Math.floor(total) - Number(rows[0]?.used || 0));
}

/**
 * 单次购买的权益凭据（不依赖会员）。
 *
 * 会员的按次权益走 `entitlementBalance` / `claimEntitlement`（按 membership_id 记账），
 * 而**非会员单买**没有 membership_id —— 凭据以 `membership_id IS NULL` 的
 * `status='granted'` 行表示，核销时改成 `consumed`。
 *
 * 两条路径共用 `entitlement_ledger` 而不是新开表：后台 `/admin/business`
 * 已经在读这张表展示账本，用户买了什么、用掉了什么应该在同一处看得到。
 */
export async function grantPurchasedCredit(userId: string, kind: string, orderId: string, reason: string) {
  const database = await getDatabase();
  await database.query(
    "INSERT INTO entitlement_ledger (id,user_id,order_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,$4,1,'granted',$5,$6)",
    [crypto.randomUUID(), userId, orderId, kind, reason, new Date()],
  );
}

/**
 * 核销一次单买凭据。没有可用凭据返回 false。
 *
 * `FOR UPDATE SKIP LOCKED` 不适用（PGlite 支持有限），改用「先 UPDATE 一行、
 * 看有没有影响到」的写法：`UPDATE ... WHERE id = (SELECT ... LIMIT 1)` 是
 * 原子的，两个并发请求不会核销同一行。
 */
export async function consumePurchasedCredit(userId: string, kind: string, reason: string): Promise<boolean> {
  const database = await getDatabase();
  const rows = await database.query(
    `UPDATE entitlement_ledger SET status='consumed', reason=$3
      WHERE id = (
        SELECT id FROM entitlement_ledger
         WHERE user_id=$1 AND kind=$2 AND status='granted' AND membership_id IS NULL
         ORDER BY created_at LIMIT 1
      )
      RETURNING id`,
    [userId, kind, reason],
  );
  return Boolean(rows[0]);
}

/** 单买凭据的剩余张数。供端上决定是否显示「购买」按钮 */
export async function purchasedCreditBalance(userId: string, kind: string): Promise<number> {
  const rows = await (await getDatabase()).query<{ count: number }>(
    "SELECT count(*)::int count FROM entitlement_ledger WHERE user_id=$1 AND kind=$2 AND status='granted' AND membership_id IS NULL",
    [userId, kind],
  );
  return Number(rows[0]?.count || 0);
}

/**
 * 核销一次按次权益。余量不足返回 false，调用方据此回落到付费路径。
 *
 * 记账用 `entitlement_ledger` 而不是新表：后台 `/admin/business` 已经在读这张表
 * 展示账本，新开一张会让「这个会员用掉了什么」分散在两处。
 *
 * @param reason 写进账本的人类可读原因，出现在后台，要能定位到具体资源
 */
export async function claimEntitlement(userId: string, kind: CountedEntitlement, reason: string): Promise<boolean> {
  const membership = await activeMembership(userId);
  if (!membership) return false;
  if ((await entitlementBalance(userId, kind)) <= 0) return false;
  const database = await getDatabase();
  await database.query(
    "INSERT INTO entitlement_ledger (id,user_id,membership_id,kind,units,status,reason,created_at) VALUES ($1,$2,$3,$4,1,'consumed',$5,$6)",
    [crypto.randomUUID(), userId, membership.id, COUNTED_KINDS[kind], reason, new Date()],
  );
  return true;
}
