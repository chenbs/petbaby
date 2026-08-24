import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { assertAdmin } from "@/server/auth/admin";
import { routeError } from "@/server/errors";
import { inspectConfiguration } from "@/server/config";
export async function GET(request: Request) { try { const userId = await requireUserId(request); assertAdmin(userId); return NextResponse.json({ data: inspectConfiguration() }); } catch (error) { return routeError(error); } }
