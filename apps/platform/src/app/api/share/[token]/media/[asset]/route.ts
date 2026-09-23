import { z } from "zod";
import { getSharedWork } from "@/server/platform-service";
import { getDatabase } from "@/server/db/client";
import { ensurePhotoDeliverableAsset } from "@/server/photo-deliverable-assets";
import { AppError, routeError } from "@/server/errors";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ token: string; asset: string }> }) {
  try {
    const { token, asset } = await context.params;
    z.enum(["cover", "output"]).parse(asset);
    const shared = await getSharedWork(token, new URL(request.url).searchParams.get("code") || undefined);
    const [work] = await (await getDatabase()).query("SELECT w.*,ph.storage_key original_key FROM works w JOIN photos ph ON ph.id=w.photo_id WHERE w.id=$1", [shared.id]);
    let key = asset === "output" ? (work.locked ? work.preview_key : work.output_key) : undefined;
    if (asset === "cover" || key === work.original_key) key = await ensurePhotoDeliverableAsset(String(work.user_id), String(work.pet_id), "work", String(work.id), String(work.photo_id));
    const object = key ? await objectStorage.get(String(key)) : undefined;
    if (!object) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    return new Response(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" } });
  } catch (error) { return routeError(error); }
}
