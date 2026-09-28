import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { startFunTest } from "@/server/fun-test-service";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    return NextResponse.json({ data: await startFunTest(await requireUserId(request), (await context.params).id) });
  } catch (error) { return routeError(error); }
}
