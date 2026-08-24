import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { cancelAiRun, getAiRun, retryAiRun, selectAiCandidate } from "@/server/growth-service";
import { assertTrustedMutation } from "@/server/auth/request-guard";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const {id}=await context.params; return NextResponse.json({data:await getAiRun(await requireUserId(request),z.string().uuid().parse(id))}); } catch(error){return routeError(error);} }
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params; const runId = z.string().uuid().parse(id); const userId = await requireUserId(request);
    const input = z.union([
      z.object({ action: z.literal("select"), candidateId: z.string().min(1) }),
      z.object({ action: z.literal("retry") }),
      z.object({ action: z.literal("cancel") }),
      z.object({ candidateId: z.string().min(1) }),
    ]).parse(await request.json());
    if ("candidateId" in input) return NextResponse.json({ data: await selectAiCandidate(userId, runId, input.candidateId) });
    if (input.action === "retry") return NextResponse.json({ data: await retryAiRun(userId, runId) });
    return NextResponse.json({ data: await cancelAiRun(userId, runId) });
  } catch (error) { return routeError(error); }
}
