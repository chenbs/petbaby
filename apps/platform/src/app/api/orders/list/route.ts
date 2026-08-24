import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { listOrders } from "@/server/platform-service";
export async function GET(request: Request) { try { return NextResponse.json({ data: await listOrders(await requireUserId(request)) }); } catch (error) { return routeError(error); } }
