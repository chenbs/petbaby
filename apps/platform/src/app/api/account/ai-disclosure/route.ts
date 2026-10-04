import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { acknowledgeAiDisclosure, getAiDisclosureStatus } from "@/server/ai-disclosure-service";
import { routeError } from "@/server/errors";

/** 生成内容标识义务：GET 查询是否已确认（附当前文案），POST 记录确认。 */
export async function GET(request: Request) {
  try { return NextResponse.json({ data: await getAiDisclosureStatus(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    const data = z.object({ channel: z.enum(["miniprogram", "web"]).default("miniprogram") }).parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await acknowledgeAiDisclosure(userId, data.channel) });
  } catch (error) { return routeError(error); }
}
