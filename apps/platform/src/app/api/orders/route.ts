import { NextResponse } from "next/server";
import { z } from "zod";

import { routeError } from "@/server/errors";
import { createOrder } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";

const inputSchema = z.object({ workId: z.string().min(1), sku: z.string().min(1).optional() });

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    return NextResponse.json({ data: await createOrder(await requireUserId(request), input.workId, input.sku) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
