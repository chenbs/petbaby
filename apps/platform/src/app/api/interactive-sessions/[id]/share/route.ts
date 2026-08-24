import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { shareInteractiveSession } from "@/server/growth-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request); const { id } = await context.params; const body = await request.json().catch(() => ({}));
    return NextResponse.json({ data: await shareInteractiveSession(await requireUserId(request), z.string().uuid().parse(id), body) });
  } catch (error) { return routeError(error); }
}
