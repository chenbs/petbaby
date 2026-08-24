import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listIslandDiary } from "@/server/island-service";

/**
 * 岛日记翻阅，分页。
 *
 * 日记是**模板拼装不用大模型**（22 号文 4.2），所以这条路由只做渲染 —— 库里存的是
 * `template_id` + `payload`，成品文案在读取侧生成。这样模板改了措辞之后历史日记
 * 会跟着修正，而存成品会把违规文案永久固化在库里。
 *
 * 游标是日期串而不是 offset：日记一天一条，中间补进一条离线日记不会让翻页错位。
 */
export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    return NextResponse.json({
      data: await listIslandDiary(await requireUserId(request), {
        cursor: url.searchParams.get("cursor") || undefined,
        limit: url.searchParams.get("limit") || undefined,
      }),
    });
  } catch (error) {
    return routeError(error);
  }
}
