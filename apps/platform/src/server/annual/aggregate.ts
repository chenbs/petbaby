import "server-only";

import { getDatabase } from "@/server/db/client";
import { mapPhoto } from "@/server/db/rows";
import { anchorOf, dayIndexOf, daysSince } from "@/domain/companion";
import type { Photo } from "@/domain/models";
import { effectivePhotoDate, photoLocalDate } from "@/domain/photo-memory";
import { AppError } from "@/server/errors";
import { spanDaysBetween } from "@/domain/pricing";

/**
 * 年度聚合数据。叙事视频（任务 5）与年度报告（任务 6）共用同一份 ——
 * 两个产物在同一年里给出的数字不一样是不能接受的。
 *
 * ## 每个数字都必须来自这个用户的真实数据
 *
 * 判定方法（任务书原文）：**把宠物名字换掉，如果句子仍然成立，这句文案就是无效的。**
 * 「你们一起过了 743 天」成立不了 —— 那是这个用户的事实。
 * 「多么温暖的陪伴时光」谁都能说 —— 那是产品的表演。
 *
 * 所以这里只产出可核对的计数与日期，不产出任何形容词。
 */

export type AnnualPhoto = {
  photo: Photo;
  petName: string;
  /** 相处的第几天 */
  day: number;
  showDay?: boolean;
  /** 本地日历日 YYYY-MM-DD */
  date: string;
  /** 日期是真实拍摄时间还是仅上传时间 */
  dateSource: "manual" | "exif" | "upload";
};

export type AnnualAggregate = {
  year: number;
  /** 主角宠物：当年照片最多的那只。没有照片时取默认宠物 */
  petId?: string;
  petName?: string;
  /** 起算日（生日 / 到家日 / 建档日） */
  anchor?: string;
  /** 到年末（或已离开则到离开日）的陪伴天数 */
  companionDays: number;
  memorialSince?: string;
  memorial?: boolean;
  counts: { photos: number; works: number; shares: number; pets: number; interactions: number };
  /** 当年照片，按拍摄时间正序。已按主角宠物过滤 */
  photos: AnnualPhoto[];
  /** 当年跨度最大的两张，供成长对比段使用；不足两张时 undefined */
  pair?: { earliest: AnnualPhoto; latest: AnnualPhoto; gapDays: number };
};

function localDate(value: unknown) {
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * @param limit 取多少张照片进叙事。默认 12 —— 再多单张停留就短于黑场下限
 *        （见 `domain/video-duration.ts` 的 MIN_PHOTO_SECONDS），而年度视频
 *        还要为开场、对比、数据卡三段留出时间。
 */
export async function collectAnnualData(userId: string, year: number, limit = 12, options: { petId?: string; photoIds?: string[]; recordDates?: boolean } = {}): Promise<AnnualAggregate> {
  const database = await getDatabase();

  /*
   * 计数口径：photos/works 按 created_at 取「当年新增」。
   *
   * 这里刻意不用 shot_at：年度报告说的是「你今年收藏了 N 张照片」，
   * 那是用户当年的行为；用拍摄时间会把今年上传的旧照片算到往年去，
   * 报告里的数字与用户当年的实际使用对不上。
   * 而叙事段落里的日期用 shot_at —— 那说的是「照片里的那一天」，两者语义不同。
   */
  const counts = await database.query<{ photos: number; works: number; shares: number; pets: number; interactions: number }>(
    `SELECT (SELECT count(*)::int FROM photos WHERE user_id=$1 AND extract(year from created_at)=$2 AND deleted_at IS NULL) photos,
            (SELECT count(*)::int FROM works WHERE user_id=$1 AND extract(year from created_at)=$2 AND deleted_at IS NULL) works,
            (SELECT count(*)::int FROM events WHERE user_id=$1 AND name='shared' AND extract(year from created_at)=$2) shares,
            (SELECT count(*)::int FROM pets WHERE user_id=$1 AND deleted_at IS NULL) pets,
            (SELECT count(*)::int FROM interactive_events WHERE user_id=$1 AND extract(year from created_at)=$2) interactions`,
    [userId, year],
  );

  /*
   * 主角宠物 = 当年照片最多的那只。
   *
   * 一条年度视频只能有一个主角：把多只宠物的照片混在一条时间线上，
   * 「第 N 天」就没有意义了（各自的起算日不同）。
   */
  const leadRows = await database.query(
    `SELECT p.id,p.name,p.birthday,p.date_type,p.created_at,p.life_stage,
            (SELECT count(*)::int FROM photos ph WHERE ph.pet_id=p.id AND ph.deleted_at IS NULL AND extract(year from ${options.recordDates ? "coalesce(ph.memory_date,coalesce(ph.shot_at,ph.created_at)::date)" : "coalesce(ph.shot_at,ph.created_at)"})=$2) shot_count,
            (SELECT MIN(created_at) FROM memorial_spaces m WHERE m.pet_id=p.id AND m.deleted_at IS NULL) memorial_since
       FROM pets p
      WHERE p.user_id=$1 AND p.deleted_at IS NULL AND ($3::uuid IS NULL OR p.id=$3)
      ORDER BY shot_count DESC, p.is_default DESC, p.created_at
      LIMIT 1`,
    [userId, year, options.petId || null],
  );
  const lead = leadRows[0];
  if (options.petId && !lead) throw new AppError("PET_NOT_FOUND", "宠物档案不存在，请重新选择", 404);
  if (options.petId) {
    const [scoped] = await database.query<{ photos: number; works: number; shares: number; pets: number; interactions: number }>(
      `SELECT (SELECT count(*)::int FROM photos WHERE user_id=$1 AND pet_id=$3 AND extract(year from created_at)=$2 AND deleted_at IS NULL) photos,
        (SELECT count(*)::int FROM works WHERE user_id=$1 AND pet_id=$3 AND extract(year from created_at)=$2 AND deleted_at IS NULL) works,
        (SELECT count(*)::int FROM works WHERE user_id=$1 AND pet_id=$3 AND extract(year from created_at)=$2 AND public=true AND deleted_at IS NULL) shares,
        1::int pets,
        (SELECT count(*)::int FROM interactive_events e JOIN interactive_sessions s ON s.id=e.session_id WHERE e.user_id=$1 AND s.pet_id=$3 AND extract(year from e.created_at)=$2) interactions`,
      [userId, year, options.petId],
    );
    counts[0] = scoped;
  }
  const base = { year, counts: counts[0] || { photos: 0, works: 0, shares: 0, pets: 0, interactions: 0 } };
  if (!lead) return { ...base, companionDays: 0, photos: [] };

  const anchor = anchorOf({
    birthday: lead.birthday ? String(lead.birthday) : undefined,
    createdAt: lead.created_at instanceof Date ? lead.created_at.toISOString() : (lead.created_at ? String(lead.created_at) : undefined),
  });
  const memorialSince = lead.memorial_since
    ? (lead.memorial_since instanceof Date ? lead.memorial_since.toISOString() : String(lead.memorial_since))
    : undefined;

  /*
   * 陪伴天数的截止日：已离开的宠物取离开日，否则取年末（不是今天）。
   *
   * 取年末而不是今天：一条「2025 年度视频」在 2026 年重看时，
   * 天数不该跟着变大 —— 那份视频讲的是 2025 年结束时的事实。
   * 年份还没过完时按今天算，否则会给出一个尚未到达的天数。
   */
  const yearEnd = new Date(year, 11, 31);
  const cap = memorialSince || (yearEnd.getTime() < Date.now() ? yearEnd.toISOString() : undefined);
  const memorial = lead.life_stage === "memorial";
  const companionDays = memorial && !memorialSince ? 0 : daysSince(anchor, cap);

  /*
   * 叙事段落用的照片按 `coalesce(shot_at, created_at)` 取当年、正序。
   * 与时间线同一个排序键（见 `timeline-service.ts` 的说明）。
   *
   * 均匀抽样而不是取前 N 张：取前 N 张会让整条片子停在年初，
   * 「这一年」就只讲了一月份。
   */
  const photoRows = await database.query(
    `SELECT * FROM photos
      WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL
        AND extract(year from ${options.recordDates ? "coalesce(memory_date,coalesce(shot_at,created_at)::date)" : "coalesce(shot_at,created_at)"})=$3
      ORDER BY ${options.recordDates ? "coalesce(memory_date,coalesce(shot_at,created_at)::date)" : "coalesce(shot_at, created_at)"},created_at,id`,
    [userId, String(lead.id), year],
  );
  const all: AnnualPhoto[] = photoRows.map((row) => {
    const photo = mapPhoto(row);
    const recorded = effectivePhotoDate(photo);
    const date = options.recordDates ? recorded.date : localDate(photo.shotAt);
    const showDay = date >= anchor && (!memorial || Boolean(memorialSince && date <= photoLocalDate(memorialSince)));
    return { photo, petName: String(lead.name), day: dayIndexOf(anchor, date), showDay, date, dateSource: options.recordDates ? recorded.source : photo.shotAtSource };
  });
  let photos = sampleEvenly(all, limit);
  if (options.photoIds) {
    const byId = new Map(all.map((item) => [item.photo.id, item]));
    if (options.photoIds.length > limit || new Set(options.photoIds).size !== options.photoIds.length || options.photoIds.some((id) => !byId.has(id))) throw new AppError("ANNUAL_SELECTION_INVALID", "所选照片超过数量限制，或不属于当前宠物和年份，请重新确认", 422);
    photos = options.photoIds.map((id) => byId.get(id)!);
  }

  const pairPhotos = [...photos].sort((a, b) => a.date.localeCompare(b.date));
  const pair = pairPhotos.length >= 2 && pairPhotos[0].date !== pairPhotos[pairPhotos.length - 1].date
    ? { earliest: pairPhotos[0], latest: pairPhotos[pairPhotos.length - 1], gapDays: spanDaysBetween(new Date(`${pairPhotos[0].date}T12:00:00`), new Date(`${pairPhotos[pairPhotos.length - 1].date}T12:00:00`)) }
    : undefined;

  return {
    ...base,
    petId: String(lead.id),
    petName: String(lead.name),
    anchor,
    companionDays,
    memorialSince,
    memorial,
    photos,
    pair,
  };
}

/**
 * 从一整年里均匀抽 `limit` 张，**保留首尾**。
 *
 * 首尾必须在：它们是「年初」与「年末」，成长对比段和叙事的起止都靠它们。
 */
export function sampleEvenly<T>(items: T[], limit: number): T[] {
  if (limit <= 0) return [];
  if (items.length <= limit) return [...items];
  if (limit === 1) return [items[0]];
  const step = (items.length - 1) / (limit - 1);
  const picked: T[] = [];
  const seen = new Set<number>();
  for (let index = 0; index < limit; index += 1) {
    const at = Math.round(index * step);
    if (seen.has(at)) continue;
    seen.add(at);
    picked.push(items[at]);
  }
  return picked;
}
