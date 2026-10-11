"use client";

import { useId, useState } from "react";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { BarChart3, Table2 } from "lucide-react";

import { formatCompact, formatCount, formatYuan, shortDay } from "@/lib/admin-format";
import { cn } from "./ui";

/*
 * 图表件（Recharts 3）。约定按 dataviz 规范：
 * - 分类色只用 4 个通过校验的槽位（admin.css 的 --series-1..4），按固定顺序分配，第 5 类及以后并入「其他」（灰）。
 * - 线 2px、柱宽 ≤ 24px、柱顶 4px 圆角、堆叠段之间 2px 底色缝；网格与坐标轴退到背景。
 * - ≥ 2 个系列必有图例；每张图都能切到数据表（浅色下青、黄两槽对底色不足 3:1，表格是必需的补救）。
 * - 文字一律用文字色，不染系列色。
 */

export type SeriesSpec = { key: string; label: string; color?: string };
export type ValueKind = "count" | "yuan" | "units";

const SLOT_COLORS = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)"];
const OTHER_COLOR = "var(--muted)";

function colorFor(series: SeriesSpec, index: number) {
  if (series.color) return series.color;
  if (series.key === "other") return OTHER_COLOR;
  return SLOT_COLORS[index] || OTHER_COLOR;
}

export function formatValue(value: number, kind: ValueKind = "count") {
  if (kind === "yuan") return formatYuan(value);
  if (kind === "units") return `${formatCount(value)} 颗`;
  return formatCount(value);
}

function axisValue(value: number, kind: ValueKind) {
  if (kind === "yuan") return `¥${formatCompact(value)}`;
  return formatCompact(value);
}

type Row = Record<string, string | number>;

/* ---------------------------------------------------------------- 外框：标题 + 图例 + 图表 / 表格切换 */

export function ChartFrame({ title, description, series, rows, valueKind = "count", children, xKey = "day", xLabel = "日期", className, aside }: {
  title: string;
  description?: string;
  series: SeriesSpec[];
  rows: Row[];
  valueKind?: ValueKind;
  children: React.ReactNode;
  xKey?: string;
  xLabel?: string;
  className?: string;
  aside?: React.ReactNode;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  return (
    <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3 px-5 pt-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink">{title}</h2>
          {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
        </div>
        <div className="flex items-center gap-3">
          {aside}
          <div role="group" aria-label="切换图表与数据表" className="inline-flex rounded-md border border-line p-0.5">
            <button type="button" aria-pressed={view === "chart"} onClick={() => setView("chart")} className={cn("grid size-6 place-items-center rounded", view === "chart" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")} title="图表"><BarChart3 className="size-3.5" /><span className="sr-only">图表</span></button>
            <button type="button" aria-pressed={view === "table"} onClick={() => setView("table")} className={cn("grid size-6 place-items-center rounded", view === "table" ? "bg-surface-3 text-ink" : "text-muted hover:text-ink")} title="数据表"><Table2 className="size-3.5" /><span className="sr-only">数据表</span></button>
          </div>
        </div>
      </div>
      {series.length > 1 ? <Legend series={series} /> : null}
      <div className="px-3 pb-4 pt-3">
        {view === "chart" ? children : <DataTable series={series} rows={rows} valueKind={valueKind} xKey={xKey} xLabel={xLabel} />}
      </div>
    </section>
  );
}

export function Legend({ series, kind = "rect" }: { series: SeriesSpec[]; kind?: "rect" | "line" }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 px-5 pt-3 text-xs text-ink-2">
      {series.map((item, index) => (
        <li key={item.key} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={kind === "line" ? "h-0.5 w-3 rounded-full" : "size-2.5 rounded-[3px]"} style={{ background: colorFor(item, index) }} />
          {item.label}
        </li>
      ))}
    </ul>
  );
}

function DataTable({ series, rows, valueKind, xKey, xLabel }: { series: SeriesSpec[]; rows: Row[]; valueKind: ValueKind; xKey: string; xLabel: string }) {
  return (
    <div className="scrollbar-thin max-h-72 overflow-auto px-2">
      <table className="w-full text-left text-xs">
        <thead className="sticky top-0 bg-surface">
          <tr className="text-muted">
            <th scope="col" className="py-2 pr-4 font-medium">{xLabel}</th>
            {series.map((item) => <th scope="col" key={item.key} className="py-2 pr-4 text-right font-medium">{item.label}</th>)}
          </tr>
        </thead>
        <tbody className="tnum">
          {rows.map((row) => (
            <tr key={String(row[xKey])} className="border-t border-line">
              <td className="py-1.5 pr-4 text-ink-2">{String(row[xKey])}</td>
              {series.map((item) => <td key={item.key} className="py-1.5 pr-4 text-right text-ink">{formatValue(Number(row[item.key] || 0), valueKind)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------- tooltip：值在前、名在后，用短线标识系列 */

type TooltipPayload = { dataKey?: string | number; value?: number | string; color?: string };

function ChartTooltip({ active, payload, label, series, valueKind, total }: { active?: boolean; payload?: TooltipPayload[]; label?: string | number; series: SeriesSpec[]; valueKind: ValueKind; total?: boolean }) {
  if (!active || !payload?.length) return null;
  const values = series.map((item, index) => ({ item, index, value: Number(payload.find((entry) => entry.dataKey === item.key)?.value || 0) }));
  const sum = values.reduce((acc, entry) => acc + entry.value, 0);
  return (
    <div className="min-w-40 rounded-lg border border-line bg-surface px-3 py-2 text-xs shadow-pop">
      <p className="mb-1.5 font-medium text-ink-2">{String(label)}</p>
      <ul className="space-y-1">
        {values.slice().reverse().map(({ item, index, value }) => (
          <li key={item.key} className="flex items-center justify-between gap-4">
            <span className="inline-flex items-center gap-1.5 text-muted"><span aria-hidden className="h-0.5 w-3 rounded-full" style={{ background: colorFor(item, index) }} />{item.label}</span>
            <b className="font-semibold text-ink tnum">{formatValue(value, valueKind)}</b>
          </li>
        ))}
      </ul>
      {total && series.length > 1 ? <p className="mt-1.5 flex justify-between border-t border-line pt-1.5 text-muted"><span>合计</span><b className="font-semibold text-ink tnum">{formatValue(sum, valueKind)}</b></p> : null}
    </div>
  );
}

const axisProps = {
  tickLine: false,
  axisLine: false,
  tick: { fill: "var(--muted)", fontSize: 11 },
} as const;

function tickInterval(length: number) {
  if (length <= 10) return 0;
  return Math.ceil(length / 8) - 1;
}

/* ---------------------------------------------------------------- 趋势：多系列折线 / 单系列面积 */

export function TrendChart({ rows, series, valueKind = "count", height = 240, area = false }: { rows: Row[]; series: SeriesSpec[]; valueKind?: ValueKind; height?: number; area?: boolean }) {
  const gradientId = useId().replace(/:/g, "");
  const data = rows.map((row) => ({ ...row, label: shortDay(String(row.day)) }));
  const single = series.length === 1 && area;
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        {single ? (
          <AreaChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={colorFor(series[0], 0)} stopOpacity={0.16} />
                <stop offset="100%" stopColor={colorFor(series[0], 0)} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axisProps} interval={tickInterval(data.length)} minTickGap={8} />
            <YAxis {...axisProps} width={48} tickFormatter={(value: number) => axisValue(value, valueKind)} allowDecimals={false} />
            <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<ChartTooltip series={series} valueKind={valueKind} />} />
            <Area type="monotone" dataKey={series[0].key} stroke={colorFor(series[0], 0)} strokeWidth={2} fill={`url(#${gradientId})`} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} dot={false} isAnimationActive={false} />
          </AreaChart>
        ) : (
          <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="label" {...axisProps} interval={tickInterval(data.length)} minTickGap={8} />
            <YAxis {...axisProps} width={48} tickFormatter={(value: number) => axisValue(value, valueKind)} allowDecimals={false} />
            <Tooltip cursor={{ stroke: "var(--axis)", strokeWidth: 1 }} content={<ChartTooltip series={series} valueKind={valueKind} />} />
            {series.map((item, index) => (
              <Line key={item.key} type="monotone" dataKey={item.key} stroke={colorFor(item, index)} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" dot={false} activeDot={{ r: 4, strokeWidth: 2, stroke: "var(--surface)" }} isAnimationActive={false} />
            ))}
          </LineChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- 堆叠柱：构成随时间变化 */

export function StackedBars({ rows, series, valueKind = "count", height = 240 }: { rows: Row[]; series: SeriesSpec[]; valueKind?: ValueKind; height?: number }) {
  const data = rows.map((row) => ({ ...row, label: shortDay(String(row.day)) }));
  return (
    <div style={{ height }} className="w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: 0 }} barCategoryGap="22%">
          <CartesianGrid vertical={false} stroke="var(--grid)" />
          <XAxis dataKey="label" {...axisProps} interval={tickInterval(data.length)} minTickGap={8} />
          <YAxis {...axisProps} width={52} tickFormatter={(value: number) => axisValue(value, valueKind)} allowDecimals={valueKind === "yuan"} />
          <Tooltip cursor={{ fill: "var(--surface-2)" }} content={<ChartTooltip series={series} valueKind={valueKind} total />} />
          {series.map((item, index) => (
            <Bar
              key={item.key}
              dataKey={item.key}
              stackId="stack"
              fill={colorFor(item, index)}
              stroke="var(--surface)"
              // 描边居中在边上：2px 描边 = 相邻两段之间 2px 底色缝
              strokeWidth={series.length > 1 ? 2 : 0}
              maxBarSize={24}
              radius={index === series.length - 1 ? [4, 4, 0, 0] : 0}
              isAnimationActive={false}
            />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/* ---------------------------------------------------------------- 迷你趋势：KPI 卡片内，不带坐标轴 */

export function Sparkline({ values, label }: { values: number[]; label: string }) {
  const data = values.map((value, index) => ({ index, value }));
  if (data.length < 2) return null;
  return (
    <div className="h-9 w-full" role="img" aria-label={`${label}趋势`}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 2, bottom: 4, left: 2 }}>
          <YAxis hide domain={["dataMin", "dataMax"]} />
          <Line type="monotone" dataKey="value" stroke="var(--series-1)" strokeWidth={2} dot={false} isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
