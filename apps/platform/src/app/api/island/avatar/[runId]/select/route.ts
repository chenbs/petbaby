import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { adoptAvatarCandidate } from "@/server/island/avatar";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 选定候选 → 抠透明底 → 打 AI 标识 → 写 `island_pets.avatar_key` 并入岛。
 *
 * **用户确认后才入岛**（22 号文 2.6），所以入岛发生在这一步而不是任务成功时。
 * 抠图与打标的顺序不能换（先打标再抠会把标识底衬当前景留成一个方块），
 * 依据在 `server/island/avatar.ts` 的 `adoptAvatarCandidate` 注释里。
 */
export async function POST(request: Request, context: { params: Promise<{ runId: string }> }) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    const { runId } = await context.params;
    await Promise.all([
      enforceRateLimit("island_avatar:user", userId, 20, 60),
      enforceRateLimit("island_avatar:ip", clientAddress(request), 60, 60),
    ]);
    return NextResponse.json({ data: await adoptAvatarCandidate(userId, runId, await request.json()) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
