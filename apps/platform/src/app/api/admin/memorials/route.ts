import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listMemorialAdmin, mutateMemorialAdmin, updateMemorialCatalog } from "@/server/memorial-service";

const querySchema = z.object({
  lifecycle: z.enum(["active", "hidden", "restored"]).optional(),
  visibility: z.enum(["private", "shared"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ data: await listMemorialAdmin(query) });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    return NextResponse.json({ data: await updateMemorialCatalog(userId, await request.json()) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    return NextResponse.json({ data: await mutateMemorialAdmin(userId, await request.json()) });
  } catch (error) {
    return routeError(error);
  }
}
