import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { renderVideoProject } from "@/server/video/service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) { try { assertTrustedMutation(request); const { id } = await context.params; return NextResponse.json({ data: await renderVideoProject(await requireUserId(request), z.string().uuid().parse(id)) }); } catch (error) { return routeError(error); } }
