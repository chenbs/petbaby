import { NextResponse } from "next/server";
import { routeError } from "@/server/errors";
import { getPublicFunTestResult } from "@/server/fun-test-service";

export async function GET(_: Request, context: { params: Promise<{ token: string }> }) {
  try {
    const result = await getPublicFunTestResult((await context.params).token);
    return NextResponse.json({ data: result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return routeError(error); }
}
