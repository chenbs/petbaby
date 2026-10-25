import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { assertTrustedMutation } from "@/server/auth/request-guard";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError } from "@/server/errors";
import { setUserSuspension } from "@/server/admin/user-suspension";

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
        coalesce((SELECT balance FROM wallet_accounts a WHERE a.user_id=u.id),0)::int dongan_balance,
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
    return NextResponse.json({ data: await setUserSuspension(actorId, input) });
  } catch (error) {
    return routeError(error);
  }
}
