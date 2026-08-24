import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { copyWork } from "@/server/platform-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await copyWork(await requireUserId(request), z.string().uuid().parse(id)) }, { status: 201 }); }
  catch (error) { return routeError(error); }
}
