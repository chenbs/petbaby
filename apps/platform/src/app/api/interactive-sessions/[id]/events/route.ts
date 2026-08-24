import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { appendInteractiveEvent, listInteractiveEvents } from "@/server/growth-service";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const { id } = await context.params; return NextResponse.json({ data: await listInteractiveEvents(await requireUserId(request), z.string().uuid().parse(id)) }); } catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await appendInteractiveEvent(await requireUserId(request), z.string().uuid().parse(id), await request.json()) }, { status: 201 }); } catch (error) { return routeError(error); }
}
