"use client";

import { useState, type ReactNode } from "react";

import { apiFetch } from "@/lib/api";

type DisclosureStatus = { acknowledged: boolean; policyVersion: string; text: string };

/*
 * 保存生成类原图的链接。
 *
 * 原图上没有可见标识，所以第一次下载前要确认标识义务（第九条）：
 * 未确认时服务端返回 428 AI_DISCLOSURE_REQUIRED，这里先确认、再跳转下载。
 * 非生成类作品（aiGenerated=false）直接是普通链接。
 */
export function AiDisclosureLink({ href, aiGenerated, className, children }: { href: string; aiGenerated: boolean; className?: string; children: ReactNode }) {
  const [busy, setBusy] = useState(false);
  if (!aiGenerated) return <a className={className} href={href}>{children}</a>;
  async function open(event: React.MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const status = await apiFetch<DisclosureStatus>("/api/account/ai-disclosure");
      if (!status.acknowledged) {
        if (!window.confirm(status.text)) return;
        await apiFetch<DisclosureStatus>("/api/account/ai-disclosure", { method: "POST", body: JSON.stringify({ channel: "web" }) });
      }
      window.location.href = href;
    } finally {
      setBusy(false);
    }
  }
  return <a aria-busy={busy} className={className} href={href} onClick={open}>{children}</a>;
}
