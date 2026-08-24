import { NextResponse } from "next/server";
import QRCode from "qrcode";

import { routeError } from "@/server/errors";
import { getSharedWork } from "@/server/platform-service";
import { createMiniProgramScheme } from "@/server/wechat/scheme";

export async function GET(request: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const { token } = await context.params;
    const code = new URL(request.url).searchParams.get("code") || undefined;
    const work = await getSharedWork(token, code);
    const target = await createMiniProgramScheme(work.pluginId, work.id);
    const svg = await QRCode.toString(target.startsWith("/") ? new URL(target, request.url).toString() : target, { type: "svg", margin: 1, color: { dark: "#14251c", light: "#fffef9" } });
    return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
