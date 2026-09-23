import "server-only";

import { getDatabase } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { processObjectCleanupJobs } from "@/server/object-cleanup";

export async function closeExpiredOrders() {
  const database = await getDatabase();
  const rows = await database.query<{ id: string }>("UPDATE orders SET status='closed',closed_at=now() WHERE status='pending' AND created_at < now()-interval '30 minutes' RETURNING id");
  return rows.length;
}

export async function cleanupExpiredContent() {
  const database = await getDatabase();
  const works = await database.query<{ id: string; output_key: string | null }>("SELECT id,output_key FROM works WHERE locked=true AND expires_at < now()");
  for (const work of works) {
    if (work.output_key) {
      const base = work.output_key.replace(/\.[^.]+$/, "");
      await Promise.allSettled([objectStorage.delete(work.output_key), objectStorage.delete(`${base}.svg`), objectStorage.delete(`${base}.png`), objectStorage.delete(`${base}.pdf`)]);
    }
    await database.query("DELETE FROM works WHERE id=$1", [work.id]);
  }
  await database.query("DELETE FROM rate_limits WHERE window_start < now()-interval '2 days'");
  // 照片库是用户的记录，不是生成任务的临时素材；没有作品引用也必须保留。
  // 软删行也不能硬删：上传请求键的墓碑依赖它阻止旧请求复活。
  const objectCleanup = await processObjectCleanupJobs();
  return { works: works.length, photos: 0, objectCleanup };
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
