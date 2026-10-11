"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LockKeyhole, PawPrint } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { inputClass } from "./action-dialog";
import { buttonClass, cn } from "./ui";

/** 运营后台登录表单。成功后刷新服务端布局，侧栏外壳随管理员身份出现。 */
export function AdminLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [accountName, setAccountName] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await apiFetch("/api/admin/login", { method: "POST", body: JSON.stringify({ accountName, password }) });
      router.replace(next);
      router.refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "登录失败，请稍后再试");
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <main className="grid min-h-screen place-items-center bg-bg px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-3">
          <span className="grid size-10 place-items-center rounded-xl bg-accent text-white shadow-card"><PawPrint aria-hidden className="size-5" /></span>
          <div className="leading-tight">
            <p className="text-base font-semibold text-ink">麻麻抱我</p>
            <p className="text-xs text-muted">运营控制台</p>
          </div>
        </div>
        <form onSubmit={submit} className="rounded-2xl border border-line bg-surface p-6 shadow-card">
          <h1 className="text-lg font-semibold text-ink">管理员登录</h1>
          <p className="mt-1 text-sm text-ink-2">仅限已开通权限的运营账号。</p>
          <div className="mt-6 space-y-4">
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-2">账号</span>
              <input className={inputClass} autoComplete="username" autoFocus required minLength={3} maxLength={32} value={accountName} onChange={(event) => setAccountName(event.target.value)} />
            </label>
            <label className="block space-y-1.5">
              <span className="text-xs font-medium text-ink-2">密码</span>
              <input className={inputClass} type="password" autoComplete="current-password" required maxLength={72} value={password} onChange={(event) => setPassword(event.target.value)} />
            </label>
            {error ? <p role="alert" className="rounded-lg bg-[color-mix(in_srgb,var(--critical)_10%,transparent)] px-3 py-2 text-sm text-critical-ink">{error}</p> : null}
            <button type="submit" disabled={busy} className={cn(buttonClass("primary"), "w-full")}><LockKeyhole className="size-4" />{busy ? "登录中…" : "登录"}</button>
          </div>
        </form>
        <p className="mt-4 text-center text-xs text-muted">账号由运维创建，忘记密码请联系负责人重设。</p>
      </div>
    </main>
  );
}
