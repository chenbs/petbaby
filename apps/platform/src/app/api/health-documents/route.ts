import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createHealthDocument, listHealthDocuments } from "@/server/health-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 健康档案（A5）与年度健康记录（A6）。
 *
 * **这是就医准备材料不是体检报告**：内容全部来自用户自己录入的记录，
 * 产品只做罗列与减法（体重变化），不给结论性判断 —— 红线见
 * `server/health/document.ts`。
 *
 * 传 `year` 即年度记录（走 `annualHealthReport` 按次权益），
 * 不传则是完整档案（走 `healthExportUnlimited`）。
 */
const bodySchema = z.object({
  petId: z.string().uuid(),
  year: z.number().int().min(2000).max(2100).optional(),
});

export async function GET(request: Request) {
  try {
    const petId = new URL(request.url).searchParams.get("petId") || undefined;
    return NextResponse.json({ data: await listHealthDocuments(await requireUserId(request), petId) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    /*
     * 限频比分诊松（这条不调模型，只是排版），但仍要限：
     * PDF 栅格化走 sharp，连点十次会把 CPU 占满，而队列并发是 1。
     */
    await Promise.all([
      enforceRateLimit("health-doc:user", userId, 5, 60),
      enforceRateLimit("health-doc:ip", clientAddress(request), 20, 60),
    ]);
    const data = bodySchema.parse(await request.json());
    return NextResponse.json({ data: await createHealthDocument(userId, data.petId, { year: data.year }) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
