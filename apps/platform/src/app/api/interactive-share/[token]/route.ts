import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { routeError } from "@/server/errors";
import { appendPublicInteractiveEvent, getPublicInteractiveSession } from "@/server/growth-service";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  try { const { token } = await context.params; return NextResponse.json({ data: await getPublicInteractiveSession(z.string().min(20).max(80).parse(token)) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  try { assertTrustedMutation(request); const { token } = await context.params; return NextResponse.json({ data: await appendPublicInteractiveEvent(z.string().min(20).max(80).parse(token), await request.json()) }, { status: 201 }); }
  catch (error) { return routeError(error); }
}
