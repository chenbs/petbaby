import Link from "next/link";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { LucideIcon } from "lucide-react";
import { ArrowDownRight, ArrowUpRight, ChevronLeft, ChevronRight, Minus } from "lucide-react";

import { statusLabel, type Tone } from "@/lib/admin-labels";
import { changeRatio, formatPercent } from "@/lib/admin-format";

/*
 * 运营后台的基础组件（服务端可直接渲染，不含状态）。
 * 交互件（对话框、下拉、图表）在同目录的 *-client.tsx。
 */

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: string; actions?: React.ReactNode; eyebrow?: string }) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4 pb-6">
      <div className="min-w-0">
        {eyebrow ? <p className="mb-1 text-xs font-medium text-muted">{eyebrow}</p> : null}
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="mt-1 max-w-2xl text-sm text-ink-2">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  );
}

export function Card({ className, children, ...props }: React.HTMLAttributes<HTMLElement>) {
  return <section className={cn("rounded-xl border border-line bg-surface shadow-card", className)} {...props}>{children}</section>;
}

export function CardHeader({ title, description, actions, className }: { title: React.ReactNode; description?: React.ReactNode; actions?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-start justify-between gap-3 px-5 pt-4", className)}>
      <div className="min-w-0">
        <h2 className="text-sm font-semibold text-ink">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function CardBody({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 pb-5 pt-4", className)}>{children}</div>;
}

const toneClasses: Record<Tone, string> = {
  neutral: "bg-surface-3 text-ink-2",
  good: "bg-[color-mix(in_srgb,var(--good)_14%,transparent)] text-good-ink",
  warning: "bg-[color-mix(in_srgb,var(--warning)_20%,transparent)] text-[#8a5a00] dark:text-[#f3c560]",
  critical: "bg-[color-mix(in_srgb,var(--critical)_12%,transparent)] text-critical-ink",
  info: "bg-[color-mix(in_srgb,var(--focus)_12%,transparent)] text-[#1c5cab] dark:text-[#9ec5f4]",
};

const toneDots: Record<Tone, string> = {
  neutral: "bg-muted",
  good: "bg-good",
  warning: "bg-warning",
  critical: "bg-critical",
  info: "bg-focus",
};

export function Badge({ tone = "neutral", children, className, dot = true }: { tone?: Tone; children: React.ReactNode; className?: string; dot?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", toneClasses[tone], className)}>
      {dot ? <span aria-hidden className={cn("size-1.5 rounded-full", toneDots[tone])} /> : null}
      {children}
    </span>
  );
}

/** 状态徽标：颜色之外必带文字，状态从不只靠颜色表达。 */
export function StatusBadge({ status }: { status: unknown }) {
  const { label, tone } = statusLabel(status);
  return <Badge tone={tone}>{label}</Badge>;
}

const buttonVariants = {
  primary: "bg-ink text-surface hover:bg-ink/85",
  accent: "bg-accent text-white hover:brightness-95",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "bg-critical text-white hover:brightness-95",
} as const;

export type ButtonVariant = keyof typeof buttonVariants;

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md") {
  return cn(
    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-7 px-2.5 text-xs" : "h-9 px-3.5 text-sm",
    buttonVariants[variant],
  );
}

export function LinkButton({ href, variant = "secondary", size = "md", children, className, prefetch }: { href: string; variant?: ButtonVariant; size?: "sm" | "md"; children: React.ReactNode; className?: string; prefetch?: boolean }) {
  return <Link href={href} prefetch={prefetch} className={cn(buttonClass(variant, size), className)}>{children}</Link>;
}

export function Delta({ current, previous, positiveIsGood = true, format = "percent" }: { current: number; previous: number; positiveIsGood?: boolean; format?: "percent" | "points" }) {
  const ratio = format === "points" ? current - previous : changeRatio(current, previous);
  if (ratio === null) return <span className="text-xs text-muted">上期为 0</span>;
  const flat = Math.abs(ratio) < 0.0005;
  const up = ratio > 0;
  const good = flat ? null : up === positiveIsGood;
  const Icon = flat ? Minus : up ? ArrowUpRight : ArrowDownRight;
  const text = format === "points" ? `${up ? "+" : ""}${(ratio * 100).toFixed(1)} 个百分点` : `${up ? "+" : ""}${formatPercent(ratio)}`;
  return (
    <span className={cn("inline-flex items-center gap-0.5 text-xs font-medium tnum", good === null ? "text-muted" : good ? "text-good-ink" : "text-critical-ink")}>
      <Icon aria-hidden className="size-3.5" />
      {flat ? "持平" : text}
      <span className="sr-only">（{good === null ? "持平" : good ? "向好" : "变差"}）</span>
    </span>
  );
}

export function EmptyState({ icon: Icon, title, description, className }: { icon?: LucideIcon; title: string; description?: string; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center gap-2 px-6 py-12 text-center", className)}>
      {Icon ? <span className="grid size-10 place-items-center rounded-full bg-surface-2 text-muted"><Icon aria-hidden className="size-5" /></span> : null}
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-xs text-muted">{description}</p> : null}
    </div>
  );
}

/* ---------------------------------------------------------------- 表格 */

export function Table({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={cn("scrollbar-thin overflow-x-auto", className)}>
      <table className="w-full min-w-max border-collapse text-left text-sm">{children}</table>
    </div>
  );
}

export function Th({ children, className, align = "left" }: { children?: React.ReactNode; className?: string; align?: "left" | "right" | "center" }) {
  return <th scope="col" className={cn("h-9 border-b border-line bg-surface-2/60 px-4 text-xs font-medium whitespace-nowrap text-muted first:pl-5 last:pr-5", align === "right" && "text-right", align === "center" && "text-center", className)}>{children}</th>;
}

export function Td({ children, className, align = "left", title }: { children?: React.ReactNode; className?: string; align?: "left" | "right" | "center"; title?: string }) {
  return <td title={title} className={cn("border-b border-line px-4 py-2.5 align-middle text-ink first:pl-5 last:pr-5", align === "right" && "text-right tnum", align === "center" && "text-center", className)}>{children}</td>;
}

export function Tr({ children, className }: { children: React.ReactNode; className?: string }) {
  return <tr className={cn("transition-colors hover:bg-surface-2/60 [&:last-child>td]:border-b-0", className)}>{children}</tr>;
}

/* ---------------------------------------------------------------- 分页（纯链接，可分享、可回退） */

export function Pagination({ page, pageSize, total, hrefFor }: { page: number; pageSize: number; total: number; hrefFor: (page: number) => string }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const from = total ? (page - 1) * pageSize + 1 : 0;
  const to = Math.min(total, page * pageSize);
  return (
    <nav aria-label="分页" className="flex items-center justify-between gap-3 border-t border-line px-5 py-3 text-xs text-muted">
      <span className="tnum">第 {from}–{to} 条，共 {total.toLocaleString("zh-CN")} 条</span>
      <div className="flex items-center gap-1">
        {page > 1 ? <Link className={buttonClass("ghost", "sm")} href={hrefFor(page - 1)} aria-label="上一页"><ChevronLeft className="size-4" /></Link> : <span className={cn(buttonClass("ghost", "sm"), "opacity-40")} aria-hidden><ChevronLeft className="size-4" /></span>}
        <span className="px-2 tnum text-ink-2">{page} / {pages}</span>
        {page < pages ? <Link className={buttonClass("ghost", "sm")} href={hrefFor(page + 1)} aria-label="下一页"><ChevronRight className="size-4" /></Link> : <span className={cn(buttonClass("ghost", "sm"), "opacity-40")} aria-hidden><ChevronRight className="size-4" /></span>}
      </div>
    </nav>
  );
}

/** 分段切换（以链接实现，状态在 URL 里）。 */
export function SegmentLinks({ items, active, label }: { items: Array<{ key: string; label: React.ReactNode; href: string }>; active: string; label: string }) {
  return (
    <nav aria-label={label} className="inline-flex rounded-lg border border-line bg-surface-2 p-0.5">
      {items.map((item) => (
        <Link
          key={item.key}
          href={item.href}
          aria-current={item.key === active ? "page" : undefined}
          className={cn("rounded-md px-3 py-1 text-xs font-medium transition-colors", item.key === active ? "bg-surface text-ink shadow-card" : "text-muted hover:text-ink")}
        >
          {item.label}
        </Link>
      ))}
    </nav>
  );
}

export function KeyValue({ items, className }: { items: Array<{ label: string; value: React.ReactNode }>; className?: string }) {
  return (
    <dl className={cn("grid grid-cols-[auto_1fr] gap-x-6 gap-y-2.5 text-sm", className)}>
      {items.map((item) => (
        <div key={item.label} className="contents">
          <dt className="text-muted">{item.label}</dt>
          <dd className="min-w-0 truncate text-ink">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Mono({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn("font-mono text-xs text-ink-2", className)}>{children}</span>;
}

/** 构造带查询参数的链接：只保留有值的键。 */
export function withQuery(path: string, params: Record<string, string | number | undefined | null>) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) if (value !== undefined && value !== null && value !== "") query.set(key, String(value));
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}
