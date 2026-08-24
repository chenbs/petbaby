import { NextResponse } from "next/server";

import { listWorks } from "@/server/platform-service";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { z } from "zod";

export async function GET(request: Request) {
  try {
    const query = z.object({ petId: z.string().uuid().optional(), pluginId: z.string().optional(), locked: z.enum(["true", "false"]).transform((value) => value === "true").optional() }).parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ data: await listWorks(await requireUserId(request), query) });
  }
  catch (error) { return routeError(error); }
}
