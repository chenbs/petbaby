import { NextResponse } from "next/server";
import { z } from "zod";
import { assertAdmin } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { routeError } from "@/server/errors";
import { listRuntimePluginVersions, rollbackRuntimePlugin, updateRuntimePlugin } from "@/plugins/runtime";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try { const userId = await requireUserId(request); assertAdmin(userId); const { id } = await context.params; return NextResponse.json({ data: await listRuntimePluginVersions(z.string().min(1).parse(id)) }); }
  catch (error) { return routeError(error); }
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const userId = await requireUserId(request); assertAdmin(userId); const { id } = await context.params; const body=z.object({manifest:z.unknown(),reason:z.string().trim().min(2).max(200)}).parse(await request.json()); return NextResponse.json({ data: await updateRuntimePlugin(z.string().min(1).parse(id), body.manifest, userId, body.reason) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try { assertTrustedMutation(request); const userId = await requireUserId(request); assertAdmin(userId); const { id } = await context.params; const body = z.object({ version: z.number().int().positive(),reason:z.string().trim().min(2).max(200) }).parse(await request.json()); return NextResponse.json({ data: await rollbackRuntimePlugin(z.string().min(1).parse(id), body.version, userId, body.reason) }); }
  catch (error) { return routeError(error); }
}
