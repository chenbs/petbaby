import { NextResponse } from "next/server";
import { AppError, routeError } from "@/server/errors";
import { processNextVideo } from "@/server/video/ffmpeg";
export async function POST(request: Request) { try { const secret = process.env.WORKER_SECRET; if (!secret || request.headers.get("authorization") !== `Bearer ${secret}`) throw new AppError("NOT_FOUND", "页面不存在", 404); return NextResponse.json({ data: await processNextVideo() }); } catch (error) { return routeError(error); } }
