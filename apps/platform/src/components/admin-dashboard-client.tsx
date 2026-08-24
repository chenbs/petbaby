"use client";

import { useEffect, useMemo, useState } from "react";

import { apiFetch } from "@/lib/api";

type Dashboard = {
  window: { from: string; to: string };
  summary: Record<string, number>;
  daily: Array<Record<string, string | number>>;
  plugins: Array<Record<string, string | number>>;
  queue: Record<string, number>;
  audit: Array<Record<string, string>>;
};

const labels: Record<string, string> = {
  new_users: "新增用户",
  active_users: "活跃用户",
  generations: "生成请求",
  succeeded_generations: "成功生成",
  paid_orders: "付费订单",
  revenue: "实收流水",
  refunds: "退款金额",
  public_works: "公开作品",
  share_visits: "分享访问",
};

function formatValue(key: string, value: number) {
  if (key === "revenue" || key === "refunds") return `¥${value.toFixed(2)}`;
  return value.toLocaleString("zh-CN");
}

export function AdminDashboardClient() {
  const [data, setData] = useState<Dashboard | null>(null);
  const [days, setDays] = useState("30");
  const [message, setMessage] = useState("");
  const load = () => {
    const end = new Date();
    const start = new Date(end.getTime() - (Number(days) - 1) * 24 * 60 * 60 * 1000);
    const query = new URLSearchParams({ from: start.toISOString().slice(0, 10), to: end.toISOString().slice(0, 10) });
    apiFetch<Dashboard>(`/api/admin/dashboard?${query}`).then(setData).catch((error) => setMessage(error instanceof Error ? error.message : "统计读取失败"));
  };
  useEffect(() => { load(); }, [days]); // eslint-disable-line react-hooks/exhaustive-deps

  const headlineKeys = useMemo(() => ["active_users", "generations", "succeeded_generations", "revenue", "refunds", "paid_orders", "share_visits"], []);
  if (!data) return <section className="panel"><div className="empty-state">正在拼合运营数据…</div>{message ? <div className="error-banner">{message}</div> : null}</section>;
  const maxGenerations = Math.max(...data.daily.map((row) => Number(row.generations || 0)), 1);
  return <section className="admin-dashboard">
    <section className="panel dashboard-toolbar">
      <div><span className="eyebrow">PULSE / {data.window.from.slice(0, 10)} — {data.window.to.slice(0, 10)}</span><h2>今天该处理什么</h2><p>先看异常队列，再用趋势判断玩法和渠道是否需要调整。</p></div>
      <div className="button-row"><select aria-label="统计周期" value={days} onChange={(event) => setDays(event.target.value)}><option value="7">近 7 天</option><option value="30">近 30 天</option><option value="90">近 90 天</option></select><button className="secondary-button" onClick={load} type="button">刷新数据</button></div>
    </section>
    <div className="metrics-grid dashboard-metrics">{headlineKeys.map((key) => <div className="metric-card" key={key}><span>{labels[key]}</span><b>{formatValue(key, Number(data.summary[key] || 0))}</b>{key === "succeeded_generations" ? <small>{Number(data.summary.generations || 0) ? `${(Number(data.summary.succeeded_generations || 0) / Number(data.summary.generations) * 100).toFixed(1)}% 成功率` : "暂无请求"}</small> : null}</div>)}</div>
    <section className="panel dashboard-chart"><div className="section-heading"><div><span className="eyebrow">DAILY SIGNAL</span><h2>生成与收入走势</h2></div><span className="field-hint">每天 00:00 刷新</span></div><div className="mini-bars" aria-label="每日生成量柱状图">{data.daily.map((row) => <div className="mini-bar-wrap" key={String(row.metric_date)} title={`${row.metric_date}：${row.generations} 次生成`}><div className="mini-bar" style={{ height: `${Math.max(5, Number(row.generations || 0) / maxGenerations * 100)}%` }} /><small>{String(row.metric_date).slice(5)}</small></div>)}</div></section>
    <section className="dashboard-two-col"><section className="panel"><div className="section-heading"><div><span className="eyebrow">QUEUE</span><h2>待处理队列</h2></div></div><div className="queue-list">{[["failed_tasks", "失败生成任务", "/admin"], ["failed_videos", "失败视频渲染", "/admin/video"], ["failed_messages", "失败订阅消息", "/admin/business"], ["pending_physical_orders", "待履约实体单", "/admin/business"], ["pending_refunds", "待处理退款", "/admin"], ["active_tasks", "进行中任务", "/admin"]].map(([key, name, href]) => <a href={href} key={key}><span>{name}</span><b className={Number(data.queue[key] || 0) > 0 && key !== "active_tasks" ? "queue-alert" : ""}>{Number(data.queue[key] || 0)}</b></a>)}</div></section><section className="panel"><div className="section-heading"><div><span className="eyebrow">PLAYBOOK</span><h2>玩法表现</h2></div></div><table className="data-table"><thead><tr><th>玩法</th><th>请求</th><th>成功</th><th>失败</th></tr></thead><tbody>{data.plugins.map((row) => <tr key={String(row.plugin_id)}><td>{String(row.plugin_id)}</td><td>{String(row.generations)}</td><td>{String(row.succeeded)}</td><td>{String(row.failed)}</td></tr>)}</tbody></table></section></section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">AUDIT TRAIL</span><h2>最近管理动作</h2></div><a className="secondary-button dashboard-link" href="/admin/audit">查看完整审计</a></div><table className="data-table"><thead><tr><th>时间</th><th>动作</th><th>对象</th><th>操作人</th></tr></thead><tbody>{data.audit.map((row) => <tr key={String(row.id)}><td>{new Date(row.created_at).toLocaleString("zh-CN")}</td><td>{String(row.action)}</td><td>{String(row.target_type)} / {String(row.target_id || "-").slice(0, 12)}</td><td>{String(row.actor_id || "系统").slice(0, 12)}</td></tr>)}</tbody></table></section>
    {message ? <div className="error-banner">{message}</div> : null}
  </section>;
}
