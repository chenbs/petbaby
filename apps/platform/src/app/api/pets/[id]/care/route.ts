import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listCare, recordCare } from "@/server/health-service";

const idSchema = z.string().uuid();

/**
 * 免疫 / 驱虫 / 体检记录（改造项 L5 的数据来源）。
 *
 * **只存事实不存结论**：记「打了什么、哪天打的、下次哪天」，
 * 不记「是否达标」——后者是评价性判断，接近诊断。
 * 下次日期由用户或厂商说明决定，产品只负责替他记住并在到期前提醒。
 *
 * **不推荐任何疫苗品牌或驱虫药**（红线 2）：`label` 是用户自己填的，
 * 产品不给候选清单，也不校验它是什么。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await listCare(await requireUserId(request), idSchema.parse(id)) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const userId = await requireUserId(request);
    return NextResponse.json({ data: await recordCare(userId, idSchema.parse(id), await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
