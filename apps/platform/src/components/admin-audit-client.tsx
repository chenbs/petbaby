"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type AuditItem = { id: string; actor_id?: string; action: string; target_type: string; target_id?: string; metadata: { reason?: string; before?: unknown; after?: unknown }; created_at: string };

export function AdminAuditClient() {
  const [items, setItems] = useState<AuditItem[]>([]);
  const [action, setAction] = useState("");
  const [targetType, setTargetType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  async function load() { const query = new URLSearchParams(); if (action) query.set("action", action); if (targetType) query.set("targetType", targetType); if (from) query.set("from", from); if (to) query.set("to", to); try { setItems((await apiFetch<{ items: AuditItem[] }>(`/api/admin/audit?${query}`)).items); } catch (error) { setMessage(error instanceof Error ? error.message : "审计读取失败"); } }
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  return <section className="admin-dashboard"><section className="panel"><div className="form-grid"><div className="field"><label htmlFor="audit-action">动作</label><input id="audit-action" value={action} onChange={(event) => setAction(event.target.value)} /></div><div className="field"><label htmlFor="audit-target">对象类型</label><input id="audit-target" value={targetType} onChange={(event) => setTargetType(event.target.value)} /></div><div className="field"><label htmlFor="audit-from">开始日期</label><input id="audit-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="field"><label htmlFor="audit-to">结束日期</label><input id="audit-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div></div><button className="primary-button" type="button" onClick={() => void load()}>检索审计</button></section>{message ? <div className="error-banner">{message}</div> : null}<table className="data-table"><thead><tr><th>时间</th><th>动作</th><th>对象</th><th>操作人</th><th>原因</th><th>前后状态</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("zh-CN")}</td><td>{item.action}</td><td>{item.target_type} / {String(item.target_id || "—").slice(0, 12)}</td><td>{String(item.actor_id || "系统").slice(0, 12)}</td><td>{item.metadata?.reason || "—"}</td><td><details><summary>查看</summary><pre>{JSON.stringify({ before: item.metadata?.before, after: item.metadata?.after }, null, 2)}</pre></details></td></tr>)}</tbody></table></section>;
}
