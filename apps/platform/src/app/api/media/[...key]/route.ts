import { NextResponse } from "next/server";

import { getOptionalUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError, AppError } from "@/server/errors";
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
    const rows = await database.query<{ user_id: string; is_public: boolean }>(
      `SELECT p.user_id, EXISTS(SELECT 1 FROM works w WHERE w.photo_id=p.id AND w.public=true) is_public FROM photos p WHERE p.storage_key=$1
       UNION SELECT p.user_id, false is_public FROM pets p WHERE p.avatar_key=$1 AND p.deleted_at IS NULL
       UNION SELECT w.user_id, w.public is_public FROM works w WHERE w.preview_key=$1
       UNION SELECT w.user_id, w.public is_public FROM works w WHERE w.output_key=$1 AND w.locked=false`, [key],
    );
    if (!rows.some((row) => row.user_id === userId || row.is_public)) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    const object = await objectStorage.get(key);
    if (!object) throw new AppError("MEDIA_NOT_FOUND", "文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), {
      headers: {
        "Content-Type": object.contentType,
        "Cache-Control": "private, max-age=300",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return routeError(error);
  }
}
