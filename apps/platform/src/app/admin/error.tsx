"use client";

import { useEffect } from "react";
import { RotateCcw, TriangleAlert } from "lucide-react";

import { buttonClass } from "@/components/admin/ui";

/** 后台页面的错误边界：保留外壳与导航，只替换内容区，可就地重试。 */
export default function AdminError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => { console.error(error); }, [error]);
  return (
    <div role="alert" className="mx-auto mt-16 max-w-md rounded-2xl border border-line bg-surface p-8 text-center shadow-card">
      <span className="mx-auto grid size-11 place-items-center rounded-full bg-[color-mix(in_srgb,var(--critical)_12%,transparent)] text-critical-ink"><TriangleAlert aria-hidden className="size-5" /></span>
      <h1 className="mt-4 text-base font-semibold text-ink">这一页没有加载出来</h1>
      <p className="mt-1 text-sm text-ink-2">数据查询失败或超时。可以重试；如果持续出现，请把下面的编号发给研发。</p>
      {error.digest ? <p className="mt-3 font-mono text-xs text-muted">{error.digest}</p> : null}
      <button type="button" onClick={reset} className={`${buttonClass("primary")} mt-6`}><RotateCcw className="size-4" />重试</button>
    </div>
  );
}
