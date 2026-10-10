import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { rerollAiRun } from "@/server/growth-service";

/** 「再拍一张」是新任务、重新扣冻干；idempotencyKey 防止连点扣两次。 */
const schema = z.object({ reason: z.enum(["owner-not-like", "pet-not-like", "too-animal", "composition"]).default("composition"), idempotencyKey: z.string().min(8).max(120).optional() });

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    const input = schema.parse(await request.json().catch(() => ({})));
    return NextResponse.json({ data: await rerollAiRun(await requireUserId(request), z.string().uuid().parse(id), input.reason, input.idempotencyKey) });
  } catch (error) {
    return routeError(error);
  }
}
