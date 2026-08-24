import { NextResponse } from "next/server";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { clearSession } from "@/server/auth/session";
import { routeError } from "@/server/errors";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    await clearSession();
    return NextResponse.json({ data: { ok: true } });
  } catch (error) {
    return routeError(error);
  }
}
