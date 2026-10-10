import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listTopupPackages } from "@/server/wallet/topup";

/** 充值档（含新人首充资格与「多送 N%」「约 N 折」「够做 N 张写真」文案所需的数字）。 */
export async function GET(request: Request) {
  try {
    return NextResponse.json({ data: await listTopupPackages(await requireUserId(request)) }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return routeError(error); }
}
