import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { revokeAnnualReport, shareAnnualReport, unlockAnnualReport } from "@/server/growth-service";

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request); const userId = await requireUserId(request); const { id } = await context.params;
    const { action } = z.object({ action: z.enum(["unlock", "share", "revoke"]) }).parse(await request.json());
    const data = action === "unlock" ? await unlockAnnualReport(userId, id) : action === "share" ? await shareAnnualReport(userId, id) : await revokeAnnualReport(userId, id);
    return NextResponse.json({ data });
  } catch (error) { return routeError(error); }
}
