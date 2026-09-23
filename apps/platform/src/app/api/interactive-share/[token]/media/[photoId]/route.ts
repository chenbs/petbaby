import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, routeError } from "@/server/errors";
import { getPublicInteractiveSession } from "@/server/growth-service";
import { ensurePhotoDeliverableAsset } from "@/server/photo-deliverable-assets";
import { objectStorage } from "@/server/storage";

export async function GET(_: Request, context: { params: Promise<{ token: string; photoId: string }> }) {
  try {
    const { token, photoId } = await context.params; const session = await getPublicInteractiveSession(z.string().min(20).max(80).parse(token)); const id = z.string().uuid().parse(photoId);
    if (!session.photoIds.includes(id)) throw new AppError("INTERACTIVE_PHOTO_NOT_FOUND", "公开照片不存在", 404);
    const key = await ensurePhotoDeliverableAsset(session.userId, session.petId, "interactive", session.id, id);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("INTERACTIVE_PHOTO_NOT_FOUND", "公开照片不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return routeError(error); }
}
