"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type Status = {
  quota: { daily: number; used: number; remaining: number };
  refunds: Array<{ id: string; amount: number; reason: string; status: string }>;
  notifications: Array<{ id: string; title: string; body: string; target_path?: string; read_at?: string }>;
};

export function UserStatusClient() {
  const [status, setStatus] = useState<Status>();
  useEffect(() => { apiFetch<Status>("/api/account/status").then(setStatus); }, []);
  if (!status) return <div className="empty-state"><b>正在读取账户状态…</b></div>;
  return <>
    <section className="metrics-grid" style={{ marginBottom: 20 }}><div className="metric-card"><span>今日免费额度</span><b>{status.quota.remaining}/{status.quota.daily}</b></div><div className="metric-card"><span>退款处理中</span><b>{status.refunds.filter((item) => item.status === "pending").length}</b></div></section>
    {status.notifications.length ? <section className="panel" style={{ marginBottom: 20 }}><span className="eyebrow">站内通知</span><div className="settings-list">{status.notifications.map((item) => <div key={item.id}><span><b>{item.title}</b><small style={{ display: "block" }}>{item.body}</small></span>{item.target_path ? <Link href={item.target_path}>查看</Link> : null}</div>)}</div></section> : null}
  </>;
}
