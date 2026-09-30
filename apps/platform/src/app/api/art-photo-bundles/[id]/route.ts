import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getArtPhotoBundle } from "@/server/art-photo-bundle-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await getArtPhotoBundle(await requireUserId(request), id) });
  } catch (error) { return routeError(error); }
}
