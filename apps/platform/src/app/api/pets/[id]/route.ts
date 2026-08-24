import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { deletePet, setDefaultPet, updatePet } from "@/server/platform-service";

const idSchema = z.string().uuid();

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await updatePet(await requireUserId(request), idSchema.parse(id), await request.json()) }); }
  catch (error) { return routeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await deletePet(await requireUserId(request), idSchema.parse(id)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await setDefaultPet(await requireUserId(request), idSchema.parse(id)) }); }
  catch (error) { return routeError(error); }
}
