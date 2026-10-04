import { NextResponse } from "next/server";

import { routeError } from "@/server/errors";
import { getHomeCuration } from "@/server/home-curation-service";

/** 首页「麻麻精选」配置（公开只读）。表为空时返回默认值，端上另有内置兜底。 */
export async function GET() {
  try { return NextResponse.json({ data: await getHomeCuration() }, { headers: { "Cache-Control": "public, max-age=300" } }); }
  catch (error) { return routeError(error); }
}
