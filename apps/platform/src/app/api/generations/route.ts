import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { createGeneration, listGenerations } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { assertGenerationCircuit, clientAddress, enforceRateLimit } from "@/server/risk/controls";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await listGenerations(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("generation:user", userId, 6, 60),
      enforceRateLimit("generation:ip", clientAddress(request), 20, 60),
      assertGenerationCircuit(),
    ]);
    const task = await createGeneration(userId, await request.json());
    // 任务一律交给 Worker（pnpm worker），本地与生产同一条路径（2026-10-09 起不再在请求里内联执行）。
    return NextResponse.json({ data: task }, { status: 202 });
  } catch (error) {
    return routeError(error);
  }
}
