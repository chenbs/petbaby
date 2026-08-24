import { NextResponse } from "next/server";
import { routeError } from "@/server/errors";
import { listVideoCatalog } from "@/server/video/service";

export async function GET() { try { return NextResponse.json({ data: await listVideoCatalog() }); } catch (error) { return routeError(error); } }
