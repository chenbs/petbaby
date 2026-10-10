"use client";

import { useEffect, useState, type FormEvent } from "react";
import { apiFetch } from "@/lib/api";

type WalletReport = {
  days: number;
  daily: Array<{ day: string; topup_units: number; spent_units: number; returned_units: number; gifted_units: number; expired_units: number }>;
  liability: { purchasedUnits: number; purchasedAmount: number; giftUnits: number };
  spendByKind: Array<{ ref_type: string; count: number; units: number }>;
  topupRevenue: { amount: number; orders: number };
  user?: {
    wallet: { balance: number };
    account: { frozen_reason: string | null } | null;
    lots: Array<{ id: string; pocket: string; remaining: number; status: string; expires_at: string | null }>;
    ledger: Array<{ id: string; title: string; reason: string; delta: number; created_at: string; biz_key: string }>;
  };
};

export function WalletAdminClient() {
  const [report, setReport] = useState<WalletReport>();
  const [userId, setUserId] = useState("");
  const [days, setDays] = useState("14");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    apiFetch<WalletReport>("/api/admin/wallet").then((result) => { if (active) setReport(result); }).catch((failure) => { if (active) setError(failure instanceof Error ? failure.message : "钱包报表加载失败"); });
    return () => { active = false; };
  }, []);

  async function load(event?: FormEvent) {
    event?.preventDefault();
    setBusy(true); setError("");
    try {
      setReport(await apiFetch<WalletReport>(`/api/admin/wallet?days=${days}${userId ? `&userId=${encodeURIComponent(userId.trim())}` : ""}`));
    } catch (failure) { setError(failure instanceof Error ? failure.message : "钱包查询失败"); }
    finally { setBusy(false); }
  }

  async function grant(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true); setError(""); setMessage("");
    try {
      await apiFetch("/api/admin/wallet", { method: "POST", body: JSON.stringify({ action: "grant_gift", userId: userId.trim(), units: Number(form.get("units")), days: Number(form.get("expiry")), reason: form.get("reason") }) });
      setMessage("赠送补偿已到账，操作已记录审计。");
      await load();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "赠送补偿失败"); }
    finally { setBusy(false); }
  }

  const balance = report?.user?.wallet.balance;
  return <>
    <form className="panel form-grid" onSubmit={load}>
      <div className="field"><label htmlFor="wallet-user">用户 ID（留空看全站）</label><input id="wallet-user" value={userId} onChange={(event) => setUserId(event.target.value)} /></div>
      <div className="field"><label htmlFor="wallet-days">统计天数</label><input id="wallet-days" type="number" min="1" max="90" value={days} onChange={(event) => setDays(event.target.value)} /></div>
      <button className="primary-button" disabled={busy} type="submit">查询钱包</button>
    </form>
    {error ? <p className="error-banner" role="alert">{error}</p> : null}
    {message ? <p role="status">{message}</p> : null}
    {report ? <>
      <section className="panel"><h2>充值与余额</h2><p>近 {report.days} 天充值现金 ¥{report.topupRevenue.amount.toFixed(2)}，共 {report.topupRevenue.orders} 单</p><p>购买所得剩余 {report.liability.purchasedUnits} 颗（对应现金 ¥{report.liability.purchasedAmount.toFixed(2)}）；赠送所得剩余 {report.liability.giftUnits} 颗</p><p>现金收入只统计充值订单；冻干消耗单独记录。</p></section>
      <section className="panel"><h2>每日收支</h2>{report.daily.length ? <div className="settings-list">{report.daily.map((day) => <div key={day.day}><b>{day.day}</b><span>充值 {day.topup_units} · 消耗 {day.spent_units} · 退还 {day.returned_units} · 赠送 {day.gifted_units} · 过期 {day.expired_units} 颗</span></div>)}</div> : <p>暂无流水</p>}</section>
      <section className="panel"><h2>玩法消耗</h2><div className="settings-list">{report.spendByKind.map((kind) => <div key={kind.ref_type}><b>{kind.ref_type}</b><span>{kind.count} 次 · {kind.units} 颗</span></div>)}</div></section>
      {report.user ? <>
        <section className="panel"><h2>用户钱包</h2><p>当前余额 {balance || 0} 颗；{report.user.account?.frozen_reason ? `已冻结：${report.user.account.frozen_reason}` : "正常"}</p><h3>入账批次</h3><div className="settings-list">{report.user.lots.map((lot) => <div key={lot.id}><span>{lot.pocket === "gift" ? "赠送所得" : "购买所得"} · {lot.status}</span><span>{lot.remaining} 颗 · {lot.expires_at ? `到期 ${String(lot.expires_at).slice(0, 10)}` : "长期有效"}</span></div>)}</div><h3>收支流水</h3><div className="settings-list">{report.user.ledger.map((entry) => <div key={entry.id}><span><b>{entry.title}</b><small>{entry.reason} · {String(entry.created_at).slice(0, 16)} · {entry.biz_key}</small></span><span>{entry.delta > 0 ? "+" : ""}{entry.delta} 颗</span></div>)}</div></section>
        <form className="panel form-grid" onSubmit={grant}><h2>赠送补偿</h2><div className="field"><label htmlFor="grant-units">颗数</label><input id="grant-units" name="units" type="number" min="1" max="200" required /></div><div className="field"><label htmlFor="grant-expiry">有效天数</label><input id="grant-expiry" name="expiry" type="number" min="1" max="365" defaultValue="30" required /></div><div className="field"><label htmlFor="grant-reason">补偿原因</label><input id="grant-reason" name="reason" minLength={2} maxLength={60} required /></div><button className="primary-button" disabled={busy} type="submit">发放赠送补偿</button></form>
      </> : null}
    </> : null}
  </>;
}
