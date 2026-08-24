import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { updatePhysicalOrderAddress } from "@/server/growth-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await updatePhysicalOrderAddress(await requireUserId(request), z.string().uuid().parse(id), await request.json()) }); } catch (error) { return routeError(error); } }
