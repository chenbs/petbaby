import "server-only";

import { getDatabase } from "@/server/db/client";

export async function getUserStatus(userId: string) {
  const database = await getDatabase();
  const date = new Date().toISOString().slice(0, 10);
  const [quota, refunds, notifications] = await Promise.all([
    database.query("SELECT id FROM daily_quotas WHERE user_id=$1 AND quota_date=$2", [userId, date]),
    database.query("SELECT r.id,r.order_id,r.amount,r.reason,r.status,r.created_at,r.completed_at FROM refunds r WHERE r.user_id=$1 ORDER BY r.created_at DESC LIMIT 10", [userId]),
    database.query("SELECT id,type,title,body,target_path,read_at,created_at FROM user_notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 20", [userId]),
  ]);
  return { quota: { date, daily: 1, used: quota.length, remaining: Math.max(0, 1 - quota.length) }, refunds, notifications };
}

export async function markNotificationRead(userId: string, id: string) {
  const database = await getDatabase();
  const rows = await database.query("UPDATE user_notifications SET read_at=coalesce(read_at,now()) WHERE id=$1 AND user_id=$2 RETURNING *", [id, userId]);
  return rows[0] || null;
}
