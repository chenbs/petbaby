import { NextResponse } from "next/server";
import { z } from "zod";

import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { deleteCare } from "@/server/health-service";

const idSchema = z.string().uuid();

/** 删一条免疫 / 驱虫记录。填错日期的记录会一直触发到期提示，必须能删。 */
export async function DELETE(request: Request, context: { params: Promise<{ id: string; recordId: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id, recordId } = await context.params;
    const userId = await requireUserId(request);
    return NextResponse.json({ data: await deleteCare(userId, idSchema.parse(id), idSchema.parse(recordId)) });
  } catch (error) { return routeError(error); }
}
