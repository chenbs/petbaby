import { z } from "zod";
import { getPublicMemorial } from "@/server/memorial-service";
import { getDatabase } from "@/server/db/client";
import { ensurePhotoDeliverableAsset } from "@/server/photo-deliverable-assets";
import { AppError, routeError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

export async function GET(_: Request, context: { params: Promise<{ token: string; photoId: string }> }) {
  try {
    const { token, photoId } = await context.params;
    const id = z.string().uuid().parse(photoId);
    const memorial = await getPublicMemorial(token);
    if (!memorial.photos.some((photo) => photo.id === id)) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const [owner] = await (await getDatabase()).query("SELECT user_id,pet_id FROM memorial_spaces WHERE id=$1", [memorial.id]);
    const key = await ensurePhotoDeliverableAsset(String(owner.user_id), String(owner.pet_id), "memorial", String(memorial.id), id);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    return new Response(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return routeError(error); }
}
