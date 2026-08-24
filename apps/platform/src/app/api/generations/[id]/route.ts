import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { getGeneration } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { z } from "zod";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await getGeneration(await requireUserId(request), z.string().uuid().parse(id)) });
  } catch (error) {
    return routeError(error);
  }
}
