import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";
import { createTopupOrder } from "@/server/wallet/topup";

/**
 * 创建一张冻干充值单。之后复用 /api/growth-orders/[id]/prepare 与 /status 完成支付：
 * 支付确认后在同一事务里到账，回调重复投递只到账一次。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("wallet-topup:user", userId, 10, 60),
      enforceRateLimit("wallet-topup:ip", clientAddress(request), 30, 60),
    ]);
    return NextResponse.json({ data: await createTopupOrder(userId, await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
