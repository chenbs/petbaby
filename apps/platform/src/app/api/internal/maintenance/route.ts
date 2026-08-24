import { NextResponse } from "next/server";
import { AppError, routeError } from "@/server/errors";
import { cleanupExpiredContent, closeExpiredOrders } from "@/server/maintenance";
export async function POST(request: Request) { try { const secret = process.env.WORKER_SECRET; if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new AppError("NOT_FOUND", "页面不存在", 404); const [orders, cleanup] = await Promise.all([closeExpiredOrders(), cleanupExpiredContent()]); return NextResponse.json({ data: { orders, ...cleanup } }); } catch (error) { return routeError(error); } }
