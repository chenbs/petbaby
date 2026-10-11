import type { LucideIcon } from "lucide-react";

import { Sparkline } from "./charts";
import { Card, cn, Delta } from "./ui";

/*
 * 指标卡：标签 · 主数字 · 环比 · 迷你趋势。
 * 主数字用比例数字（不加 tabular-nums），表格列才用等宽数字。
 */
export function StatCard({ label, value, hint, current, previous, positiveIsGood = true, deltaFormat = "percent", trend, icon: Icon, className, emphasis = false }: {
  label: string;
  value: string;
  hint?: React.ReactNode;
  current?: number;
  previous?: number;
  positiveIsGood?: boolean;
  deltaFormat?: "percent" | "points";
  trend?: number[];
  icon?: LucideIcon;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <Card className={cn("flex flex-col gap-3 p-5", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs font-medium text-muted">{label}</p>
        {Icon ? <Icon aria-hidden className="size-4 text-muted" /> : null}
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <p className={cn("font-semibold tracking-tight text-ink", emphasis ? "text-[34px] leading-none" : "text-2xl leading-none")}>{value}</p>
        {current !== undefined && previous !== undefined ? <Delta current={current} previous={previous} positiveIsGood={positiveIsGood} format={deltaFormat} /> : null}
      </div>
      {trend ? <Sparkline values={trend} label={label} /> : null}
      {hint ? <p className="text-xs text-muted">{hint}</p> : null}
    </Card>
  );
}

/** 横向占比条（排行榜用）：一个色相，长短表示大小；数值写在条外，不靠颜色。 */
export function BarList({ items, format, emptyText = "暂无数据" }: { items: Array<{ key: string; label: React.ReactNode; value: number; sub?: React.ReactNode }>; format: (value: number) => string; emptyText?: string }) {
  const max = Math.max(1, ...items.map((item) => item.value));
  if (!items.length) return <p className="py-8 text-center text-xs text-muted">{emptyText}</p>;
  return (
    <ul className="space-y-2.5">
      {items.map((item) => (
        <li key={item.key} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1">
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2 text-sm">
              <span className="truncate text-ink">{item.label}</span>
            </div>
            <div className="mt-1 h-1.5 rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-series-1" style={{ width: `${Math.max(2, (item.value / max) * 100)}%` }} />
            </div>
          </div>
          <div className="text-right">
            <p className="text-sm font-medium text-ink tnum">{format(item.value)}</p>
            {item.sub ? <p className="text-[11px] text-muted tnum">{item.sub}</p> : null}
          </div>
        </li>
      ))}
    </ul>
  );
}

/** 漏斗：每一步写人数、相对首步的比例、相对上一步的转化；条长只是辅助。 */
export function Funnel({ steps }: { steps: Array<{ key: string; label: string; value: number }> }) {
  const first = steps[0]?.value || 0;
  return (
    <ol className="space-y-3">
      {steps.map((step, index) => {
        const previous = index ? steps[index - 1].value : step.value;
        const share = first ? step.value / first : 0;
        const conversion = previous ? step.value / previous : 0;
        return (
          <li key={step.key}>
            <div className="mb-1 flex items-baseline justify-between gap-3 text-sm">
              <span className="text-ink"><span className="mr-2 text-xs text-muted tnum">{index + 1}</span>{step.label}</span>
              <span className="text-ink tnum"><b className="font-semibold">{step.value.toLocaleString("zh-CN")}</b><span className="ml-2 text-xs text-muted">{first ? `${(share * 100).toFixed(1)}%` : "—"}</span></span>
            </div>
            <div className="h-2 rounded-full bg-surface-3">
              <div className="h-full rounded-full bg-series-1" style={{ width: `${Math.max(first ? 1.5 : 0, share * 100)}%` }} />
            </div>
            {index ? <p className="mt-1 text-[11px] text-muted">较上一步 {previous ? `${(conversion * 100).toFixed(1)}%` : "—"}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}
