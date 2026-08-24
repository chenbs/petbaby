import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getWeightHistory, recordWeight } from "@/server/health-service";

const idSchema = z.string().uuid();

/**
 * 体重记录。健康分诊的输入质量依赖它（肥胖判断、疾病趋势都看体重），
 * 也是健康档案 PDF 的体重曲线数据源。
 *
 * **不做 BMI 或肥胖评级** —— 那是评价性结论，接近诊断。
 */
/**
 * 体重记录与趋势（L6）。
 *
 * 返回 `{ records, trend, note }`：趋势由服务端算（口径只有一份），
 * `note` 是变化幅度较大时的提示语。**三者都不含评价性结论** ——
 * 「变化了 6%」是事实，「偏胖」是诊断。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await getWeightHistory(await requireUserId(request), idSchema.parse(id)) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const userId = await requireUserId(request);
    return NextResponse.json({ data: await recordWeight(userId, idSchema.parse(id), await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
