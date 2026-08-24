import { NextResponse } from "next/server";
import { routeError } from "@/server/errors";
import { recordShareAttribution } from "@/server/platform-service";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) { try { const { token } = await context.params; const query = new URL(request.url).searchParams; const source = query.get("source") || undefined; const code = query.get("code") || undefined; const work = await recordShareAttribution(token, "cta", source, undefined, undefined, code); return NextResponse.redirect(new URL(`/create/${work.pluginId}?ref=share&sourceWorkId=${work.id}`, request.url)); } catch (error) { return routeError(error); } }
