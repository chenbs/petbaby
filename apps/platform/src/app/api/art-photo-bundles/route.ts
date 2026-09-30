import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createArtPhotoBundle, listArtPhotoBundles } from "@/server/art-photo-bundle-service";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await listArtPhotoBundles(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    return NextResponse.json({ data: await createArtPhotoBundle(await requireUserId(request), await request.json()) }, { status: 201 });
  } catch (error) { return routeError(error); }
}
