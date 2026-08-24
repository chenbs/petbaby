import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { shareWork } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { z } from "zod";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const body = await request.json().catch(() => ({}));
    const options = z.object({ accessCode: z.string().regex(/^\d{4,8}$/).optional(), expiresInHours: z.number().int().min(1).max(8760).optional(), resetToken: z.boolean().optional() }).parse(body);
    return NextResponse.json({ data: await shareWork(await requireUserId(request), z.string().uuid().parse(id), options) });
  } catch (error) {
    return routeError(error);
  }
}
