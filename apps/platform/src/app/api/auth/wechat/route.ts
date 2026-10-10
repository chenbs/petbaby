import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { exchangeWechatCode } from "@/server/auth/wechat";
import { signInWechatUser } from "@/server/auth/wechat-account";
import { routeError } from "@/server/errors";

const inputSchema = z.object({ code: z.string().min(8).max(128) });

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    const identity = await exchangeWechatCode(input.code);
    const userId = await signInWechatUser(identity);
    const sessionToken = await setSession(userId);
    return NextResponse.json({ data: { userId, sessionToken } });
  } catch (error) {
    return routeError(error);
  }
}
