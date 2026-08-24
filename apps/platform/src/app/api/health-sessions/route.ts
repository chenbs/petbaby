import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createHealthSession, listHealthSessions } from "@/server/health-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 健康分诊。**这是分诊不是问诊/诊断** —— 定位与红线见
 * `docs/product/16-竞品分析与产品复盘.md` 第三章。
 *
 * 不走 assertGenerationCircuit：那个熔断是按图片生成的日成本算的，
 * 健康线是独立成本池（且单次成本低两个量级），共用会让任一侧打满
 * 把另一侧一起关掉。健康线自己的成本控制靠 health_daily_quotas 的频次限额。
 */
export async function GET(request: Request) {
  try {
    const petId = new URL(request.url).searchParams.get("petId") || undefined;
    return NextResponse.json({ data: await listHealthSessions(await requireUserId(request), petId) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("health:user", userId, 5, 60),
      enforceRateLimit("health:ip", clientAddress(request), 20, 60),
    ]);
    return NextResponse.json({ data: await createHealthSession(userId, await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
