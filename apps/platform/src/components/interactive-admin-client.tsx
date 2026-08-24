"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type Session = { id: string; plugin_id: string; status: string; share_token?: string; share_expires_at?: string; revoked_at?: string; exported_key?: string; export_render_id?: string; work_id?: string; snapshot: Record<string, unknown>; export_status?: string; export_progress?: number; export_error?: string; export_config?: Record<string, unknown>; event_count: number; updated_at: string };

export function InteractiveAdminClient() {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [status, setStatus] = useState("");
  const [reason, setReason] = useState("互动运营处理");
  const [message, setMessage] = useState("");
  async function load() { const query = new URLSearchParams(); if (status) query.set("status", status); try { const data = await apiFetch<{ sessions: Session[] }>(`/api/admin/interactive?${query}`); setSessions(data.sessions); } catch (error) { setMessage(error instanceof Error ? error.message : "互动任务读取失败"); } }
  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  async function mutate(action: string, id: string) { try { await apiFetch("/api/admin/interactive", { method: "PATCH", body: JSON.stringify({ action, id, reason }) }); setMessage("操作已完成"); await load(); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } }
  return <section className="admin-dashboard"><section className="panel"><div className="form-grid"><div className="field"><label htmlFor="interactive-status">状态</label><select id="interactive-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="failed">失败</option><option value="processing">处理中</option><option value="cancelled">已取消</option><option value="ready">已完成</option></select></div><div className="field"><label htmlFor="interactive-reason">操作原因</label><input id="interactive-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div></div></section>{message ? <div className="error-banner">{message}</div> : null}<table className="data-table"><thead><tr><th>会话/玩法</th><th>状态/访问</th><th>输入快照</th><th>导出</th><th>分享/作品</th><th>操作</th></tr></thead><tbody>{sessions.map((item) => <tr key={item.id}><td>{item.id.slice(0, 8)} / {item.plugin_id}<br /><small>{new Date(item.updated_at).toLocaleString("zh-CN")}</small></td><td>{item.status} / {item.event_count} 事件</td><td><details><summary>查看</summary><pre>{JSON.stringify(item.snapshot || {}, null, 2)}</pre></details></td><td>{item.export_status || "未创建"} / {item.export_progress || 0}%<br />{item.export_error || ""}</td><td>{item.share_token ? "分享中" : item.revoked_at ? "已撤销" : "未分享"}<br />{item.work_id ? `作品 ${item.work_id.slice(0, 8)}` : "—"}</td><td>{item.share_token ? <button type="button" onClick={() => void mutate("close_share", item.id)}>关闭分享</button> : null}{["failed", "cancelled"].includes(item.export_status || "") ? <button type="button" onClick={() => void mutate("retry_export", item.id)}>重试导出</button> : null}{["queued", "processing"].includes(item.export_status || "") ? <button type="button" onClick={() => void mutate("cancel_export", item.id)}>取消导出</button> : null}</td></tr>)}</tbody></table></section>;
}
