import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { createRecord, listRecords } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

const idSchema = z.string().uuid();

/**
 * 日常记录时间流（体重、疫苗驱虫与其余日常记录合并）。
 * `?group=body|food|medical|care|weight|life` 按分组筛选，`cursor` 为上一页返回的 nextCursor。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const query = Object.fromEntries(new URL(request.url).searchParams);
    return NextResponse.json({ data: await listRecords(await requireUserId(request), idSchema.parse(id), query) });
  } catch (error) { return routeError(error); }
}

/** 记一笔。**只存事实不存结论**；用药名由用户填写，产品不给候选（红线 2）。 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("records:user", userId, 60, 60),
      enforceRateLimit("records:ip", clientAddress(request), 120, 60),
    ]);
    return NextResponse.json({ data: await createRecord(userId, idSchema.parse(id), await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
