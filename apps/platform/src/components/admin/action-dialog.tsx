"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Dialog } from "radix-ui";
import { toast } from "sonner";
import { X } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { buttonClass, cn, type ButtonVariant } from "./ui";

/*
 * 后台的写操作统一走这个对话框：填原因 → 调既有 /api/admin/* 接口 → 刷新服务端数据。
 * 所有改数据的动作都要写原因（接口会落审计），所以没有「一键直改」的按钮。
 *
 * props 必须可序列化（由服务端组件直接传入），字段值在提交时并进 body。
 */

export type ActionField = {
  name: string;
  label: string;
  type?: "text" | "number" | "textarea" | "select" | "json";
  defaultValue?: string;
  placeholder?: string;
  required?: boolean;
  min?: number;
  max?: number;
  minLength?: number;
  maxLength?: number;
  options?: Array<{ value: string; label: string }>;
  hint?: string;
};

export type ActionDialogProps = {
  label: string;
  title: string;
  description?: string;
  endpoint: string;
  method?: "POST" | "PUT" | "PATCH";
  body?: Record<string, unknown>;
  fields?: ActionField[];
  /** 默认附带「操作原因」字段；接口字段名不是 reason 时改这里（例如实体单是 note） */
  reasonField?: string | false;
  reasonDefault?: string;
  confirmLabel?: string;
  success?: string;
  variant?: ButtonVariant;
  size?: "sm" | "md";
  danger?: boolean;
  disabled?: boolean;
};

export function ActionDialog(props: ActionDialogProps) {
  const { label, title, description, endpoint, method = "POST", body = {}, fields = [], reasonField = "reason", reasonDefault = "", confirmLabel = "确认", success = "操作已完成", variant = "secondary", size = "sm", danger = false, disabled = false } = props;
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [, startTransition] = useTransition();
  const allFields: ActionField[] = reasonField
    ? [...fields, { name: reasonField, label: "操作原因", type: "textarea", defaultValue: reasonDefault, required: true, minLength: 2, maxLength: 200, placeholder: "会写入审计日志，例如「用户反馈出图失败，人工补偿」" }]
    : fields;

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const payload: Record<string, unknown> = { ...body };
    try {
      for (const field of allFields) {
        const raw = String(form.get(field.name) ?? "");
        const value = raw.trim();
        if (!value && !field.required) continue;
        if (field.type === "number") payload[field.name] = Number(value);
        else if (field.type === "json") payload[field.name] = value ? JSON.parse(value) : {};
        else payload[field.name] = value;
      }
    } catch {
      setError("JSON 格式不正确");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await apiFetch(endpoint, { method, body: JSON.stringify(payload) });
      toast.success(success);
      setOpen(false);
      startTransition(() => router.refresh());
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog.Root open={open} onOpenChange={(next) => { setOpen(next); if (!next) setError(""); }}>
      <Dialog.Trigger asChild>
        <button type="button" disabled={disabled} className={buttonClass(danger && variant === "secondary" ? "secondary" : variant, size)}>
          <span className={cn(danger && variant === "secondary" && "text-critical-ink")}>{label}</span>
        </button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[2px] data-[state=open]:animate-in" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[min(92vw,460px)] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-line bg-surface p-6 shadow-pop focus:outline-none">
          <div className="flex items-start justify-between gap-4">
            <div>
              <Dialog.Title className="text-base font-semibold text-ink">{title}</Dialog.Title>
              {description ? <Dialog.Description className="mt-1 text-sm text-ink-2">{description}</Dialog.Description> : <Dialog.Description className="sr-only">{title}</Dialog.Description>}
            </div>
            <Dialog.Close className="grid size-7 place-items-center rounded-md text-muted hover:bg-surface-2 hover:text-ink" aria-label="关闭"><X className="size-4" /></Dialog.Close>
          </div>
          <form className="mt-5 space-y-4" onSubmit={submit}>
            {allFields.map((field) => <Field key={field.name} field={field} />)}
            {error ? <p role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--critical)_10%,transparent)] px-3 py-2 text-sm text-critical-ink">{error}</p> : null}
            <div className="flex justify-end gap-2 pt-1">
              <Dialog.Close className={buttonClass("ghost")} type="button">取消</Dialog.Close>
              <button type="submit" disabled={busy} className={buttonClass(danger ? "danger" : "primary")}>{busy ? "提交中…" : confirmLabel}</button>
            </div>
          </form>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export const inputClass = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink placeholder:text-muted focus:border-focus focus:outline-none focus:ring-2 focus:ring-[color-mix(in_srgb,var(--focus)_25%,transparent)]";

function Field({ field }: { field: ActionField }) {
  const id = `action-${field.name}`;
  const common = { id, name: field.name, required: field.required, defaultValue: field.defaultValue, placeholder: field.placeholder };
  return (
    <div className="space-y-1.5">
      <label htmlFor={id} className="block text-xs font-medium text-ink-2">{field.label}{field.required ? <span className="text-critical-ink"> *</span> : null}</label>
      {field.type === "textarea" || field.type === "json" ? (
        <textarea {...common} minLength={field.minLength} maxLength={field.maxLength} rows={field.type === "json" ? 8 : 3} className={cn(inputClass, "resize-y", field.type === "json" && "font-mono text-xs")} />
      ) : field.type === "select" ? (
        <select {...common} className={inputClass}>{field.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}</select>
      ) : (
        <input {...common} type={field.type === "number" ? "number" : "text"} min={field.min} max={field.max} minLength={field.minLength} maxLength={field.maxLength} className={inputClass} />
      )}
      {field.hint ? <p className="text-xs text-muted">{field.hint}</p> : null}
    </div>
  );
}
