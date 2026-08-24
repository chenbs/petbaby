import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { exportAccountData } from "@/server/account-service";
export async function GET(request: Request) { try { const data = await exportAccountData(await requireUserId(request)); return new NextResponse(JSON.stringify(data, null, 2), { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": "attachment; filename=petbaby-account-export.json", "Cache-Control": "no-store" } }); } catch (error) { return routeError(error); } }
