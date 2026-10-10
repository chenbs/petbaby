import "server-only";

import { getDatabase } from "@/server/db/client";

/*
 * 历史权益凭据（冻干上线前的单买记录）。
 *
 * 会员已于 2026-10-08 下线，会员权益的判定与核销随之删除；付费统一改扣冻干
 * （server/wallet）。这里只保留冻干上线前「单次购买健康档案」留下的凭据：
 * 已付过钱的用户仍可凭它导出一次，导出逻辑见 health-service。
 *
 * 凭据以 `entitlement_ledger` 中 `membership_id IS NULL`、`status='granted'` 的行表示，
 * 核销时改成 `consumed`。表本身保留：历史会员记录与审计都挂在它上面。
 */

/** 发一张单买凭据。只剩测试与历史数据修复在用，新购一律走冻干。 */
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
 * 用「先 UPDATE 一行、看有没有影响到」的写法：`UPDATE ... WHERE id = (SELECT ... LIMIT 1)`
 * 是原子的，两个并发请求不会核销同一行。
 */
export async function consumePurchasedCredit(userId: string, kind: string, reason: string, resourceId?: string): Promise<boolean> {
  const database = await getDatabase();
  const rows = await database.query(
    `UPDATE entitlement_ledger SET status='consumed', reason=$3, resource_id=$4
      WHERE status='granted' AND id = (
        SELECT id FROM entitlement_ledger
         WHERE user_id=$1 AND kind=$2 AND status='granted' AND membership_id IS NULL
         ORDER BY created_at LIMIT 1
      )
      RETURNING id`,
    [userId, kind, reason, resourceId || null],
  );
  return Boolean(rows[0]);
}

/** 未核销的单买凭据数量。 */
export async function purchasedCreditBalance(userId: string, kind: string): Promise<number> {
  const rows = await (await getDatabase()).query<{ count: number }>(
    "SELECT count(*)::int count FROM entitlement_ledger WHERE user_id=$1 AND kind=$2 AND status='granted' AND membership_id IS NULL",
    [userId, kind],
  );
  return Number(rows[0]?.count || 0);
}
