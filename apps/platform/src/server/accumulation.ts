import "server-only";

import { spanDaysBetween, type AccumulationInput } from "@/domain/pricing";
import { getDatabase } from "@/server/db/client";

/**
 * 量一只宠物当前的积累深度，供分档计价使用（画册、短片、年度短片共用）。
 *
 * 排序键用 `coalesce(shot_at, created_at)` —— 与 timeline-service 和 mapPhoto
 * 的回落口径一致。直接用 `shot_at` 会让无 EXIF 的照片算不进跨度，
 * 出现「时间线显示跨了两年、定价却算作基础档」。
 */
export async function measureAccumulation(userId: string, petId: string): Promise<AccumulationInput> {
  const database = await getDatabase();
  const rows = await database.query<{ photo_count: number; earliest: string | null; latest: string | null }>(
    "SELECT count(*)::int photo_count, min(coalesce(shot_at, created_at)) earliest, max(coalesce(shot_at, created_at)) latest FROM photos WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL",
    [userId, petId],
  );
  const row = rows[0];
  const photoCount = Number(row?.photo_count || 0);
  const spanDays = row?.earliest && row?.latest ? spanDaysBetween(new Date(row.earliest), new Date(row.latest)) : 0;
  return { photoCount, spanDays };
}
