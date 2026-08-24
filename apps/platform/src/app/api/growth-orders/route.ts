import { NextResponse } from "next/server"; import { requireUserId } from "@/server/auth/session"; import { routeError } from "@/server/errors"; import { listGrowthOrders } from "@/server/growth-service";
export async function GET(request: Request) { try { return NextResponse.json({ data: await listGrowthOrders(await requireUserId(request)) }); } catch (error) { return routeError(error); } }
