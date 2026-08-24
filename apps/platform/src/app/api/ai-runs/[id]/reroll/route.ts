import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { rerollAiRun } from "@/server/growth-service";

const schema = z.object({ reason: z.enum(["owner-not-like", "pet-not-like", "too-animal", "composition"]).default("composition") });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await rerollAiRun(await requireUserId(request), z.string().uuid().parse(id), input.reason) });
  } catch (error) {
    return routeError(error);
  }
}
