import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { deleteWork, editWork, getWork } from "@/server/platform-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return NextResponse.json({ data: await getWork(await requireUserId(request), z.string().uuid().parse(id)) }); }
  catch (error) { return routeError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await editWork(await requireUserId(request), z.string().uuid().parse(id), await request.json()) }); }
  catch (error) { return routeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await deleteWork(await requireUserId(request), z.string().uuid().parse(id)) }); }
  catch (error) { return routeError(error); }
}
