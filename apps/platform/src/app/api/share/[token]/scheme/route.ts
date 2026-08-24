import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { getSharedWork } from "@/server/platform-service";
import { createMiniProgramScheme } from "@/server/wechat/scheme";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try { const { token } = await context.params; const code = new URL(request.url).searchParams.get("code") || undefined; const work = await getSharedWork(token, code); return NextResponse.json({ data: { url: await createMiniProgramScheme(work.pluginId, work.id) } }); }
  catch (error) { return routeError(error); }
}
