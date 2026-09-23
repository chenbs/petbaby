import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { updateBatchPhotoMetadata } from "@/server/photo-library-service";
import { enforceRateLimit } from "@/server/risk/controls";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    await enforceRateLimit("photo-metadata", userId, 60, 60);
    const { id } = await context.params;
    return NextResponse.json({ data: await updateBatchPhotoMetadata(userId, z.string().uuid().parse(id), await request.json()) });
  } catch (error) { return routeError(error); }
}
