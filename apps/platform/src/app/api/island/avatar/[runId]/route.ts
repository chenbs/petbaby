import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getAvatarRun } from "@/server/island/avatar";

/** 轮询立绘候选。沿用 `pages/ai-run` 的四选一交互，那套已经跑通 */
export async function GET(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    const { runId } = await context.params;
    return NextResponse.json({ data: await getAvatarRun(await requireUserId(request), runId) });
  } catch (error) {
    return routeError(error);
  }
}
