import { NextResponse } from "next/server";
import { z } from "zod";

import { recordAdminAudit } from "@/server/admin/audit";
import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";
import { mutateVideoRenderForAdmin } from "@/server/video/service";

const querySchema = z.object({
  status: z.string().max(40).optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const status = query.status || null;
    const page = query.page;
    const pageSize = query.pageSize;
    const rows = await (await getDatabase()).query(
      `SELECT s.id,s.user_id,s.plugin_id,s.state status,s.share_token,s.share_expires_at,s.revoked_at,s.exported_key,s.export_render_id,s.work_id,s.snapshot,s.updated_at,
        r.status export_status,r.progress export_progress,r.error_code export_error,r.config export_config,
        (SELECT count(*)::int FROM interactive_events e WHERE e.session_id=s.id) event_count
       FROM interactive_sessions s LEFT JOIN video_renders r ON r.id=s.export_render_id
       WHERE ($1::text IS NULL OR s.state=$1 OR r.status=$1)
       ORDER BY s.updated_at DESC LIMIT $2 OFFSET $3`,
      [status, pageSize, (page - 1) * pageSize],
    );
    return NextResponse.json({ data: { sessions: rows, page, pageSize } });
  } catch (error) {
    return routeError(error);
  }
}

export async function PATCH(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = z.discriminatedUnion("action", [
      z.object({ action: z.literal("close_share"), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
      z.object({ action: z.enum(["retry_export", "cancel_export"]), id: z.string().uuid(), reason: z.string().trim().min(2).max(200) }),
    ]).parse(await request.json());
    const database = await getDatabase();
    const current = (await database.query("SELECT * FROM interactive_sessions WHERE id=$1", [input.id]))[0];
    if (!current) throw new AppError("INTERACTIVE_SESSION_NOT_FOUND", "互动会话不存在", 404);
    if (input.action === "close_share") {
      const result = (await database.query("UPDATE interactive_sessions SET share_token=NULL,revoked_at=now(),updated_at=now() WHERE id=$1 RETURNING *", [input.id]))[0];
      await recordAdminAudit({ actorId, action: input.action, targetType: "interactive_session", targetId: input.id, reason: input.reason, before: current, after: result, userId: String(current.user_id) });
      return NextResponse.json({ data: result });
    }
    if (!current.export_render_id) throw new AppError("INTERACTIVE_EXPORT_NOT_FOUND", "互动导出任务不存在", 404);
    const result = await mutateVideoRenderForAdmin(actorId, { action: input.action === "retry_export" ? "retry" : "cancel", id: current.export_render_id, reason: input.reason });
    const session = input.action === "retry_export"
      ? (await database.query("UPDATE interactive_sessions SET state='exporting',export_render_id=$2,exported_key=NULL,updated_at=now() WHERE id=$1 RETURNING *", [input.id, result.id]))[0]
      : (await database.query("UPDATE interactive_sessions SET state='active',updated_at=now() WHERE id=$1 RETURNING *", [input.id]))[0];
    await recordAdminAudit({ actorId, action: input.action, targetType: "interactive_session", targetId: input.id, reason: input.reason, before: current, after: { session, render: result }, userId: String(current.user_id) });
    return NextResponse.json({ data: result });
  } catch (error) {
    return routeError(error);
  }
}
