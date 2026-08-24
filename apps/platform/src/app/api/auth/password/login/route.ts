import { NextResponse } from "next/server";
import { z } from "zod";

import { loginWithPassword } from "@/server/auth/password";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

const inputSchema = z.object({ accountName: z.string().min(3).max(32), password: z.string().min(1).max(72) });

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    await Promise.all([
      enforceRateLimit("auth:login:ip", clientAddress(request), 30, 600),
      enforceRateLimit("auth:login:account", input.accountName.trim().toLowerCase(), 10, 600),
    ]);
    const account = await loginWithPassword(input);
    const sessionToken = await setSession(account.userId);
    return NextResponse.json({ data: { userId: account.userId, accountName: account.accountName, sessionToken } });
  } catch (error) {
    return routeError(error);
  }
}
