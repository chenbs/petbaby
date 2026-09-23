import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { deletePhoto } from "@/server/platform-service";
import { routeError } from "@/server/errors";
import { getPhoto, updatePhotoMetadata } from "@/server/photo-library-service";
import { enforceRateLimit } from "@/server/risk/controls";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(request);
    const { id } = await context.params;
    return NextResponse.json({ data: await getPhoto(userId, z.string().uuid().parse(id)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await enforceRateLimit("photo-metadata", userId, 60, 60);
    const { id } = await context.params;
    return NextResponse.json({ data: await updatePhotoMetadata(userId, z.string().uuid().parse(id), await request.json()) });
  } catch (error) { return routeError(error); }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await deletePhoto(await requireUserId(request), z.string().uuid().parse(id)) }); }
  catch (error) { return routeError(error); }
}
