import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getAiRun } from "@/server/growth-service";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string; candidateId: string }> }) {
  try {
    const { id, candidateId } = await context.params; const run = await getAiRun(await requireUserId(request), id);
    const candidate = run.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new AppError("AI_CANDIDATE_NOT_FOUND", "AI 候选结果不存在", 404);
    const key = run.selectedUnlocked && run.selectedId === candidateId ? candidate.outputKey : candidate.previewKey;
    if (!key) throw new AppError("AI_OUTPUT_NOT_FOUND", "AI 文件不存在", 404);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("AI_OUTPUT_NOT_FOUND", "AI 文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, max-age=300" } });
  } catch (error) { return routeError(error); }
}
