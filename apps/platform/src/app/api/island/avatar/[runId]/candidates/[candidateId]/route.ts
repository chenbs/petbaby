import { NextResponse } from "next/server";

import { requireUserId } from "@/server/auth/session";
import { routeError } from "@/server/errors";
import { getAvatarCandidateFile } from "@/server/island/avatar";

/**
 * 取候选预览字节。
 *
 * **从已打标的字节取**（`previewKey` 是 `processNextAiRun` 从打标后的字节缩的）：
 * 回退到原始字节会让预览没有 AI 标识而正式版有，正好搞反 —— 与既有
 * 「预览从已打标字节缩」同一口径。
 */
export async function GET(request: Request, context: { params: Promise<{ runId: string; candidateId: string }> }) {
  try {
    const { runId, candidateId } = await context.params;
    const file = await getAvatarCandidateFile(await requireUserId(request), runId, candidateId);
    return new NextResponse(Buffer.from(file.body), {
      headers: {
        "Content-Type": file.contentType,
        // 候选是私有内容，短缓存即可 —— 与 /api/ai-runs 的候选路由同一取值
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
