import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listWorkVersions, restoreWorkVersion } from "@/server/platform-service";
import { assertTrustedMutation } from "@/server/auth/request-guard";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; return NextResponse.json({ data: await listWorkVersions(await requireUserId(request), z.string().uuid().parse(id)) }); } catch (error) { return routeError(error); } }

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const { id } = await context.params; const body = z.object({ versionId: z.string().uuid() }).parse(await request.json()); return NextResponse.json({ data: await restoreWorkVersion(await requireUserId(request), z.string().uuid().parse(id), body.versionId) }); } catch (error) { return routeError(error); } }
