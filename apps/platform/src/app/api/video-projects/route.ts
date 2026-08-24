import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createVideoProject, listVideoProjects } from "@/server/video/service";

export async function GET(request: Request) { try { return NextResponse.json({ data: await listVideoProjects(await requireUserId(request)) }); } catch (error) { return routeError(error); } }
export async function POST(request: Request) { try { assertTrustedMutation(request); return NextResponse.json({ data: await createVideoProject(await requireUserId(request), await request.json()) }, { status: 201 }); } catch (error) { return routeError(error); } }
