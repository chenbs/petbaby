import { NextResponse } from "next/server";
import { z } from "zod";
import { AppError, routeError } from "@/server/errors";
import { getPublicInteractiveSession } from "@/server/growth-service";
import { getDatabase } from "@/server/db/client";
import { objectStorage } from "@/server/storage";

export async function GET(_: Request, context: { params: Promise<{ token: string; photoId: string }> }) {
  try {
    const { token, photoId } = await context.params; const session = await getPublicInteractiveSession(z.string().min(20).max(80).parse(token)); const id = z.string().uuid().parse(photoId);
    if (!session.photoIds.includes(id)) throw new AppError("INTERACTIVE_PHOTO_NOT_FOUND", "公开照片不存在", 404);
    const rows = await (await getDatabase()).query("SELECT storage_key,mime_type FROM photos WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [id, session.userId]);
    if (!rows[0]) throw new AppError("INTERACTIVE_PHOTO_NOT_FOUND", "公开照片不存在", 404); const object = await objectStorage.get(String(rows[0].storage_key));
    if (!object) throw new AppError("INTERACTIVE_PHOTO_NOT_FOUND", "公开照片不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "public, max-age=300" } });
  } catch (error) { return routeError(error); }
}
