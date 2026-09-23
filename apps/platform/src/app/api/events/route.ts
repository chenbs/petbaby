import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { recordClientEvent } from "@/server/record-events";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    return NextResponse.json({ data: await recordClientEvent(await requireUserId(request), await request.json()) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
