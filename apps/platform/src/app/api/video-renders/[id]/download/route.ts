import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getVideoRender } from "@/server/video/service";
import { objectStorage } from "@/server/storage";
import { getDatabase } from "@/server/db/client";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const row = await getVideoRender(await requireUserId(request), id);
    if (!["ready", "preview_ready"].includes(String(row.status))) throw new AppError("VIDEO_NOT_READY", "视频尚未生成完成", 409);
    /*
     * 关联作品仍锁定（未付费）时只给预览，不能凭 render id 绕过作品付费墙直接拿正式 MP4。
     * 没有关联作品的渲染（历史数据）沿用原口径。
     */
    const workId = row.work_id || row.project_work_id;
    const locked = workId ? Boolean((await (await getDatabase()).query("SELECT locked FROM works WHERE id=$1 AND user_id=$2", [workId, row.user_id]))[0]?.locked ?? true) : false;
    const key = String(row.status) === "ready" && !locked ? row.output_key : row.preview_key || (locked ? undefined : row.output_key);
    if (!key) throw new AppError("VIDEO_NOT_FOUND", "视频文件不存在", 404);
    const object = await objectStorage.get(String(key));
    if (!object) throw new AppError("VIDEO_NOT_FOUND", "视频文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": "video/mp4", "Content-Disposition": `attachment; filename=petbaby-${id}.mp4` } });
  } catch (error) { return routeError(error); }
}
