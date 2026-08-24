import { z } from "zod";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getHealthDocumentFile } from "@/server/health-service";

const idSchema = z.string().uuid();

/**
 * 下载健康档案 PDF。
 *
 * **不可分享**：健康线的产出是私密记录，没有公开分享路径
 * （对比 `works` 的 `/share/[token]`）。只有本人能下载，
 * 且服务端会校验 key 落在该用户的私有前缀下。
 */
export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const file = await getHealthDocumentFile(await requireUserId(request), idSchema.parse(id));
    return new Response(new Uint8Array(file.body), {
      headers: {
        "Content-Type": file.contentType,
        "Content-Disposition": `attachment; filename="${file.filename}"`,
        // 私密文件不进任何缓存
        "Cache-Control": "private, no-store",
      },
    });
  } catch (error) { return routeError(error); }
}
