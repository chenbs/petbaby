import "server-only";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

export async function enforceRateLimit(scope: string, subject: string, limit: number, windowSeconds: number) {
  const database = await getDatabase();
  const windowMs = windowSeconds * 1000;
  const windowStart = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await database.query<{ hits: number }>(
    `INSERT INTO rate_limits (id,scope,subject,window_start,hits) VALUES ($1,$2,$3,$4,1)
     ON CONFLICT (scope,subject,window_start) DO UPDATE SET hits=rate_limits.hits+1 RETURNING hits`,
    [crypto.randomUUID(), scope, subject.slice(0, 160), windowStart],
  );
  if (rows[0].hits > limit) throw new AppError("RATE_LIMITED", "操作太频繁，请稍后再试", 429);
}

export async function assertGenerationCircuit() {
  const database = await getDatabase();
  const date = new Date().toISOString().slice(0, 10);
  const rows = await database.query<{ generation_count: number; estimated_cost: number; circuit_open: boolean }>("SELECT * FROM system_usage WHERE usage_date=$1", [date]);
  if (!rows[0]) return;
  const maxCount = Number(process.env.DAILY_GENERATION_LIMIT || 500);
  const maxCost = Number(process.env.DAILY_COST_LIMIT || 50);
  if (rows[0].circuit_open || rows[0].generation_count >= maxCount || Number(rows[0].estimated_cost) >= maxCost) {
    await database.query("UPDATE system_usage SET circuit_open=true,updated_at=now() WHERE usage_date=$1", [date]);
    throw new AppError("GENERATION_CIRCUIT_OPEN", "今日生成额度已达上限，请明天再来", 503);
  }
}

export function clientAddress(request: Request) {
  return (request.headers.get("x-forwarded-for") || "local").split(",")[0].trim().slice(0, 80);
}
