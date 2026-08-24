import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createAvatarRun } from "@/server/island/avatar";
import { assertGenerationCircuit, clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 提交立绘生成，落 `ai_runs`，返回 runId。
 *
 * **走 `assertGenerationCircuit()`**（22 号文 6.3）：立绘是 `image-api` 调用，
 * 与其他 AI 图共享成本池，日成本熔断必须覆盖它。这与互动端点刚好相反 ——
 * 那条不进熔断，因为它的边际成本≈0。
 *
 * 额度是**独立的**（每宠 1 次 + 2 次重做），不占 `daily_quotas`：岛的形象额度用完
 * 不该影响做图，反之亦然。判定在 `createAvatarRun` 里按「这只宠物已起过几次任务」算。
 *
 * **本地/E2E 内联执行**：`DATABASE_URL` 为空或 `memory://` 时直接跑一轮 Worker，
 * 与 `POST /api/generations` 同一处理 —— 本地不起 Worker 也能走完全流程，
 * 这也是 Playwright 能同步看到结果的原因。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("island_avatar:user", userId, 6, 60),
      enforceRateLimit("island_avatar:ip", clientAddress(request), 20, 60),
      assertGenerationCircuit(),
    ]);
    const run = await createAvatarRun(userId, await request.json());
    if (!process.env.DATABASE_URL || process.env.DATABASE_URL === "memory://") {
      const { processNextAiRun } = await import("@/server/growth-service");
      await processNextAiRun();
    }
    return NextResponse.json({ data: run }, { status: 202 });
  } catch (error) {
    return routeError(error);
  }
}
