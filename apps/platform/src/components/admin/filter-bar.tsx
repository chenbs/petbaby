import Form from "next/form";
import { Search } from "lucide-react";

import { buttonClass, cn } from "./ui";

/*
 * 列表页的筛选条：GET 表单，状态全在 URL 里（可分享、可回退、刷新不丢）。
 * 服务端组件即可渲染，不需要客户端状态。
 */

export type FilterSelect = { name: string; label: string; value?: string; options: Array<{ value: string; label: string }> };

const control = "h-9 rounded-lg border border-line bg-surface px-3 text-sm text-ink focus:border-focus focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--focus)_25%,transparent)]";

export function FilterBar({ action, q, placeholder = "搜索", selects = [], hidden = {}, className }: { action: string; q?: string; placeholder?: string; selects?: FilterSelect[]; hidden?: Record<string, string | undefined>; className?: string }) {
  return (
    <Form action={action} className={cn("flex flex-wrap items-center gap-2", className)}>
      {Object.entries(hidden).map(([name, value]) => (value ? <input key={name} type="hidden" name={name} value={value} /> : null))}
      <div className="relative min-w-56 flex-1 sm:max-w-sm">
        <Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
        <label className="sr-only" htmlFor={`${action}-q`}>{placeholder}</label>
        <input id={`${action}-q`} name="q" defaultValue={q} placeholder={placeholder} className={cn(control, "w-full pl-9")} />
      </div>
      {selects.map((select) => (
        <label key={select.name} className="inline-flex items-center gap-2 text-xs text-muted">
          <span className="sr-only sm:not-sr-only">{select.label}</span>
          <select name={select.name} defaultValue={select.value || ""} className={control}>
            {select.options.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </label>
      ))}
      <button type="submit" className={buttonClass("primary")}>筛选</button>
    </Form>
  );
}
