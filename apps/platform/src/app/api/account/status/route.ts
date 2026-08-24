import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getUserStatus } from "@/server/user-status-service";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await getUserStatus(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}
