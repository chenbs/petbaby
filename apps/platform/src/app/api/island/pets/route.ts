import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { joinIslandPet } from "@/server/island-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 宠物入岛。
 *
 * **服务端拦 `memorial`**（22 号文 1.4 / 4.1 #11），在 `joinIslandPet` 里。
 * 端上列表过滤是另一半（`island/service.js` 的 `selectablePets`）—— **两处都要**：
 * 只做端上隐藏则接口仍可调，只做服务端拦截则用户会看到入口点进去报错。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("island_action:user", userId, 60, 60),
      enforceRateLimit("island_action:ip", clientAddress(request), 200, 60),
    ]);
    return NextResponse.json({ data: await joinIslandPet(userId, await request.json()) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
