import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listMyFunTestResults } from "@/server/fun-test-service";

export async function GET(request: Request) {
  try { return NextResponse.json({ data: await listMyFunTestResults(await requireUserId(request)) }); }
  catch (error) { return routeError(error); }
}
