import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getHomeCuration, updateHomeCuration } from "@/server/home-curation-service";

export async function GET(request: Request) {
  try { assertAdmin(await requireUserId(request)); return NextResponse.json({ data: await getHomeCuration() }); }
  catch (error) { return routeError(error); }
}

/** 更新麻麻精选：版本号自增并写管理审计。 */
export async function PUT(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    const body = z.object({ config: z.unknown(), reason: z.string().trim().min(2).max(200) }).parse(await request.json());
    return NextResponse.json({ data: await updateHomeCuration(userId, body.config, body.reason) });
  } catch (error) { return routeError(error); }
}
