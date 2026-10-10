import "server-only";

import { getDatabase } from "@/server/db/client";
import { cleanupOrphanAttachments } from "@/server/daily-log-service";
import { processObjectCleanupJobs } from "@/server/object-cleanup";

export async function closeExpiredOrders() {
  const database = await getDatabase();
  const rows = await database.query<{ id: string }>("UPDATE orders SET status='closed',closed_at=now() WHERE status='pending' AND created_at < now()-interval '30 minutes' RETURNING id");
  /*
   * 权益订单（含冻干充值单）同样 30 分钟关单。原先只关作品订单，未付的充值单会一直挂在 pending，
   * 占着单日充值上限的额度。已发起渠道支付的单仍可被回查确认（applyPaymentConfirmation 接受 closed）。
   */
  const growth = await database.query<{ id: string }>("UPDATE growth_orders SET status='closed',updated_at=now() WHERE status='pending' AND created_at < now()-interval '30 minutes' RETURNING id");
  return rows.length + growth.length;
}

/**
 * 运维清理。**不清理作品**：2026-09 起作品与照片一样长期保存，
 * 未付费作品不再按 expires_at 过期删除（原规则会把文件和 works 行一起硬删）。
 * 作品只在用户自己删除、删除宠物或注销账户时清理。
 */
export async function cleanupExpiredContent() {
  const database = await getDatabase();
  await database.query("DELETE FROM rate_limits WHERE window_start < now()-interval '2 days'");
  // 照片库是用户的记录，不是生成任务的临时素材；没有作品引用也必须保留。
  // 软删行也不能硬删：上传请求键的墓碑依赖它阻止旧请求复活。
  // 上传后没挂到任何记录上的日常记录附图（用户中途放弃），先登记进持久清理
  await cleanupOrphanAttachments();
  const objectCleanup = await processObjectCleanupJobs();
  return { works: 0, photos: 0, objectCleanup };
}

export async function healthSnapshot() {
  const database = await getDatabase();
  const [db, queue] = await Promise.all([
    database.query<{ ok: number }>("SELECT 1 ok"),
    database.query<{ queued: number; stale: number }>("SELECT count(*) FILTER (WHERE status='queued')::int queued,count(*) FILTER (WHERE status='processing' AND locked_at < now()-interval '5 minutes')::int stale FROM generation_tasks"),
  ]);
  return {
    status: db[0]?.ok === 1 && queue[0].stale === 0 ? "ok" : "degraded",
    database: db[0]?.ok === 1,
    queued: queue[0].queued,
    stale: queue[0].stale,
    timestamp: new Date().toISOString(),
  };
}

export async function sendOperationalAlert(title: string, details: Record<string, unknown>) {
  const webhook = process.env.ALERT_WEBHOOK_URL;
  if (!webhook) return { delivered: false, reason: "not_configured" };
  const allowed = new URL(webhook);
  if (allowed.protocol !== "https:") return { delivered: false, reason: "invalid_url" };
  const response = await fetch(allowed, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title, details, timestamp: new Date().toISOString() }), signal: AbortSignal.timeout(5_000) });
  return { delivered: response.ok, reason: response.ok ? undefined : `http_${response.status}` };
}
