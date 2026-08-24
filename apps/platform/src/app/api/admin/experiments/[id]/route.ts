import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getExperimentDetail, rollbackExperiment, updateExperiment } from "@/server/growth-service";

type Context = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: Context) {
  try {
    assertAdmin(await requireUserId(request));
    const { id } = await context.params;
    return NextResponse.json({ data: await getExperimentDetail(z.string().uuid().parse(id)) });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    const { id } = await context.params;
    return NextResponse.json({ data: await updateExperiment(z.string().uuid().parse(id), await request.json(), userId) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    const { id } = await context.params;
    const body = z.object({ action: z.literal("rollback"), reason: z.string().trim().min(2).max(200) }).parse(await request.json());
    return NextResponse.json({ data: await rollbackExperiment(z.string().uuid().parse(id), body.reason, userId) });
  } catch (error) {
    return routeError(error);
  }
}
