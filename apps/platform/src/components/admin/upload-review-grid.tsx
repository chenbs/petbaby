"use client";
/* eslint-disable @next/next/no-img-element -- 审核缩略图走后台私有接口（no-store），不经 next/image 的公开优化链路 */

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ExternalLink } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { ActionDialog } from "./action-dialog";
import { Badge, buttonClass, cn } from "./ui";

export type ReviewItem = {
  kind: string;
  kindLabel: string;
  id: string | null;
  userId: string;
  userName: string;
  petName: string | null;
  createdAt: string;
  status: "pending" | "approved" | "removed";
  reason: string | null;
  userSuspended: boolean;
  userDeleted: boolean;
};

/**
 * 图片审核网格：勾选后批量通过；单张「移除」或「移除并封禁」走 ActionDialog（必填原因、写审计）。
 * 已移除的图片文件已删除，只展示记录。
 */
export function UploadReviewGrid({ items, actorId }: { items: ReviewItem[]; actorId: string }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const selectable = items.filter((item) => item.id && item.status === "pending");
  const keyOf = (item: ReviewItem) => `${item.kind}:${item.id}`;

  function toggle(item: ReviewItem) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(keyOf(item))) next.delete(keyOf(item));
      else next.add(keyOf(item));
      return next;
    });
  }

  async function approve(targets: ReviewItem[]) {
    if (busy || !targets.length) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ approved: number }>("/api/admin/uploads", { method: "POST", body: JSON.stringify({ action: "approve", items: targets.map((item) => ({ kind: item.kind, id: item.id })) }) });
      toast.success(`已通过 ${result.approved} 张`);
      setSelected(new Set());
      startTransition(() => router.refresh());
    } catch (failure) {
      toast.error(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      {selectable.length ? (
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3">
          <label className="inline-flex items-center gap-2 text-sm text-ink-2">
            <input
              type="checkbox"
              className="size-4"
              checked={selected.size > 0 && selected.size === selectable.length}
              onChange={(event) => setSelected(event.target.checked ? new Set(selectable.map(keyOf)) : new Set())}
            />
            全选本页（{selectable.length} 张）
          </label>
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted">已选 {selected.size} 张</span>
            <button type="button" disabled={busy || !selected.size} className={buttonClass("secondary", "sm")} onClick={() => approve(selectable.filter((item) => selected.has(keyOf(item))))}>通过所选</button>
            <button type="button" disabled={busy} className={buttonClass("primary", "sm")} onClick={() => approve(selectable)}><Check className="size-4" />本页全部通过</button>
          </div>
        </div>
      ) : null}
      <ul className="grid grid-cols-2 gap-4 p-5 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-5">
        {items.map((item, index) => {
          const thumb = item.id ? `/api/admin/uploads/${item.kind}/${item.id}/image` : null;
          const checked = selected.has(keyOf(item));
          return (
            <li key={item.id ? keyOf(item) : `removed-${index}`} className={cn("overflow-hidden rounded-xl border bg-surface", checked ? "border-focus ring-2 ring-[color-mix(in_srgb,var(--focus)_30%,transparent)]" : "border-line")}>
              <div className="relative aspect-square bg-surface-2">
                {thumb && item.status !== "removed" ? (
                  <button type="button" className="block size-full" onClick={() => item.status === "pending" && toggle(item)} aria-pressed={checked} aria-label={`${item.kindLabel}，${item.userName}，${checked ? "取消选择" : "选择"}`}>
                    <img src={thumb} alt="" loading="lazy" className="size-full object-cover" />
                  </button>
                ) : (
                  <div className="grid size-full place-items-center text-xs text-muted">已移除，文件已删除</div>
                )}
                <div className="pointer-events-none absolute left-2 top-2 flex gap-1">
                  <Badge tone="neutral" dot={false} className="bg-surface/90">{item.kindLabel}</Badge>
                </div>
                {thumb && item.status !== "removed" ? (
                  <a href={`${thumb}?full=1`} target="_blank" rel="noreferrer" className="absolute right-2 top-2 grid size-7 place-items-center rounded-md bg-surface/90 text-ink-2 hover:text-ink" aria-label="查看原图"><ExternalLink className="size-3.5" /></a>
                ) : null}
              </div>
              <div className="space-y-2 p-3 text-xs">
                <div className="flex items-center justify-between gap-2">
                  <Link href={`/admin/users/${item.userId}`} className="truncate font-medium text-ink hover:underline">{item.userName}</Link>
                  {item.userDeleted ? <Badge tone="neutral">已注销</Badge> : item.userSuspended ? <Badge tone="critical">已封禁</Badge> : null}
                </div>
                <p className="truncate text-muted">{[item.petName, new Date(item.createdAt).toLocaleString("zh-CN", { hour12: false })].filter(Boolean).join(" · ")}</p>
                {item.reason ? <p className="text-critical-ink">原因：{item.reason}</p> : null}
                {item.id && item.status !== "removed" ? (
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {item.status === "pending" ? <button type="button" disabled={busy} className={buttonClass("ghost", "sm")} onClick={() => approve([item])}>通过</button> : <Badge tone="good">已通过</Badge>}
                    <ActionDialog
                      label="移除"
                      title="移除这张图片"
                      description="图片会从用户的照片库或记录中删除，文件进入清理队列，不可恢复。"
                      endpoint="/api/admin/uploads"
                      body={{ action: "remove", kind: item.kind, id: item.id, suspend: false }}
                      reasonDefault="内容违规"
                      confirmLabel="移除"
                      success="已移除"
                      danger
                    />
                    {!item.userSuspended && !item.userDeleted && item.userId !== actorId ? (
                      <ActionDialog
                        label="移除并封禁"
                        title={`移除图片并封禁 ${item.userName}`}
                        description="封禁后该账号无法登录、无法使用任何功能，公开分享全部关闭。可在用户详情页解封。"
                        endpoint="/api/admin/uploads"
                        body={{ action: "remove", kind: item.kind, id: item.id, suspend: true }}
                        reasonDefault="上传违禁图片"
                        confirmLabel="移除并封禁"
                        success="已移除，账号已封禁"
                        danger
                      />
                    ) : null}
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
