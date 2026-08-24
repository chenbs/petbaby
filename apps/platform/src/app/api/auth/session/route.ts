import { NextResponse } from "next/server";

import { passwordAuthEnabled } from "@/server/auth/password";
import { getOptionalUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const userId = await getOptionalUserId(request);
    return NextResponse.json({
      data: {
        userId,
        authenticated: Boolean(userId),
        passwordAuth: { enabled: passwordAuthEnabled(), inviteRequired: Boolean(process.env.PASSWORD_AUTH_INVITE_CODE?.trim()) },
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
