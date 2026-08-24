import { NextResponse } from "next/server";
import { z } from "zod";

import { assertAdmin } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { routeError } from "@/server/errors";

const querySchema = z.object({
  action: z.string().max(120).optional(),
  targetType: z.string().max(80).optional(),
  actorId: z.string().uuid().optional(),
  from: z.string().date().optional(),
  to: z.string().date().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function GET(request: Request) {
  try {
    assertAdmin(await requireUserId(request));
    const query = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    const rows = await (await getDatabase()).query(
      `SELECT id,user_id,actor_id,action,target_type,target_id,metadata,created_at,count(*) OVER()::int total
       FROM audit_logs
       WHERE ($1::text IS NULL OR action ILIKE $1)
         AND ($2::text IS NULL OR target_type=$2)
         AND ($3::uuid IS NULL OR actor_id=$3)
         AND ($4::timestamptz IS NULL OR created_at >= $4)
         AND ($5::timestamptz IS NULL OR created_at <= $5)
       ORDER BY created_at DESC LIMIT $6 OFFSET $7`,
      [query.action ? `%${query.action.replaceAll("%", "\\%").replaceAll("_", "\\_")}%` : null, query.targetType || null, query.actorId || null, query.from ? new Date(`${query.from}T00:00:00Z`) : null, query.to ? new Date(`${query.to}T23:59:59.999Z`) : null, query.pageSize, (query.page - 1) * query.pageSize],
    );
    return NextResponse.json({ data: { items: rows, total: Number(rows[0]?.total || 0), page: query.page, pageSize: query.pageSize } });
  } catch (error) {
    return routeError(error);
  }
}
