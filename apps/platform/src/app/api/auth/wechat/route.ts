import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { exchangeWechatCode } from "@/server/auth/wechat";
import { getDatabase } from "@/server/db/client";
import { routeError } from "@/server/errors";

const inputSchema = z.object({ code: z.string().min(8).max(128) });

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    const identity = await exchangeWechatCode(input.code);
    const database = await getDatabase();
    const existing = await database.query<{ id: string }>("SELECT id FROM users WHERE wechat_openid = $1", [identity.openid]);
    const userId = existing[0]?.id || crypto.randomUUID();
    if (!existing.length) {
      await database.query("INSERT INTO users (id, wechat_openid, created_at) VALUES ($1, $2, $3)", [userId, identity.openid, new Date()]);
    }
    const sessionToken = await setSession(userId);
    return NextResponse.json({ data: { userId, sessionToken } });
  } catch (error) {
    return routeError(error);
  }
}
