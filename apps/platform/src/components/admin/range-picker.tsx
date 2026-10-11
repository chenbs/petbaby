"use client";

import { useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Popover } from "radix-ui";
import { Calendar, Check, ChevronDown } from "lucide-react";

import { RANGE_PRESETS, type RangePresetId } from "@/lib/admin-range";
import { buttonClass, cn } from "./ui";
import { inputClass } from "./action-dialog";

/** 统计区间选择：预设在前、自定义在底部。状态在 URL 里，刷新和分享都能还原。 */
export function RangePicker({ preset, from, to, label }: { preset: RangePresetId; from: string; to: string; label: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const [customFrom, setCustomFrom] = useState(from);
  const [customTo, setCustomTo] = useState(to);

  function go(next: Record<string, string | undefined>) {
    const query = new URLSearchParams(searchParams.toString());
    for (const key of ["range", "from", "to", "page"]) query.delete(key);
    for (const [key, value] of Object.entries(next)) if (value) query.set(key, value);
    setOpen(false);
    router.push(`${pathname}?${query}`);
  }

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger className={cn(buttonClass("secondary"), "min-w-36 justify-between")}>
        <span className="inline-flex items-center gap-2"><Calendar className="size-4 text-muted" />{label}</span>
        <ChevronDown className="size-4 text-muted" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content align="end" sideOffset={6} className="z-50 w-64 rounded-xl border border-line bg-surface p-1.5 shadow-pop">
          <ul role="listbox" aria-label="统计区间">
            {RANGE_PRESETS.map((item) => (
              <li key={item.id}>
                <button type="button" role="option" aria-selected={preset === item.id} onClick={() => go({ range: item.id })} className="flex w-full items-center justify-between rounded-lg px-3 py-2 text-sm text-ink hover:bg-surface-2">
                  {item.label}
                  {preset === item.id ? <Check className="size-4" strokeWidth={2.5} /> : null}
                </button>
              </li>
            ))}
          </ul>
          <form
            className="mt-1 space-y-2 border-t border-line px-2 pb-1.5 pt-3"
            onSubmit={(event) => { event.preventDefault(); if (customFrom && customTo && customFrom <= customTo) go({ range: "custom", from: customFrom, to: customTo }); }}
          >
            <p className="text-xs font-medium text-muted">自定义（北京时间）</p>
            <div className="grid grid-cols-2 gap-2">
              <input aria-label="开始日期" type="date" value={customFrom} max={customTo} onChange={(event) => setCustomFrom(event.target.value)} className={cn(inputClass, "px-2 py-1.5 text-xs")} />
              <input aria-label="结束日期" type="date" value={customTo} min={customFrom} onChange={(event) => setCustomTo(event.target.value)} className={cn(inputClass, "px-2 py-1.5 text-xs")} />
            </div>
            <button type="submit" className={cn(buttonClass("primary", "sm"), "w-full")}>应用{preset === "custom" ? <Check className="size-3.5" /> : null}</button>
          </form>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
