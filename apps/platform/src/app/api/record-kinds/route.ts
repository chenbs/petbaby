import { NextResponse } from "next/server";

import { listRecordKinds } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";

/** 日常记录的类型与表单字段清单。端上按它渲染表单，选项文案只在服务端维护一份。 */
export async function GET() {
  try {
    return NextResponse.json({ data: listRecordKinds() }, { headers: { "Cache-Control": "public, max-age=300" } });
  } catch (error) { return routeError(error); }
}
