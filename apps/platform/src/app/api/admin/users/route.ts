import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { AppError, routeError } from "@/server/errors";

const querySchema = z.object({ q: z.string().max(120).optional(), status: z.enum(["all", "active", "suspended", "deleted"]).default("all") });

export async function GET(request: Request) {
  try {
    await assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const database = await getDatabase();
    const pattern = query.q ? `%${query.q.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null;
    const users = await database.query(
      `SELECT u.id, u.display_name, u.created_at, u.deleted_at,
        u.admin_suspended_at, u.admin_suspended_by, u.admin_suspension_reason,
        (SELECT count(*)::int FROM pets p WHERE p.user_id=u.id AND p.deleted_at IS NULL) pets,
        (SELECT count(*)::int FROM works w WHERE w.user_id=u.id AND w.deleted_at IS NULL) works,
        ((SELECT count(*) FROM orders o WHERE o.user_id=u.id)
          +(SELECT count(*) FROM physical_orders p WHERE p.user_id=u.id)
          +(SELECT count(*) FROM growth_orders g WHERE g.user_id=u.id))::int orders,
        ((SELECT coalesce(sum(o.amount),0) FROM orders o WHERE o.user_id=u.id AND o.status IN ('paid','completed','refunded'))
          +(SELECT coalesce(sum(p.amount),0) FROM physical_orders p WHERE p.user_id=u.id AND p.paid_at IS NOT NULL)
          +(SELECT coalesce(sum(g.amount),0) FROM growth_orders g WHERE g.user_id=u.id AND g.paid_at IS NOT NULL))::numeric revenue
       FROM users u
       WHERE ($1::text IS NULL OR u.id::text ILIKE $1 OR coalesce(u.display_name,'') ILIKE $1 OR coalesce(u.wechat_openid,'') ILIKE $1)
         AND ($2='all'
           OR ($2='active' AND u.deleted_at IS NULL AND u.admin_suspended_at IS NULL)
           OR ($2='suspended' AND u.deleted_at IS NULL AND u.admin_suspended_at IS NOT NULL)
           OR ($2='deleted' AND u.deleted_at IS NOT NULL))
       ORDER BY u.created_at DESC LIMIT 100`,
      [pattern, query.status],
    );
    const audit = await database.query("SELECT id,actor_id,action,target_type,target_id,metadata,created_at FROM audit_logs WHERE target_type='user' ORDER BY created_at DESC LIMIT 80");
    return NextResponse.json({ data: { users, audit } });
  } catch (error) {
    return routeError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertTrustedMutation(request);
    const actorId = await requireUserId(request);
    assertAdmin(actorId);
    const input = z.object({ action: z.enum(["suspend", "reactivate"]), userId: z.string().uuid(), reason: z.string().trim().min(2).max(200) }).parse(await request.json());
    if (input.userId === actorId && input.action === "suspend") throw new AppError("SELF_SUSPEND_FORBIDDEN", "不能停用当前管理员账号", 409);
    const database = await getDatabase();
    const currentRows = await database.query("SELECT id,deleted_at,admin_suspended_at FROM users WHERE id=$1", [input.userId]);
    if (!currentRows[0]) throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
    if (currentRows[0].deleted_at) throw new AppError("DELETED_ACCOUNT_NOT_REACTIVATABLE", "用户已主动注销，不能通过停用恢复", 409);
    const rows = await database.query(
      `UPDATE users
       SET admin_suspended_at=CASE WHEN $2='suspend' THEN now() ELSE NULL END,
           admin_suspended_by=CASE WHEN $2='suspend' THEN $3 ELSE NULL END,
           admin_suspension_reason=CASE WHEN $2='suspend' THEN $4 ELSE NULL END
       WHERE id=$1 AND deleted_at IS NULL
       RETURNING id,deleted_at,admin_suspended_at,admin_suspension_reason`,
      [input.userId, input.action, actorId, input.reason],
    );
    if (!rows[0]) throw new AppError("USER_NOT_FOUND", "用户不存在", 404);
    if (input.action === "suspend") {
      await Promise.all([
        database.query("UPDATE works SET public=false,share_token=NULL,share_expires_at=NULL,share_access_code_hash=NULL WHERE user_id=$1 AND public=true", [input.userId]),
        database.query("UPDATE interactive_sessions SET share_token=NULL,revoked_at=now(),updated_at=now() WHERE user_id=$1 AND share_token IS NOT NULL", [input.userId]),
        database.query("UPDATE memorial_spaces SET visibility='private',share_token=NULL,updated_at=now() WHERE user_id=$1 AND share_token IS NOT NULL", [input.userId]),
        database.query("UPDATE annual_reports SET share_token=NULL,revoked_at=now() WHERE user_id=$1 AND share_token IS NOT NULL", [input.userId]),
      ]);
    }
    await database.query(
      "INSERT INTO audit_logs (id,user_id,actor_id,action,target_type,target_id,metadata,created_at) VALUES ($1,$2,$3,$4,'user',$5,$6::jsonb,$7)",
      [crypto.randomUUID(), input.userId, actorId, `user_${input.action}`, input.userId, JSON.stringify({ reason: input.reason, before: currentRows[0], after: rows[0] }), new Date()],
    );
    return NextResponse.json({ data: rows[0] });
  } catch (error) {
    return routeError(error);
  }
}
