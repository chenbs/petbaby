import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { exchangeWechatCode } from "@/server/auth/wechat";
import { signInWechatUser } from "@/server/auth/wechat-account";
import { routeError } from "@/server/errors";

/*
 * scene / src / inviteCode 是小程序冷启动参数，只在新建账号时用于渠道归因（迁移 0044）。
 * 三者都是可选且宽进：格式不对就丢弃，不能因为归因字段挡住登录。
 */
const inputSchema = z.object({
  code: z.string().min(8).max(128),
  scene: z.coerce.number().int().positive().max(99_999).optional().catch(undefined),
  src: z.string().max(64).optional().catch(undefined),
  inviteCode: z.string().max(16).optional().catch(undefined),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    const identity = await exchangeWechatCode(input.code);
    const userId = await signInWechatUser(identity, { scene: input.scene, src: input.src, inviteCode: input.inviteCode });
    const sessionToken = await setSession(userId);
    return NextResponse.json({ data: { userId, sessionToken } });
  } catch (error) {
    return routeError(error);
  }
}
