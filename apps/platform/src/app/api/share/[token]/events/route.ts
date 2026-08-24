import { NextResponse } from "next/server";
import { z } from "zod";

import { routeError } from "@/server/errors";
import { recordShareAttribution } from "@/server/platform-service";

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const raw = await request.text();
    if (!raw) return new NextResponse(null, { status: 204 });
    const body = z.object({ eventName: z.enum(["visit", "duration"]), source: z.string().max(80).optional(), visitorKey: z.string().max(80), durationSeconds: z.number().nonnegative().max(86400).optional(), accessCode: z.string().max(8).optional() }).parse(JSON.parse(raw));
    await recordShareAttribution(token, body.eventName, body.source, body.visitorKey, body.durationSeconds, body.accessCode);
    return NextResponse.json({ data: { recorded: true } });
  } catch (error) { return routeError(error); }
}
