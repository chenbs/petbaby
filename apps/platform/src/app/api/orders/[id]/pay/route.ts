import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { payOrder } from "@/server/platform-service";
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
    return NextResponse.json({ data: await payOrder(await requireUserId(request), z.string().uuid().parse(id)) });
  } catch (error) {
    return routeError(error);
  }
}
