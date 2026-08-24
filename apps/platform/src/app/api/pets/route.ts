import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { createPet, listPets } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";

export async function GET(request: Request) {
  try {
    return NextResponse.json({ data: await listPets(await requireUserId(request)) });
  } catch (error) { return routeError(error); }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const pet = await createPet(await requireUserId(request), await request.json());
    return NextResponse.json({ data: pet }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
