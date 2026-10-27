import { NextResponse } from "next/server";
import sharp from "sharp";

import { getOptionalUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError, AppError } from "@/server/errors";
import { canDisplayResize, displayImage } from "@/server/media/display-image";
import { objectStorage } from "@/server/storage";

export async function GET(
  request: Request,
  context: { params: Promise<{ key: string[] }> },
) {
  try {
    const userId = await getOptionalUserId(request);
    const { key: segments } = await context.params;
    const key = segments.join("/");
    if (!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(key)) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const database = await getDatabase();
    if (!userId) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const rows = await database.query(
      `SELECT ph.id FROM photos ph JOIN pets p ON p.id=ph.pet_id WHERE ph.storage_key=$1 AND ph.user_id=$2 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
       UNION SELECT p.id FROM pets p WHERE p.avatar_key=$1 AND p.user_id=$2 AND p.deleted_at IS NULL
         AND NOT EXISTS(SELECT 1 FROM photos ph WHERE ph.storage_key=$1 AND ph.deleted_at IS NOT NULL)
       UNION SELECT w.id FROM works w JOIN pets p ON p.id=w.pet_id WHERE w.user_id=$2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL
         AND (w.preview_key=$1 OR (w.output_key=$1 AND w.locked=false))
         AND NOT EXISTS(SELECT 1 FROM photos ph WHERE ph.storage_key=$1)
       UNION SELECT a.id FROM photo_deliverable_assets a JOIN works w ON a.kind='work' AND w.id=a.resource_id JOIN pets p ON p.id=w.pet_id
         WHERE a.storage_key=$1 AND a.user_id=$2 AND w.deleted_at IS NULL AND p.deleted_at IS NULL`, [key, userId],
    );
    if (!rows.length) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const params = new URL(request.url).searchParams;
    // display=1：小程序列表与详情展示用的小 JPEG（见 server/media/display-image.ts）；保存原图走各自的下载出口
    const display = params.get("display") === "1" && canDisplayResize(object.contentType);
    const raster = !display && params.get("format") === "png" && object.contentType === "image/svg+xml";
    const body = display ? await displayImage(key, object) : raster ? await sharp(Buffer.from(object.body)).png().toBuffer() : Buffer.from(object.body);
    return new NextResponse(new Uint8Array(body), {
      headers: {
        "Content-Type": display ? "image/jpeg" : raster ? "image/png" : object.contentType,
        "Cache-Control": "private, no-store",
        "Vary": "Cookie, Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
