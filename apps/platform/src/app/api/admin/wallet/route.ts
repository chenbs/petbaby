import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdminAudit } from "@/server/admin/audit";
import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase, inTransaction } from "@/server/db/client";
import { routeError } from "@/server/errors";
import { getWallet, grantByAdmin } from "@/server/wallet/service";

/*
 * 冻干钱包后台：按用户查余额、批次、流水，看每日报表；人工补偿只能发「赠送所得」（必须有有效期与原因），
 * 不提供直接改余额 —— 余额只能由流水推出来，改余额等于让账本对不上。
 *
 * 收入口径：只计现金（充值单 + 实体单 + 冻干上线前的历史订单）。冻干消耗不是收入，不能重复计。
 */
const querySchema = z.object({ userId: z.string().uuid().optional(), days: z.coerce.number().int().min(1).max(90).default(14) });

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const database = await getDatabase();
    const [daily, liability, spendByKind] = await Promise.all([
      database.query(
        `SELECT to_char(date_trunc('day',created_at),'YYYY-MM-DD') AS "day",
           coalesce(sum(delta) FILTER (WHERE reason='topup'),0)::int topup_units,
           coalesce(-sum(delta) FILTER (WHERE reason='spend'),0)::int spent_units,
           coalesce(sum(delta) FILTER (WHERE reason='spend_return'),0)::int returned_units,
           coalesce(sum(delta) FILTER (WHERE reason IN ('newcomer_gift','admin_grant')),0)::int gifted_units,
           coalesce(-sum(delta) FILTER (WHERE reason='expire'),0)::int expired_units
         FROM wallet_ledger WHERE created_at >= now() - ($1::int * interval '1 day') GROUP BY 1 ORDER BY 1 DESC`,
        [query.days],
      ),
      database.query(
        `SELECT coalesce(sum(remaining) FILTER (WHERE pocket='purchased'),0)::int purchased_units,
           coalesce(sum(remaining*coalesce(unit_price_fen,0)) FILTER (WHERE pocket='purchased'),0)::float purchased_fen,
           coalesce(sum(remaining) FILTER (WHERE pocket='gift'),0)::int gift_units
         FROM wallet_lots WHERE status='active' AND (expires_at IS NULL OR expires_at>now())`,
      ),
      database.query(
        `SELECT coalesce(ref_type,'other') ref_type, count(*)::int count, coalesce(-sum(delta),0)::int units
         FROM wallet_ledger WHERE reason='spend' AND created_at >= now() - ($1::int * interval '1 day') GROUP BY 1 ORDER BY units DESC`,
        [query.days],
      ),
    ]);
    const topupRevenue = await database.query("SELECT coalesce(sum(amount),0)::float amount, count(*)::int orders FROM growth_orders WHERE kind='wallet_topup' AND paid_at IS NOT NULL AND paid_at >= now() - ($1::int * interval '1 day')", [query.days]);
    let user;
    if (query.userId) {
      const wallet = await getWallet(query.userId);
      const [account, lots, ledger] = await Promise.all([
        database.query("SELECT * FROM wallet_accounts WHERE user_id=$1", [query.userId]),
        database.query("SELECT * FROM wallet_lots WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100", [query.userId]),
        database.query("SELECT * FROM wallet_ledger WHERE user_id=$1 ORDER BY created_at DESC LIMIT 200", [query.userId]),
      ]);
      user = { wallet, account: account[0] || null, lots, ledger };
    }
    return NextResponse.json({ data: {
      days: query.days,
      daily,
      liability: { purchasedUnits: Number(liability[0]?.purchased_units || 0), purchasedAmount: Math.round(Number(liability[0]?.purchased_fen || 0)) / 100, giftUnits: Number(liability[0]?.gift_units || 0) },
      spendByKind,
      topupRevenue: { amount: Number(topupRevenue[0]?.amount || 0), orders: Number(topupRevenue[0]?.orders || 0) },
      user,
    } });
  } catch (error) { return routeError(error); }
}

const actionSchema = z.object({
  action: z.literal("grant_gift"),
  userId: z.string().uuid(),
  units: z.number().int().min(1).max(200),
  days: z.number().int().min(1).max(365).default(30),
  reason: z.string().trim().min(2).max(60),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = actionSchema.parse(await request.json());
    const result = await inTransaction(async () => {
      const granted = await grantByAdmin(actorId, input.userId, { units: input.units, days: input.days, reason: input.reason });
      await recordAdminAudit({ actorId, action: "wallet_grant_gift", targetType: "wallet", targetId: input.userId, reason: input.reason, after: granted, metadata: { units: input.units, days: input.days }, userId: input.userId });
      return granted;
    });
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) { return routeError(error); }
}
