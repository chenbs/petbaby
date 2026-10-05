import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { deleteRecord } from "@/server/daily-log-service";
import { routeError } from "@/server/errors";

const idSchema = z.string().uuid();

/** 删一条记录。`?source=log|weight|care` 指明它来自哪张表（列表项里带着）。 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id, recordId } = await context.params;
    const userId = await requireUserId(request);
    const source = new URL(request.url).searchParams.get("source") || "log";
    return NextResponse.json({ data: await deleteRecord(userId, idSchema.parse(id), idSchema.parse(recordId), source) });
  } catch (error) { return routeError(error); }
}
