import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { deleteFunTestResult } from "@/server/fun-test-service";

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    return NextResponse.json({ data: await deleteFunTestResult(await requireUserId(request), z.uuid().parse((await context.params).id)) });
  } catch (error) { return routeError(error); }
}
