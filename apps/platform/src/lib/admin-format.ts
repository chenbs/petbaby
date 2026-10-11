/** 运营后台的数字与时间格式。前后端共用：服务端组件直接渲染，客户端图表 tooltip 也读这里。 */

const integer = new Intl.NumberFormat("zh-CN", { maximumFractionDigits: 0 });

export function formatCount(value: number | null | undefined) {
  return integer.format(Number(value || 0));
}

/** 大数字压缩：12,345 → 1.2 万；仅用于卡片主数字，表格里一律写全。 */
export function formatCompact(value: number | null | undefined) {
  const number = Number(value || 0);
  if (Math.abs(number) >= 100_000_000) return `${trim(number / 100_000_000)} 亿`;
  if (Math.abs(number) >= 10_000) return `${trim(number / 10_000)} 万`;
  return integer.format(number);
}

function trim(value: number) {
  return value.toFixed(value >= 100 ? 0 : 1).replace(/\.0$/, "");
}

export function formatYuan(value: number | null | undefined, options: { compact?: boolean } = {}) {
  const number = Number(value || 0);
  if (options.compact && Math.abs(number) >= 10_000) return `¥${formatCompact(number)}`;
  return `¥${number.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatPercent(value: number | null | undefined, digits = 1) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(digits)}%`;
}

/** 相对上一周期的变化率；上期为 0 时不给百分比（无穷大没有意义）。 */
export function changeRatio(current: number, previous: number) {
  if (!previous) return current ? null : 0;
  return (current - previous) / previous;
}

const shanghai = "Asia/Shanghai";

export function formatDateTime(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("zh-CN", { timeZone: shanghai, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function formatDate(value: string | Date | null | undefined) {
  if (!value) return "—";
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("zh-CN", { timeZone: shanghai, year: "numeric", month: "2-digit", day: "2-digit" });
}

/** 「3 分钟前」式的相对时间，超过 30 天退回日期。 */
export function formatRelative(value: string | Date | null | undefined, now = Date.now()) {
  if (!value) return "—";
  const time = (value instanceof Date ? value : new Date(value)).getTime();
  if (Number.isNaN(time)) return "—";
  const seconds = Math.round((now - time) / 1000);
  if (seconds < 60) return "刚刚";
  if (seconds < 3600) return `${Math.floor(seconds / 60)} 分钟前`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} 小时前`;
  if (seconds < 30 * 86_400) return `${Math.floor(seconds / 86_400)} 天前`;
  return formatDate(value);
}

/** 图表横轴：2026-10-11 → 10/11 */
export function shortDay(day: string) {
  const [, month, date] = day.split("-");
  return month && date ? `${Number(month)}/${Number(date)}` : day;
}

export function shortId(value: unknown, length = 8) {
  const text = String(value ?? "");
  return text ? text.slice(0, length) : "—";
}
