import { NextResponse } from "next/server";

import { routeError, AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

/**
 * 玩法样例图：公开只读，无需登录。
 *
 * 不复用 /api/media —— 那条路由的放行条件是「归属当前用户或所属作品已公开」，
 * 而样例图不挂在任何 photo / pet / work 上，走那里必然 404。
 * 单开一条路由也让「这批对象是公开资产」这件事显式可审计，
 * 而不是在鉴权分支里塞一个容易被后人误改的例外。
 *
 * 前缀锁死在 samples/：仅此目录公开，避免路径拼接把私有对象带出去。
 */
const SAMPLE_PREFIX = "samples/";

export async function GET(_request: Request, context: { params: Promise<{ key: string[] }> }) {
  try {
    const { key: segments } = await context.params;
    const key = segments.join("/");
    // 与 LocalObjectStorage.safePath 同一套字符白名单，顺带挡掉 ../ 穿越
    if (!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(key)) throw new AppError("SAMPLE_NOT_FOUND", "样例图不存在", 404);
    if (!key.startsWith(SAMPLE_PREFIX) || key.includes("..")) throw new AppError("SAMPLE_NOT_FOUND", "样例图不存在", 404);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("SAMPLE_NOT_FOUND", "样例图不存在", 404);
    return new NextResponse(Buffer.from(object.body), {
      headers: {
        "Content-Type": object.contentType,
        // 样例图内容固定、改动走换名，可长缓存
        "Cache-Control": "public, max-age=31536000, immutable",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
