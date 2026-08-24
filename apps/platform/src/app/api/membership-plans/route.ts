import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { listMembershipPlans } from "@/server/growth-service";

/**
 * 在售会员套餐（改造项 M3）。**两端的套餐名、价格、权益文案唯一来源。**
 *
 * 不需要登录：这是价目表，未登录用户也该能看到自己要买的是什么。
 * 已下架的套餐不会出现在这里，端上也就不可能再卖出一个点了报 409 的套餐。
 */
export async function GET() {
  try {
    return NextResponse.json({ data: await listMembershipPlans() });
  } catch (error) { return routeError(error); }
}
