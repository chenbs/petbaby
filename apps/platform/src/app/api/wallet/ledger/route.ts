import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listWalletLedger } from "@/server/wallet/service";

/** 收支明细，按时间倒序、游标分页（before 取上一页返回的 nextCursor）。 */
export async function GET(request: Request) {
  try {
    const query = z.object({ before: z.string().uuid().optional(), limit: z.coerce.number().int().min(1).max(50).optional() }).parse(Object.fromEntries(new URL(request.url).searchParams));
    return NextResponse.json({ data: await listWalletLedger(await requireUserId(request), query) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
