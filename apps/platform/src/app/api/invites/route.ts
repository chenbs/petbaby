import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getInviteSummary } from "@/server/invite-service";

/** 我的邀请码与邀请战绩。颗数、每日上限、有效期都由服务端下发，端上不写死。 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    return NextResponse.json({ data: await getInviteSummary(userId) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
