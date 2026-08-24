import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { recordMembershipRenewal, refundMembership } from "@/server/growth-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const userId=await requireUserId(request);const{id}=await context.params;const body=z.object({action:z.enum(["renewal","refund"]),succeeded:z.boolean().optional()}).parse(await request.json());return NextResponse.json({data:body.action==="refund"?await refundMembership(userId,id):await recordMembershipRenewal(userId,id,{succeeded:body.succeeded??false})});}catch(error){return routeError(error);} }
