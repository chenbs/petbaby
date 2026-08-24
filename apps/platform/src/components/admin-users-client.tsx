"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type User = { id: string; display_name?: string; created_at: string; deleted_at?: string; admin_suspended_at?: string; admin_suspension_reason?: string; pets: number; works: number; orders: number; revenue: number };
type AuditItem = { id: string; actor_id?: string; action: string; target_id?: string; metadata?: { reason?: string }; created_at: string };
type Data = { users: User[]; audit: AuditItem[] };

function userStatus(user: User) {
  if (user.deleted_at) return "已注销";
  if (user.admin_suspended_at) return "已停用";
  return "正常";
}

export function AdminUsersClient() {
  const [data, setData] = useState<Data | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [reason, setReason] = useState("客服或风控处理");
  const [message, setMessage] = useState("");
  async function load() { try { setData(await apiFetch<Data>(`/api/admin/users?q=${encodeURIComponent(q)}&status=${status}`)); } catch (error) { setMessage(error instanceof Error ? error.message : "用户读取失败"); } }
  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps
  async function toggle(user: User) {
    const action = user.admin_suspended_at ? "reactivate" : "suspend";
    if (!reason.trim()) { setMessage("请填写操作原因"); return; }
    try { await apiFetch("/api/admin/users", { method: "POST", body: JSON.stringify({ action, userId: user.id, reason }) }); setMessage(action === "suspend" ? "用户已停用，公开分享已关闭" : "用户已恢复"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "状态更新失败"); }
  }
  return <section className="admin-dashboard">
    <section className="panel"><div className="admin-user-search"><input aria-label="搜索用户" value={q} onChange={(event) => setQ(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void load(); }} placeholder="搜索用户 ID、昵称或 openid" /><button className="primary-button" onClick={() => void load()} type="button">搜索</button></div><div className="form-grid" style={{ marginTop: 14 }}><div className="field"><label htmlFor="user-status">账号状态</label><select id="user-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部</option><option value="active">正常</option><option value="suspended">已停用</option><option value="deleted">已注销</option></select></div><div className="field"><label htmlFor="user-reason">操作原因</label><input id="user-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div></div></section>
    {message ? <div className="error-banner" role="status">{message}</div> : null}
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">ACCOUNT DIRECTORY</span><h2>用户列表</h2></div><span className="field-hint">最多展示 100 条</span></div>{!data ? <div className="empty-state">正在读取用户…</div> : <table className="data-table"><thead><tr><th>用户</th><th>加入时间</th><th>资产</th><th>订单/流水</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.users.map((user) => <tr key={user.id}><td><b>{user.display_name || "未命名用户"}</b><br /><small>{user.id.slice(0, 12)}</small></td><td>{new Date(user.created_at).toLocaleDateString("zh-CN")}</td><td>{user.pets} 宠物 · {user.works} 作品</td><td>{user.orders} 单 · ¥{Number(user.revenue || 0).toFixed(2)}</td><td><span className={user.deleted_at || user.admin_suspended_at ? "status-pill danger" : "status-pill"}>{userStatus(user)}</span>{user.admin_suspension_reason ? <small style={{ display: "block" }}>{user.admin_suspension_reason}</small> : null}</td><td><div className="user-actions">{!user.deleted_at ? <button onClick={() => void toggle(user)} type="button">{user.admin_suspended_at ? "恢复" : "停用"}</button> : <span>注销不可恢复</span>}<a href={`/api/admin/users?q=${user.id}&status=all`} download={`user-${user.id}.json`}>查询</a></div></td></tr>)}</tbody></table>}</section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>账号操作历史</h2></div></div><table className="data-table"><thead><tr><th>时间</th><th>动作</th><th>用户</th><th>操作人</th><th>原因</th></tr></thead><tbody>{data?.audit.map((item) => <tr key={item.id}><td>{new Date(item.created_at).toLocaleString("zh-CN")}</td><td>{item.action}</td><td>{String(item.target_id || "").slice(0, 12)}</td><td>{String(item.actor_id || "系统").slice(0, 12)}</td><td>{item.metadata?.reason || "—"}</td></tr>)}</tbody></table></section>
  </section>;
}
