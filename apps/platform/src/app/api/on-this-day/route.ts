import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { findOnThisDay, onThisDayConsentState } from "@/server/timeline-service";

/**
 * 去年今日。命中才有内容，没命中 `matches` 为空数组 ——
 * 端上据此静默隐藏整个区块，不要硬凑一条「今天没有回忆」出来。
 *
 * `pushConsented` 与内容是**两件独立的事**（改造项 E2）：
 * 命中的回忆一律展示（那是用户自己的照片），授权只决定明年这天是否推送提醒。
 * 把两者绑在一起会让未授权用户连自己的回忆都看不到。
 */
export async function GET(request: Request) {
  try {
    const userId = await requireUserId(request);
    const [matches, consent] = await Promise.all([findOnThisDay(userId), onThisDayConsentState(userId)]);
    return NextResponse.json({ data: { matches, pushConsented: consent.consented } });
  } catch (error) { return routeError(error); }
}
