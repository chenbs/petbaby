import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { ensureIsland, getIslandSnapshot, listIslandCandidates } from "@/server/island-service";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

/**
 * 岛全量快照与建岛。
 *
 * 素材地址要绝对域名：小程序 `<image src>` 与 `wx.downloadFile` 遇到以 `/` 开头的值
 * 会当主包内本地文件找，必然裂图且不报错（CLAUDE.md 已记录）。域名复用既有的
 * `PUBLIC_APP_URL`，与 `/api/plugins` 的 `absolutize` 同一处理 —— 它已被
 * `deploy/scripts/preflight.sh` 列为必填并校验 HTTPS，另起一个变量只会多一个漏配开关。
 */
function originOf(request: Request) {
  const configured = process.env.PUBLIC_APP_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(request.url).origin;
}

export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    /*
     * 岛不存在时返回可选宠物列表而不是 404：端上首次进入要先选宠物，
     * 而「先 404 再让端上另发一次请求拿列表」是两次往返。
     *
     * 列表**过滤掉 memorial**（1.4 / 4.1 #11）—— 服务端拦 + 端上列表过滤两处都要，
     * 这里是服务端那一半的读取侧。
     */
    const url = new URL(request.url);
    if (url.searchParams.get("candidates") === "1") {
      return NextResponse.json({ data: { candidates: await listIslandCandidates(userId) } });
    }
    /*
     * `petId` 是端上从宠物档案的操作行带来的（`island/service.js` 的 `loadIsland`）。
     * **必须读它** —— 端上那一半早就在传，服务端原先只认 `candidates` 参数，
     * 于是这个值被静默丢弃，表现是「点第二只宠物看到第一只」（CLAUDE.md 点名的那条）。
     * 非法值不报错，交给 `loadIslandPet` 当「没有匹配」处理：这是展示优先项，
     * 不是权限判断（归属仍由 `island_id` + `user_id` 锁定）。
     */
    return NextResponse.json({
      data: await getIslandSnapshot(userId, originOf(request), new Date(), url.searchParams.get("petId") || undefined),
    });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    /*
     * 建岛限频给得宽松：它是幂等的（`ON CONFLICT DO NOTHING`），重复调用不产生副作用，
     * 而端上首屏「拉不到就建一次再拉」的重试路径会正常触发它。
     */
    await Promise.all([
      enforceRateLimit("island_action:user", userId, 60, 60),
      enforceRateLimit("island_action:ip", clientAddress(request), 200, 60),
    ]);
    await ensureIsland(userId);
    return NextResponse.json({ data: await getIslandSnapshot(userId, originOf(request)) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
