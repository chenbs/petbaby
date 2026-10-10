import { NextResponse } from "next/server";
import { z } from "zod";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { unlockWork } from "@/server/platform-service";

/**
 * 用冻干解锁一件冻干上线前遗留的锁定作品（新作品入库即正式版，不会走到这里）。
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertTrustedMutation(request);
    const { id } = await context.params;
    return NextResponse.json({ data: await unlockWork(await requireUserId(request), z.string().uuid().parse(id)) });
  } catch (error) { return routeError(error); }
}
