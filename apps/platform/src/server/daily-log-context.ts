import "server-only";

import { getDatabase } from "@/server/db/client";
import { describeRecord } from "@/server/daily-log-kinds";

/*
 * 日常记录 → 文字行。健康助手的分诊上下文、就医摘要与健康档案 PDF 共用。
 * 单独成模块：health-service 要读它，而 daily-log-service 又要调 health-service 的体重 / 疫苗写入，
 * 放在一起会形成循环依赖。
 */

export function asDateString(value: unknown): string {
  if (value instanceof Date) {
    return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, "0")}-${String(value.getDate()).padStart(2, "0")}`;
  }
  return String(value).slice(0, 10);
}

export function addDays(date: string, days: number) {
  const [year, month, day] = date.split("-").map(Number);
  return asDateString(new Date(year, month - 1, day + days));
}

export function todayString(now = new Date()) {
  return asDateString(now);
}

export type LogRow = { id: string; kind: string; occurred_on: unknown; occurred_time: unknown; details: Record<string, unknown> | null; note: unknown };

export const LOOSE_STOOL = new Set(["soft", "mushy", "watery"]);

/** 健康助手与就医摘要要看的类型：身体状况 + 用药 + 就医 */
export const MEDICAL_CONTEXT_KINDS = ["vomit", "stool", "symptom", "medication", "visit", "meal", "water"];

export function recordLine(row: LogRow) {
  const described = describeRecord(String(row.kind), (row.details || {}) as Record<string, unknown>);
  const time = row.occurred_time ? ` ${row.occurred_time}` : "";
  const note = row.note ? `（${String(row.note).slice(0, 60)}）` : "";
  return `${asDateString(row.occurred_on).slice(5)}${time} ${described.title}${described.summary ? ` · ${described.summary}` : ""}${note}`;
}

/**
 * 最近几天的记录，按行给健康助手当上下文。
 *
 * 吃喝只收「没吃 / 吃了一点」与「比平时少 / 多」这类有信息量的，
 * 「吃完了」「差不多」每天都有，塞进上下文只会稀释真正的变化。
 */
export async function recentContextLines(userId: string, petId: string, days = 7, limit = 12) {
  const rows = await (await getDatabase()).query<LogRow>(
    "SELECT id,kind,occurred_on,occurred_time,details,note FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 AND kind=ANY($3::text[]) AND occurred_on >= $4::date ORDER BY occurred_on DESC, coalesce(occurred_time,'') DESC LIMIT 60",
    [petId, userId, MEDICAL_CONTEXT_KINDS, addDays(todayString(), -(days - 1))],
  );
  return rows.filter(isInformative).slice(0, limit).map(recordLine);
}

/** 吃喝只保留有变化的那几档；其余类型都保留 */
export function isInformative(row: LogRow) {
  const details = (row.details || {}) as Record<string, unknown>;
  if (row.kind === "meal") return ["none", "little", "half"].includes(String(details.appetite));
  if (row.kind === "water") return String(details.amount) !== "usual";
  return true;
}

/** 健康档案 PDF 用：近 30 天的身体状况 / 用药 / 就医记录行（年度档案按年份取）。 */
export async function documentRecordLines(userId: string, petId: string, year?: number) {
  const rows = year
    ? await (await getDatabase()).query<LogRow>(
      "SELECT id,kind,occurred_on,occurred_time,details,note FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 AND kind=ANY($3::text[]) AND extract(year from occurred_on)=$4 ORDER BY occurred_on DESC LIMIT 60",
      [petId, userId, ["vomit", "stool", "symptom", "medication", "visit"], year],
    )
    : await (await getDatabase()).query<LogRow>(
      "SELECT id,kind,occurred_on,occurred_time,details,note FROM pet_daily_logs WHERE pet_id=$1 AND user_id=$2 AND kind=ANY($3::text[]) AND occurred_on >= $4::date ORDER BY occurred_on DESC LIMIT 60",
      [petId, userId, ["vomit", "stool", "symptom", "medication", "visit"], addDays(todayString(), -29)],
    );
  return rows.map((row) => {
    const described = describeRecord(String(row.kind), (row.details || {}) as Record<string, unknown>);
    return `${asDateString(row.occurred_on)}　${described.title}${described.summary ? ` · ${described.summary}` : ""}`.slice(0, 48);
  });
}
