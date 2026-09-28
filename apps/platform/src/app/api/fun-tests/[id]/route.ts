import { NextResponse } from "next/server";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createFunTestResult, getFunTest } from "@/server/fun-test-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(_: Request, context: Context) {
  try { return NextResponse.json({ data: getFunTest((await context.params).id) }); }
  catch (error) { return routeError(error); }
}

export async function POST(request: Request, context: Context) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    const result = await createFunTestResult(userId, (await context.params).id, await request.json());
    return NextResponse.json({ data: result }, { status: 201 });
  } catch (error) { return routeError(error); }
}
