import { NextResponse } from "next/server";
import { routeError } from "@/server/errors";
import { recordShareAttribution } from "@/server/platform-service";
export async function GET(request: Request, context: { params: Promise<{ token: string }> }) { try { const { token } = await context.params; const query = new URL(request.url).searchParams; const source = query.get("source") || undefined; const code = query.get("code") || undefined; const work = await recordShareAttribution(token, "cta", source, undefined, undefined, code); // 小程序落地页用 format=json 记一次转化，不跟随网页跳转。
  if (query.get("format") === "json") return NextResponse.json({ data: { recorded: true, pluginId: work.pluginId } });
  return NextResponse.redirect(new URL(`/create/${work.pluginId}?ref=share&sourceWorkId=${work.id}`, request.url)); } catch (error) { return routeError(error); } }
