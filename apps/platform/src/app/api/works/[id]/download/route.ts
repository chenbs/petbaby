import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUserId } from "@/server/auth/session";
import { routeError, AppError } from "@/server/errors";
import { getDownload } from "@/server/platform-service";
import { objectStorage } from "@/server/storage";
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) { try { const { id } = await context.params; const format = z.enum(["image", "pdf", "video"]).parse(new URL(request.url).searchParams.get("format") || "image"); const download = await getDownload(await requireUserId(request), z.string().uuid().parse(id), format); const object = await objectStorage.get(download.key); if (!object) throw new AppError("OUTPUT_NOT_FOUND", "作品文件不存在", 404); return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(download.filename)}`, "Cache-Control": "private, no-store" } }); } catch (error) { return routeError(error); } }
