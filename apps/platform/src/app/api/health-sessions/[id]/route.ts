import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getHealthSession } from "@/server/health-service";

const idSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json({ data: await getHealthSession(await requireUserId(request), idSchema.parse(id)) });
  } catch (error) { return routeError(error); }
}
