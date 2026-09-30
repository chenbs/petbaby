import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError, AppError } from "@/server/errors";
import { objectStorage } from "@/server/storage";
import { z } from "zod";

export async function GET(request: Request, context: { params: Promise<{ id: string; itemId: string }> }) {
  try {
    const userId = await requireUserId(request);
    const { id, itemId } = await context.params;
    z.string().uuid().parse(id);
    z.string().uuid().parse(itemId);
    const rows = await (await getDatabase()).query("SELECT i.output_key,i.preview_key,i.status,b.status batch_status,o.status order_status FROM art_photo_batch_items i JOIN art_photo_batches b ON b.id=i.batch_id JOIN growth_orders o ON o.id=b.order_id WHERE i.id=$1 AND i.batch_id=$2 AND b.user_id=$3", [itemId, id, userId]);
    if (!rows[0]) throw new AppError("ART_PHOTO_ITEM_NOT_FOUND", "写真成片不存在", 404);
    if (rows[0].order_status !== "paid" || rows[0].batch_status === "cancelled") throw new AppError("ART_PHOTO_NOT_PAID", "写真套餐尚未付款或已退款", 403);
    const preview = new URL(request.url).searchParams.get("preview") === "1";
    const key = preview ? rows[0].preview_key : rows[0].output_key;
    if (!key || !["succeeded"].includes(String(rows[0].status))) throw new AppError("ART_PHOTO_ITEM_NOT_READY", "这张写真还在生成中", 409);
    const object = await objectStorage.get(String(key));
    if (!object) throw new AppError("ART_PHOTO_OUTPUT_NOT_FOUND", "写真文件暂时不可用", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Cache-Control": "private, max-age=300" } });
  } catch (error) { return routeError(error); }
}
