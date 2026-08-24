import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getPetTimeline } from "@/server/timeline-service";

const idSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const data = await getPetTimeline(await requireUserId(request), idSchema.parse(id), {
      order: url.searchParams.get("order") || undefined,
      limit: limit ? Number(limit) : undefined,
    });
    return NextResponse.json({ data });
  } catch (error) { return routeError(error); }
}
