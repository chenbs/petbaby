import { NextResponse } from "next/server";
import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getPetTimeline, pickGrowthPair } from "@/server/timeline-service";

const idSchema = z.string().uuid();

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const limit = url.searchParams.get("limit");
    const userId = await requireUserId(request);
    const data = await getPetTimeline(userId, idSchema.parse(id), {
      order: url.searchParams.get("order") || undefined,
      limit: limit ? Number(limit) : undefined,
      pageSize: url.searchParams.has("pageSize") ? Number(url.searchParams.get("pageSize")) : undefined,
      cursor: url.searchParams.get("cursor") || undefined,
    });
    const growthPair = url.searchParams.get("includePair") === "1" ? await pickGrowthPair(userId, id) : undefined;
    return NextResponse.json({ data: { ...data, ...(url.searchParams.get("includePair") === "1" ? { growthPair: growthPair || null } : {}) } }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
