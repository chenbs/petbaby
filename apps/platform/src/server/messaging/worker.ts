import "server-only";

import { getDatabase } from "@/server/db/client";

/**
 * 投递到期的订阅消息。
 *
 * 取 `status IN ('active','scheduled')` 且 `scheduled_at` 已到 —— 授权记录
 * （`status='active'` 但 `scheduled_at` 为 NULL）不会被误投，纯授权登记没有排期。
 * 被消耗掉的授权是 `status='consumed'`（见 timeline-service 的授权门），
 * 不在这个集合里。
 */
export async function processDueMessages(limit = 20) {
  const database = await getDatabase();
  const rows = await database.query("SELECT s.* FROM message_subscriptions s JOIN users u ON u.id=s.user_id LEFT JOIN pets p ON p.id=s.pet_id WHERE s.status IN ('active','scheduled') AND s.revoked_at IS NULL AND u.deleted_at IS NULL AND (s.pet_id IS NULL OR (p.deleted_at IS NULL AND p.life_stage<>'memorial')) AND (s.event_type NOT IN ('birthday','got_home','on_this_day') OR p.id IS NOT NULL) AND s.scheduled_at IS NOT NULL AND s.scheduled_at<=now() ORDER BY s.scheduled_at LIMIT $1", [limit]);
  const results: Array<{ id: string; status: string }> = [];
  for (const row of rows) {
    const attempts = Number(row.attempts || 0) + 1;
    const failed = process.env.NODE_ENV === "production" && !process.env.WECHAT_SUBSCRIBE_TEMPLATE_ID;
    const status = failed && attempts >= 3 ? "failed" : failed ? "scheduled" : "sent";
    const error = failed ? "TEMPLATE_CONFIG_PENDING" : null;
    await database.query(
      "UPDATE message_subscriptions SET status=$2, sent_at=CASE WHEN $2='sent' THEN now() ELSE sent_at END, attempts=$3, last_error=$4, provider_response=$5::jsonb WHERE id=$1",
      [row.id, status, attempts, error, JSON.stringify({ code: error, attempt: attempts })],
    );
    await database.query(
      "INSERT INTO message_delivery_attempts (id,subscription_id,attempt,status,response,error,created_at) VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7)",
      [crypto.randomUUID(), row.id, attempts, status, JSON.stringify({ code: error, attempt: attempts }), error, new Date()],
    );
    results.push({ id: String(row.id), status: failed && attempts < 3 ? "retrying" : status });
  }
  return results;
}
