/*
 * 运营后台的统计区间。所有「按天」口径一律按北京时间切日（用户与运营都在东八区），
 * 与数据库会话时区无关：SQL 侧用 timezone('Asia/Shanghai', ts)，这里给出左闭右开的时刻边界。
 */

export const ADMIN_TIMEZONE = "Asia/Shanghai";
const OFFSET = "+08:00";
const DAY_MS = 24 * 60 * 60 * 1000;

export const RANGE_PRESETS = [
  { id: "today", label: "今天", days: 1 },
  { id: "7d", label: "近 7 天", days: 7 },
  { id: "30d", label: "近 30 天", days: 30 },
  { id: "90d", label: "近 90 天", days: 90 },
] as const;

export type RangePresetId = (typeof RANGE_PRESETS)[number]["id"] | "custom";

export type AdminRange = {
  preset: RangePresetId;
  /** 含首尾的北京日期 YYYY-MM-DD */
  from: string;
  to: string;
  days: number;
  /** 等长的上一周期，用于环比 */
  previousFrom: string;
  previousTo: string;
};

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS = 366;

/** 北京时间的「今天」 */
export function shanghaiToday(now = new Date()) {
  return new Date(now.getTime() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function addDays(date: string, days: number) {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS) + 1;
}

function validDate(value: unknown): value is string {
  return typeof value === "string" && DATE_PATTERN.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
}

function first(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export function resolveAdminRange(params: Record<string, string | string[] | undefined> = {}, now = new Date()): AdminRange {
  const today = shanghaiToday(now);
  const presetParam = first(params.range);
  let from: string;
  let to: string;
  let preset: RangePresetId;
  const fromParam = first(params.from);
  const toParam = first(params.to);
  if (presetParam === "custom" && validDate(fromParam) && validDate(toParam) && fromParam <= toParam) {
    preset = "custom";
    to = toParam > today ? today : toParam;
    from = fromParam > to ? to : fromParam;
    if (daysBetween(from, to) > MAX_DAYS) from = addDays(to, -(MAX_DAYS - 1));
  } else {
    const found = RANGE_PRESETS.find((item) => item.id === presetParam) || RANGE_PRESETS[2];
    preset = found.id;
    to = today;
    from = addDays(today, -(found.days - 1));
  }
  const days = daysBetween(from, to);
  return { preset, from, to, days, previousFrom: addDays(from, -days), previousTo: addDays(from, -1) };
}

/** 北京日期 → 左闭右开的 UTC 时刻边界 */
export function rangeInstants(from: string, to: string) {
  return { start: new Date(`${from}T00:00:00${OFFSET}`), end: new Date(`${addDays(to, 1)}T00:00:00${OFFSET}`) };
}

export function rangeQuery(range: Pick<AdminRange, "preset" | "from" | "to">) {
  const query = new URLSearchParams({ range: range.preset });
  if (range.preset === "custom") { query.set("from", range.from); query.set("to", range.to); }
  return query.toString();
}

export function describeRange(range: AdminRange) {
  const preset = RANGE_PRESETS.find((item) => item.id === range.preset);
  return preset && range.preset !== "custom" ? preset.label : `${range.from} 至 ${range.to}`;
}
