import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createHealthArchiveOrder } from "@/server/growth-service";

/**
 * 单买一次健康档案导出（L1 的非会员路径，¥29.9）。
 *
 * 付款后发一张凭据，导出时核销 —— 不直接生成文件：
 * 付款与产出之间要有可追溯的凭据，否则付了款而生成失败就无处申诉。
 *
 * 已是会员时返回 409，不让他买一个已经拥有的东西。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    return NextResponse.json({ data: await createHealthArchiveOrder(await requireUserId(request)) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
