import "server-only";

import { z } from "zod";

import { getDatabase } from "@/server/db/client";
import { mapPhoto } from "@/server/db/rows";
import { AppError } from "@/server/errors";
import { MILESTONE_DAYS, anchorOf, dayIndexOf, daysSince, milestoneLabel, startOfLocalDay } from "@/domain/companion";
import type { Photo } from "@/domain/models";

/**
 * 成长时间线。方向 A 的底座，零边际成本，也是叙事视频（任务 5）的数据来源。
 *
 * 「第几天」的起算日与陪伴天数**同一套规则**（`domain/companion.ts`）：
 * 生日 / 到家日优先，缺失退回建档日。不要在这里重新实现一套 ——
 * 时间线上的「第 743 天」与页面上的「陪伴第 743 天」必须是同一个数字。
 *
 * 排序键是 `shot_at`，NULL 时回落 `created_at`（历史照片与截图没有 EXIF）。
 * 直接按 `shot_at` 排会把它们全排到最前（NULL 在 PostgreSQL 的 ASC 里排最后、
 * DESC 里排最前），时间线开头就是一堆日期不明的照片。
 */

export type TimelineEntry = {
  photo: Photo;
  /** 相处的第几天（含当天，第一天为 1） */
  day: number;
  /** 拍摄日期的本地日历日，YYYY-MM-DD */
  date: string;
  /** 这张照片的日期是真实拍摄时间还是仅上传时间 */
  dateSource: Photo["shotAtSource"];
  /** 命中里程碑时的文案，未命中为 undefined */
  milestone?: string;
};

export type Timeline = {
  petId: string;
  petName: string;
  /** 起算日（生日 / 到家日 / 建档日） */
  anchor: string;
  /** 起算日的语义，端上用它决定说「出生」还是「到家」 */
  anchorType: "birthday" | "got_home" | "created";
  /** 到今天（已离开的宠物到离开日）的总天数 */
  totalDays: number;
  /** 已离开的宠物有值；天数按它封口，不再递增 */
  memorialSince?: string;
  entries: TimelineEntry[];
  /** 已达成的里程碑，供端上做「第 100 天」这类标记 */
  milestones: Array<{ day: number; label: string; date?: string }>;
};

const querySchema = z.object({
  /** 倒序（默认，最近的在前）或正序（从第一天读起） */
  order: z.enum(["desc", "asc"]).optional().default("desc"),
  limit: z.number().int().min(1).max(500).optional().default(200),
});

function localDate(value: unknown) {
  const day = startOfLocalDay(value);
  if (!day) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${day.getFullYear()}-${pad(day.getMonth() + 1)}-${pad(day.getDate())}`;
}

async function getOwnedPet(userId: string, petId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT p.id,p.name,p.birthday,p.date_type,p.life_stage,p.created_at, (SELECT MIN(created_at) FROM memorial_spaces WHERE pet_id=p.id AND deleted_at IS NULL) memorial_since FROM pets p WHERE p.id=$1 AND p.user_id=$2 AND p.deleted_at IS NULL",
    [petId, userId],
  );
  if (!rows[0]) throw new AppError("PET_NOT_FOUND", "宠物档案不存在", 404);
  return rows[0];
}

export async function getPetTimeline(userId: string, petId: string, input: unknown = {}): Promise<Timeline> {
  const options = querySchema.parse(input);
  const pet = await getOwnedPet(userId, petId);
  const database = await getDatabase();

  /*
   * `coalesce(shot_at, created_at)` 既是排序键也是展示日期，与 `mapPhoto` 的
   * 回落口径一致。两处必须一样，否则「排在第 3 位的照片显示的却是更早的日期」。
   */
  const rows = await database.query(
    `SELECT * FROM photos
      WHERE user_id=$1 AND pet_id=$2 AND deleted_at IS NULL
      ORDER BY coalesce(shot_at, created_at) ${options.order === "asc" ? "ASC" : "DESC"}, position
      LIMIT $3`,
    [userId, petId, options.limit],
  );

  const anchor = anchorOf({
    birthday: pet.birthday ? String(pet.birthday) : undefined,
    createdAt: pet.created_at instanceof Date ? pet.created_at.toISOString() : (pet.created_at ? String(pet.created_at) : undefined),
  });
  const memorialSince = pet.memorial_since
    ? (pet.memorial_since instanceof Date ? pet.memorial_since.toISOString() : String(pet.memorial_since))
    : undefined;
  const anchorType: Timeline["anchorType"] = pet.birthday ? (String(pet.date_type || "birthday") as "birthday" | "got_home") : "created";

  const entries: TimelineEntry[] = rows.map((row) => {
    const photo = mapPhoto(row);
    const day = dayIndexOf(anchor, photo.shotAt);
    return { photo, day, date: localDate(photo.shotAt), dateSource: photo.shotAtSource, milestone: milestoneLabel(day) };
  });

  /*
   * 里程碑取「已经过去的」那些。
   *
   * 天数按 memorialSince 封口：已离开的宠物不该冒出一个尚未到来的「第 1000 天」，
   * 那是一件不会发生的事。
   */
  const totalDays = daysSince(anchor, memorialSince);
  const dateByDay = new Map(entries.map((entry) => [entry.day, entry.date]));
  const milestones = MILESTONE_DAYS.filter((day) => day <= totalDays).map((day) => ({
    day,
    label: milestoneLabel(day) as string,
    date: dateByDay.get(day),
  }));

  return { petId: String(pet.id), petName: String(pet.name), anchor, anchorType, totalDays, memorialSince, entries, milestones };
}

/**
 * 去年今日：同一宠物、拍摄日的月日与今天相同、年份更早的照片。
 *
 * **命中才推送，没有就静默，不要硬凑。** 硬凑出来的「回忆」是产品的表演，
 * 而这个功能的全部价值在于它确实是用户自己的那一天。
 *
 * 只认真实拍摄时间（`shot_at IS NOT NULL`）：上传时间的月日撞上今天纯属巧合，
 * 拿它说「去年今日」是假的。
 *
 * @param now 注入当天，便于测试
 */
export async function findOnThisDay(userId: string, now = new Date()) {
  const database = await getDatabase();
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const rows = await database.query(
    `SELECT ph.*, p.name pet_name, p.birthday, p.date_type, p.created_at pet_created_at
       FROM photos ph JOIN pets p ON p.id = ph.pet_id
      WHERE ph.user_id=$1 AND ph.deleted_at IS NULL AND p.deleted_at IS NULL
        AND ph.shot_at IS NOT NULL
        AND EXTRACT(MONTH FROM ph.shot_at)=$2 AND EXTRACT(DAY FROM ph.shot_at)=$3
        AND ph.shot_at < $4
      ORDER BY ph.shot_at DESC`,
    [userId, month, day, new Date(now.getFullYear(), now.getMonth(), now.getDate())],
  );
  return rows.map((row) => {
    const photo = mapPhoto(row);
    const anchor = anchorOf({
      birthday: row.birthday ? String(row.birthday) : undefined,
      createdAt: row.pet_created_at instanceof Date ? row.pet_created_at.toISOString() : (row.pet_created_at ? String(row.pet_created_at) : undefined),
    });
    const shotDay = startOfLocalDay(photo.shotAt);
    return {
      photo,
      petId: photo.petId,
      petName: String(row.pet_name),
      date: localDate(photo.shotAt),
      /** 那天是相处的第几天 */
      day: dayIndexOf(anchor, photo.shotAt),
      /** 距今几年。1 才说「去年今日」，2 以上说「N 年前的今天」 */
      yearsAgo: shotDay ? now.getFullYear() - shotDay.getFullYear() : 0,
    };
  });
}

/**
 * 用户是否授权过「去年今日」的订阅消息（改造项 E2）。
 *
 * 微信订阅消息是「一次授权一次下发」，无授权下发会被平台拦截，
 * 且可能影响小程序信誉 —— 这是合规与技术双重问题。
 *
 * 判定条件与 `subscribeReminder` 写入的形态对齐：那条路径要求
 * `consent: z.literal(true)`，授权通过时写 `status='active'`、
 * 拒绝时写 `authorization_required`。所以有效授权 = 存在一条
 * `event_type='on_this_day'` 且 `status='active'` 且未撤销的记录。
 *
 * **不接受 `scheduled`**：那是投递排期状态而不是授权凭据。
 * 原实现的缺陷正是「凭空插一条 status='scheduled' 当授权」，
 * 而 `processDueMessages` 取 `status IN ('active','scheduled')` 会直接投递它。
 */
async function findOnThisDayConsent(userId: string) {
  const rows = await (await getDatabase()).query(
    "SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type='on_this_day' AND status='active' AND revoked_at IS NULL ORDER BY created_at LIMIT 1",
    [userId],
  );
  return rows[0] ? String(rows[0].id) : undefined;
}

/**
 * 为「去年今日」排一条订阅消息。命中才写，没有就返回 0。
 *
 * 走已有的 `message_subscriptions` 通道（`event_type='on_this_day'`），
 * 同一天只写一条 —— Worker 每 60 秒跑一轮运维动作，重复调用不该堆出多条。
 *
 * **必须先过授权门（E2）。** 未授权时返回 `{ scheduled: 0, reason: "no_consent" }`
 * 而不是抛错：这条在 Worker 的批量轮次里跑，一个未授权用户不该中断整轮；
 * 且「没有授权」是正常状态而不是异常 —— 端上仍可静默展示回忆（见 /api/on-this-day），
 * 只是不推送。
 */
export async function scheduleOnThisDay(userId: string, now = new Date()) {
  const matches = await findOnThisDay(userId, now);
  if (!matches.length) return { scheduled: 0 };
  /*
   * 授权检查放在命中判定**之后**：没命中就不必查授权（省一次查询），
   * 而顺序反过来对结果没有影响 —— 两个条件都必须成立才写。
   */
  const consentId = await findOnThisDayConsent(userId);
  if (!consentId) return { scheduled: 0, reason: "no_consent" as const };
  const database = await getDatabase();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const existing = await database.query(
    "SELECT id FROM message_subscriptions WHERE user_id=$1 AND event_type='on_this_day' AND status='scheduled' AND scheduled_at>=$2 AND scheduled_at<$3",
    [userId, dayStart, dayEnd],
  );
  if (existing[0]) return { scheduled: 0 };
  const first = matches[0];
  /*
   * **一次授权一次下发。** 微信订阅消息的授权是单次消耗品，
   * 拿一条 active 授权反复推送同样会被平台拦截 —— 补了授权门却不消耗授权，
   * 只是把「从不授权」换成「授权一次、推送无限次」，合规状态没有改善。
   *
   * 所以排期与消耗必须成对发生：把这条授权标记为已用（`status='consumed'`），
   * 下一次推送要求用户重新授权。用 `consumed` 而不是 `sent` ——
   * `sent` 是投递结果，这条授权记录本身从未被投递。
   */
  await database.query("UPDATE message_subscriptions SET status='consumed',status_updated_at=now() WHERE id=$1 AND status='active'", [consentId]);
  await database.query(
    "INSERT INTO message_subscriptions (id,user_id,pet_id,event_type,template_code,status,scheduled_at,consented_at,created_at) VALUES ($1,$2,$3,'on_this_day','on-this-day-v1','scheduled',$4,$5,$5)",
    [crypto.randomUUID(), userId, first.petId, now, now],
  );
  return { scheduled: 1, petId: first.petId, date: first.date, yearsAgo: first.yearsAgo };
}

/**
 * 「去年今日」当前是否有有效授权。供端上决定要不要展示授权按钮。
 *
 * 端上的展示不依赖授权 —— 命中的回忆一律直接显示（`findOnThisDay`），
 * 授权只影响「明年这天要不要推送提醒」。把这两件事混在一起会让
 * 未授权用户连自己的回忆都看不到，而那是他自己的照片。
 */
export async function onThisDayConsentState(userId: string) {
  return { consented: Boolean(await findOnThisDayConsent(userId)) };
}

/** 对所有用户跑一轮「去年今日」。命中的用户才会有记录 */
export async function scheduleAllOnThisDay(now = new Date()) {
  const users = await (await getDatabase()).query("SELECT id FROM users");
  let count = 0;
  for (const user of users) count += (await scheduleOnThisDay(String(user.id), now)).scheduled;
  return count;
}

/**
 * 成长对比：给定宠物，挑出相隔最远的两张照片。
 *
 * 供 `growth-compare-v1` 生成器与叙事视频的「成长对比」段使用。
 * 只有一张照片时返回 undefined，由调用方决定降级，而不是拿同一张照片比自己。
 */
export async function pickGrowthPair(userId: string, petId: string) {
  const timeline = await getPetTimeline(userId, petId, { order: "asc", limit: 500 });
  if (timeline.entries.length < 2) return undefined;
  const earliest = timeline.entries[0];
  const latest = timeline.entries[timeline.entries.length - 1];
  return {
    petName: timeline.petName,
    earliest,
    latest,
    /** 两张照片相隔的天数 */
    gapDays: Math.max(0, latest.day - earliest.day),
  };
}
