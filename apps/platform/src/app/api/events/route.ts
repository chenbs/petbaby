import { NextResponse } from "next/server";
import { z } from "zod";

import { routeError } from "@/server/errors";
import { recordEvent } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";

const inputSchema = z.object({
  name: z.string().min(1).max(80),
  pluginId: z.string().max(80).optional(),
  channel: z.string().max(80).optional(),
  metadata: z.record(z.string(), z.unknown()).default({}),
});

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const input = inputSchema.parse(await request.json());
    return NextResponse.json({ data: await recordEvent(await requireUserId(request), input.name, input.pluginId, input.channel, input.metadata) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
