import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { requestRefund } from "@/server/platform-service";
// 冻干上线后取消「效果不满意退款」（36 号文 D5）；这条只剩冻干上线前的历史现金订单在用。
const schema = z.object({ reason: z.enum(["generation_failed", "requested"]).default("requested") });
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const { id } = await context.params; const input = schema.parse(await request.json()); return NextResponse.json({ data: await requestRefund(await requireUserId(request), z.string().uuid().parse(id), input.reason) }); } catch (error) { return routeError(error); } }
