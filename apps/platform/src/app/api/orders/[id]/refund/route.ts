import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { requestRefund } from "@/server/platform-service";
const schema = z.object({ reason: z.enum(["generation_failed", "dissatisfied"]) });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const { id } = await context.params; const input = schema.parse(await request.json()); return NextResponse.json({ data: await requestRefund(await requireUserId(request), z.string().uuid().parse(id), input.reason) }); } catch (error) { return routeError(error); } }
