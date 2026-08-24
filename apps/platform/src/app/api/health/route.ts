import { NextResponse } from "next/server";
import { routeError } from "@/server/errors";
import { healthSnapshot } from "@/server/maintenance";
export async function GET() { try { const health = await healthSnapshot(); return NextResponse.json(health, { status: health.status === "ok" ? 200 : 503 }); } catch (error) { return routeError(error); } }
