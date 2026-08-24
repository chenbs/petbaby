import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listPhotos, updatePhotoOrder } from "@/server/platform-service";
import { assertTrustedMutation } from "@/server/auth/request-guard";

export async function GET(request: Request) {
  try {
    const petId = z.string().uuid().optional().parse(new URL(request.url).searchParams.get("petId") || undefined);
    return NextResponse.json({ data: await listPhotos(await requireUserId(request), petId) });
  } catch (error) { return routeError(error); }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const body = z.object({ petId: z.string().uuid(), photoIds: z.array(z.string().uuid()).min(1) }).parse(await request.json());
    return NextResponse.json({ data: await updatePhotoOrder(await requireUserId(request), body.petId, body.photoIds) });
  } catch (error) { return routeError(error); }
}
