import { NextResponse } from "next/server";
import { requireUserId } from "@/server/auth/session";
import { AppError, routeError } from "@/server/errors";
import { getDatabase } from "@/server/db/client";
import { objectStorage } from "@/server/storage";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const userId = await requireUserId(request); const { id } = await context.params;
    const rows = await (await getDatabase()).query("SELECT * FROM annual_reports WHERE id=$1 AND user_id=$2", [id, userId]);
    const row = rows[0]; const key = row && (row.locked ? row.preview_key : row.output_key);
    if (!key) throw new AppError("REPORT_NOT_FOUND", "年度报告不存在", 404);
    const object = await objectStorage.get(String(key));
    if (!object) throw new AppError("REPORT_FILE_NOT_FOUND", "报告文件不存在", 404);
    return new NextResponse(Buffer.from(object.body), { headers: { "Content-Type": object.contentType, "Content-Disposition": `attachment; filename=petbaby-wrapped-${String(row.year)}.svg` } });
  } catch (error) { return routeError(error); }
}
