import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getAiRun } from "@/server/growth-service";
import { assertAiOriginalDelivery } from "@/server/ai-disclosure-service";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  try {
    const { id, candidateId } = await context.params; const userId = await requireUserId(request); const run = await getAiRun(userId, id);
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new AppError("AI_CANDIDATE_NOT_FOUND", "这张照片不存在", 404);
    const key = run.selectedUnlocked && run.selectedId === candidateId ? candidate.outputKey : candidate.previewKey;
    if (!key) throw new AppError("AI_OUTPUT_NOT_FOUND", "文件不存在", 404);
    // 只有「原图」交付（已付费且请求 original=1）才过标识义务确认；页面里的预览不受影响。
    const original = key === candidate.outputKey && new URL(request.url).searchParams.get("original") === "1";
    if (original) await assertAiOriginalDelivery(userId, { kind: "ai_candidate", id: candidateId, storageKey: key });
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("AI_OUTPUT_NOT_FOUND", "文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, max-age=300" } });
  } catch (error) { return routeError(error); }
}
