import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { getVisitSummary } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";

/**
 * 给兽医看的就医摘要（免费，`?days=14`）。在诊室里打开手机给医生看，或复制成文字发给医院。
 * 只做罗列与计数，不含结论；可打印的完整版是付费的健康档案 PDF。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json({ data: await getVisitSummary(await requireUserId(request), z.string().uuid().parse(id), query) });
  } catch (error) { return routeError(error); }
}
