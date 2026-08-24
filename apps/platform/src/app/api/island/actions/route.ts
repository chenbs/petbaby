import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { submitIslandAction } from "@/server/island-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * **唯一的互动写入口**：`{ type: gather | feed | pet }`。
 *
 * 不做 `/gather`、`/feed`、`/pet` 三条（22 号文 5.5）：这三个动作共用同一套额度校验、
 * 同一份亲密度累加、同一处文案门禁 —— 拆开等于把门禁复制三份，而门禁复制三份
 * 就一定会漏改一处（健康线的「两处都要」教训正是这个）。
 *
 * **限频单独给岛一个 scope**（5.5）：采集是高频点击行为，若与生成类共用 scope
 * 会把生成额度挤掉。取值比生成类宽得多 —— 这条路由是纯数据库读写、无模型调用，
 * 真正的每日上限在 `island_daily_actions`（服务端权威），限频只挡脚本。
 *
 * **不走 `assertGenerationCircuit()`**：那个熔断按图片生成的日成本算，
 * 而互动的边际成本≈0（6.2）。共用会让做图打满时把陪伴一起关掉。
 */
export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await Promise.all([
      enforceRateLimit("island_action:user", userId, 60, 60),
      enforceRateLimit("island_action:ip", clientAddress(request), 200, 60),
    ]);
    return NextResponse.json({ data: await submitIslandAction(userId, await request.json()) });
  } catch (error) {
    return routeError(error);
  }
}
