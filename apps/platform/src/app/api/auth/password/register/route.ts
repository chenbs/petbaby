import { NextResponse } from "next/server";
import { z } from "zod";

import { registerWithPassword } from "@/server/auth/password";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { setSession } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { clientAddress, enforceRateLimit } from "@/server/risk/controls";

const inputSchema = z.object({
  accountName: z.string().min(3).max(32),
  password: z.string().min(10).max(72),
  displayName: z.string().max(40).optional(),
  inviteCode: z.string().max(64).optional(),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    await enforceRateLimit("auth:register", clientAddress(request), 10, 3600);
    const input = inputSchema.parse(await request.json());
    const account = await registerWithPassword(input);
    const sessionToken = await setSession(account.userId);
    return NextResponse.json({ data: { userId: account.userId, accountName: account.accountName, sessionToken } });
  } catch (error) {
    return routeError(error);
  }
}
