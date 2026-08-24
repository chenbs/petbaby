import "server-only";

import { getDatabase } from "@/server/db/client";

export type AdminAuditInput = {
  actorId: string;
  action: string;
  targetType: string;
  targetId?: string;
  reason: string;
  before?: unknown;
  after?: unknown;
  metadata?: Record<string, unknown>;
  userId?: string;
};

export async function recordAdminAudit(input: AdminAuditInput) {
  const database = await getDatabase();
  const metadata = {
    reason: input.reason,
    before: input.before ?? null,
    after: input.after ?? null,
    ...(input.metadata || {}),
  };
  const id = crypto.randomUUID();
  await database.query(
    `INSERT INTO audit_logs
      (id,user_id,actor_id,action,target_type,target_id,metadata,created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      id,
      input.userId || null,
      input.actorId,
      input.action,
      input.targetType,
      input.targetId || null,
      JSON.stringify(metadata),
      new Date(),
    ],
  );
  return id;
}
