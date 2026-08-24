import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getVideoRender } from "@/server/video/service";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const row = await getVideoRender(await requireUserId(request), id);
    if (!["ready", "preview_ready"].includes(String(row.status))) throw new AppError("VIDEO_NOT_READY", "视频尚未生成完成", 409);
    const key = String(row.status) === "ready" ? row.output_key : row.preview_key || row.output_key;
    if (!key) throw new AppError("VIDEO_NOT_FOUND", "视频文件不存在", 404);
    const object = await objectStorage.get(String(key));
    if (!object) throw new AppError("VIDEO_NOT_FOUND", "视频文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename=petbaby-${id}.mp4` } });
  } catch (error) { return routeError(error); }
}
