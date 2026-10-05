import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { getRecordOverview } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";

/** 记录页顶部概览：连续记录天数、上次 X 是几天前、近 7 天计数、到期与用药疗程。只给事实不给评价。 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await getRecordOverview(await requireUserId(request), z.string().uuid().parse(id)) });
  } catch (error) { return routeError(error); }
}
