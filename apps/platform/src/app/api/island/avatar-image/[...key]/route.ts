import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getAvatarFile } from "@/server/island/avatar";

/**
 * 取已选定的立绘字节（透明底 PNG，已带 AI 标识）。
 *
 * 不复用 `/api/media`：那条路由的放行条件是「归属当前用户或所属作品已公开」，
 * 而立绘不挂在任何 photo / pet / work 上（岛不产出 `works`，8.2），走那里必然 404。
 *
 * 字符白名单与前缀校验都要：键由服务端拼，但这条路径吃 URL 参数 ——
 * 与 `/api/plugin-samples` 同一处理（挡掉 `../` 穿越）。
 */
export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    const userId = await requireUserId(request);
    const { key: segments } = await context.params;
    const key = segments.join("/");
    if (!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(key) || key.includes("..")) {
      throw new AppError("ISLAND_AVATAR_FILE_MISSING", "形象文件不存在", 404);
    }
    const file = await getAvatarFile(userId, key);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        /*
         * 键里带 runId，换形象即换键，所以可以长缓存。
         * 但仍是 `private` —— 立绘是用户自家宠物的形象，不能进共享缓存。
         */
        "Cache-Control": "private, max-age=86400",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
