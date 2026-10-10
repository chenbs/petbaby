import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createPaidAnnualReport, listAnnualReports } from "@/server/growth-service";
import { enforceRateLimit } from "@/server/risk/controls";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await listAnnualReports(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}

/** 生成年度报告：先扣冻干，产物直接是高清版。idempotencyKey 防止连点扣两次。 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await enforceRateLimit("annual-report:user", userId, 3, 60);
    const body = z.object({ year: z.number().int().min(2020).max(2100), idempotencyKey: z.string().min(8).max(120).optional() }).parse(await request.json());
    return NextResponse.json({ data: await createPaidAnnualReport(userId, body.year, body.idempotencyKey) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
