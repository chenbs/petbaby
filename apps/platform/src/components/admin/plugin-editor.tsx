"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/admin-format";
import { inputClass } from "./action-dialog";
import { Badge, buttonClass, Card, CardBody, CardHeader, cn } from "./ui";

type Version = { id: string; version: number; template_version: string; created_at: string };

/** 玩法 manifest 编辑：保存即发布新版本（服务端 Zod 校验 + 版本号自增 + 审计），历史版本可一键回滚。 */
export function PluginEditor({ pluginId, manifest, versions }: { pluginId: string; manifest: string; versions: Version[] }) {
  const router = useRouter();
  const [value, setValue] = useState(manifest);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function call(body: Record<string, unknown>, method: "PUT" | "POST", success: string) {
    if (reason.trim().length < 2) { setError("请填写操作原因（至少 2 个字）"); return; }
    setBusy(true);
    setError("");
    try {
      const result = await apiFetch<{ version: number }>(`/api/admin/plugins/${encodeURIComponent(pluginId)}`, { method, body: JSON.stringify({ ...body, reason }) });
      toast.success(`${success}，当前 v${result.version}`);
      setReason("");
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "操作失败");
    } finally {
      setBusy(false);
    }
  }

  function publish() {
    let parsed: unknown;
    try { parsed = JSON.parse(value); } catch { setError("Manifest 不是合法 JSON"); return; }
    void call({ manifest: parsed }, "PUT", "已发布");
  }

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
      <Card>
        <CardHeader title="Manifest" description="发布后新任务立即使用；在途任务按入队时的快照执行，不受影响。" />
        <CardBody>
          <label htmlFor="manifest" className="sr-only">Manifest JSON</label>
          <textarea id="manifest" spellCheck={false} value={value} onChange={(event) => setValue(event.target.value)} className={cn(inputClass, "min-h-[520px] resize-y font-mono text-xs leading-relaxed")} />
        </CardBody>
      </Card>
      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader title="发布" />
          <CardBody className="space-y-3">
            <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">操作原因 *</span><textarea rows={2} className={cn(inputClass, "resize-y")} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="会写入审计" /></label>
            {error ? <p role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--critical)_10%,transparent)] px-3 py-2 text-xs text-critical-ink">{error}</p> : null}
            <div className="flex gap-2">
              <button type="button" disabled={busy || value === manifest} onClick={() => setValue(manifest)} className={buttonClass("ghost")}>还原</button>
              <button type="button" disabled={busy || value === manifest} onClick={publish} className={cn(buttonClass("primary"), "flex-1")}>{busy ? "提交中…" : "发布新版本"}</button>
            </div>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="版本历史" description="回滚 = 把历史版本重新发布为最新版本" />
          <CardBody className="pt-2">
            <ul className="divide-y divide-line">
              {versions.map((version, index) => (
                <li key={version.id} className="flex items-center justify-between gap-2 py-2.5 text-sm">
                  <span><span className="font-medium text-ink">v{version.version}</span><span className="block text-[11px] text-muted">{version.template_version} · {formatDateTime(version.created_at)}</span></span>
                  {index === 0 ? <Badge tone="good">当前</Badge> : <button type="button" disabled={busy} onClick={() => void call({ version: version.version }, "POST", `已回滚到 v${version.version}`)} className={buttonClass("secondary", "sm")}>回滚</button>}
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
