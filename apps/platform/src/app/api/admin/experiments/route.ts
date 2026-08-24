import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { createExperiment, listExperiments } from "@/server/growth-service";

const querySchema = z.object({
  pluginId: z.string().max(80).optional(),
  status: z.enum(["idea", "testing", "live", "archived"]).optional(),
  channel: z.enum(["all", "web", "miniprogram"]).optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
}).refine((value) => !value.from || !value.to || value.from <= value.to, { message: "开始日期不能晚于结束日期" });

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ data: await listExperiments(query) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    return NextResponse.json({ data: await createExperiment(await request.json(), userId) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}
