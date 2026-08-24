import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listVideoCatalog, listVideoRendersForAdmin, mutateVideoCatalog, mutateVideoRenderForAdmin, updateVideoCatalog } from "@/server/video/service";

const querySchema = z.object({
  status: z.enum(["queued", "processing", "preview_ready", "ready", "failed", "cancelled", "retried"]).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const [catalog, renders] = await Promise.all([listVideoCatalog(), listVideoRendersForAdmin(query)]);
    return NextResponse.json({ data: { catalog, renders, page: query.page, pageSize: query.pageSize } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    return NextResponse.json({ data: await updateVideoCatalog(userId, await request.json()) }, { status: 201 });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const userId = await requireUserId(request);
    assertAdmin(userId);
    const body = z.record(z.string(), z.unknown()).parse(await request.json());
    const result = body.resource === "render" ? await mutateVideoRenderForAdmin(userId, body) : await mutateVideoCatalog(userId, body);
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
