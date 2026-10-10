"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type Subscription = { id: string; event_type: string; status: string; attempts: number; scheduled_at?: string; last_error?: string; deliveryAttempts: Array<{ id: string; attempt: number; status: string; error?: string }> };
type PhysicalOrder = { id: string; sku: string; amount: number; status: string; tracking_no?: string; carrier?: string; production_note?: string; address?: { name?: string; phone?: string; region?: string; city?: string; detail?: string; invalid?: boolean }; qc_report?: { passed?: boolean; width?: number; height?: number; dpi?: number }; print_pdf_key?: string; events: Array<{ id: string; from_status?: string; to_status: string; note?: string; created_at: string }> };
type Report = { id: string; year: number; status: string; locked: boolean; template_version: string; visits: { visits: number; duration_ms: number } };
type Data = { subscriptions: Subscription[]; physical: PhysicalOrder[]; reports: Report[]; reportTemplates: Array<{ id: string; code: string; label: string; version: number; status: string; is_default: boolean; config: Record<string, unknown> }>; orders: Array<{ id: string; kind: string; sku: string; amount: number; status: string; user_id: string }> };

export function BusinessAdminClient() {
  const [data, setData] = useState<Data | null>(null);
  const [status, setStatus] = useState("");
  const [templateCode, setTemplateCode] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [message, setMessage] = useState("");
  const [carrier, setCarrier] = useState<Record<string, string>>({});
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});
  const [template, setTemplate] = useState({ code: "wrapped", label: "年度回忆录", config: "{}" });

  async function load() {
    try {
      const query = new URLSearchParams();
      if (status) query.set("status", status);
      if (templateCode) query.set("templateCode", templateCode);
      if (from) query.set("from", from);
      if (to) query.set("to", to);
      setData(await apiFetch<Data>(`/api/admin/business?${query}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "阶段三数据读取失败");
    }
  }

  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps

  async function action(body: Record<string, unknown>) {
    try {
      await apiFetch("/api/admin/business", { method: "POST", body: JSON.stringify(body) });
      setMessage("操作已完成");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "操作失败");
    }
  }

  async function move(item: PhysicalOrder, next: string) {
    const reason = note[item.id]?.trim() || "后台履约操作";
    const body: Record<string, unknown> = { status: next, note: reason };
    if (next === "shipped") { body.carrier = carrier[item.id]; body.trackingNo = tracking[item.id]; }
    try {
      await apiFetch(`/api/admin/physical-orders/${item.id}/status`, { method: "POST", body: JSON.stringify(body) });
      setMessage("履约状态已更新");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "履约状态更新失败");
    }
  }

  if (!data) return <><div className="empty-state">正在读取阶段三运营数据…</div>{message ? <div className="error-banner">{message}</div> : null}</>;
  return <section className="admin-dashboard">
    <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="business-status">状态筛选</label><select id="business-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="failed">失败</option><option value="pending">待处理</option><option value="paid">已支付</option><option value="active">生效中</option><option value="past_due">续费异常</option><option value="ready">已完成</option></select></div><div className="field"><label htmlFor="business-template">消息模板</label><input id="business-template" value={templateCode} onChange={(event) => setTemplateCode(event.target.value)} /></div><div className="field"><label htmlFor="business-from">开始日期</label><input id="business-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div><div className="field"><label htmlFor="business-to">结束日期</label><input id="business-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div></div><button className="secondary-button" type="button" onClick={() => void load()}>应用筛选</button></section>
    {message ? <div className="error-banner" role="status">{message}</div> : null}
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">SUBSCRIPTIONS</span><h2>订阅消息</h2></div></div><table className="data-table"><thead><tr><th>事件</th><th>状态</th><th>尝试/下次发送</th><th>响应</th><th>操作</th></tr></thead><tbody>{data.subscriptions.map((item) => <tr key={item.id}><td>{item.event_type}</td><td>{item.status}</td><td>{item.attempts} / {item.scheduled_at ? new Date(item.scheduled_at).toLocaleString("zh-CN") : "—"}</td><td>{item.last_error || item.deliveryAttempts[0]?.status || "—"}</td><td>{item.status === "failed" ? <button type="button" onClick={() => void action({ action: "retry_subscription", id: item.id, reason: "后台人工重试" })}>重试</button> : null}{!["sent", "unsubscribed", "closed"].includes(item.status) ? <button type="button" onClick={() => void action({ action: "close_subscription", id: item.id, reason: "后台关闭异常任务" })}>关闭</button> : null}</td></tr>)}</tbody></table></section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">FULFILLMENT</span><h2>实体订单</h2></div></div><table className="data-table"><thead><tr><th>SKU/金额</th><th>收货地址（脱敏）</th><th>状态</th><th>生产与物流</th><th>历史/文件</th></tr></thead><tbody>{data.physical.map((item) => <tr key={item.id}><td>{item.sku}<br />¥{Number(item.amount).toFixed(2)}<br /><small>QC {item.qc_report?.passed ? "通过" : "待检查"}</small></td><td>{item.address?.name} {item.address?.phone}<br />{item.address?.region} {item.address?.city} {item.address?.detail}</td><td>{item.status}</td><td><input aria-label={`${item.id} 操作备注`} placeholder="操作备注（必填）" value={note[item.id] || ""} onChange={(event) => setNote({ ...note, [item.id]: event.target.value })} />{item.status === "paid" ? <button type="button" onClick={() => void move(item, "producing")}>开始制作</button> : null}{item.status === "producing" ? <><input aria-label={`${item.id} 承运商`} placeholder="承运商" value={carrier[item.id] || ""} onChange={(event) => setCarrier({ ...carrier, [item.id]: event.target.value })} /><input aria-label={`${item.id} 运单号`} placeholder="运单号" value={tracking[item.id] || ""} onChange={(event) => setTracking({ ...tracking, [item.id]: event.target.value })} /><button type="button" onClick={() => void move(item, "shipped")}>确认发货</button></> : null}{item.status === "shipped" ? <button type="button" onClick={() => void move(item, "completed")}>完成</button> : null}{["pending", "paid", "producing"].includes(item.status) ? <button type="button" onClick={() => void move(item, "cancelled")}>取消</button> : null}{["paid", "producing", "shipped", "completed"].includes(item.status) ? <button type="button" onClick={() => void move(item, "after_sale")}>进入售后</button> : null}{item.status === "after_sale" ? <button type="button" onClick={() => void move(item, "refunded")}>退款完成</button> : null}</td><td>{item.print_pdf_key ? <a href={`/api/admin/physical-orders/${item.id}/print`} target="_blank" rel="noreferrer">印刷 PDF</a> : "—"}<small style={{ display: "block" }}>{item.events.slice(0, 3).map((event) => `${event.from_status || "new"}→${event.to_status}`).join(" · ")}</small></td></tr>)}</tbody></table></section>
    <section className="panel">
      <div className="section-heading"><div><span className="eyebrow">ANNUAL REPORTS</span><h2>年度报告</h2></div></div>
      <table className="data-table"><thead><tr><th>年份/状态</th><th>模板/解锁</th><th>分享访问</th><th>操作</th></tr></thead><tbody>{data.reports.map((item) => <tr key={item.id}><td>{item.year}<br />{item.status}</td><td>{item.template_version} / {item.locked ? "未解锁" : "已解锁"}</td><td>{item.visits.visits} 次 / {item.visits.duration_ms}ms</td><td>{item.status === "failed" ? <button type="button" onClick={() => void action({ action: "retry_report", id: item.id, reason: "后台重试年度报告" })}>重试</button> : null}</td></tr>)}</tbody></table>
      <h3>报告模板版本</h3><div className="form-grid"><input placeholder="code" value={template.code} onChange={(event) => setTemplate({ ...template, code: event.target.value })} /><input placeholder="名称" value={template.label} onChange={(event) => setTemplate({ ...template, label: event.target.value })} /><input placeholder="JSON 配置" value={template.config} onChange={(event) => setTemplate({ ...template, config: event.target.value })} /><button type="button" onClick={() => { try { void action({ action: "create_report_template", code: template.code, label: template.label, config: JSON.parse(template.config), status: "active", isDefault: true, reason: "发布报告模板版本" }); } catch { setMessage("模板 JSON 无效"); } }}>发布报告模板</button></div>
      <table className="data-table"><thead><tr><th>编码/版本</th><th>名称</th><th>状态</th><th>配置</th><th>操作</th></tr></thead><tbody>{data.reportTemplates.map((item) => <tr key={item.id}><td>{item.code} / v{item.version}</td><td>{item.label}</td><td>{item.status}{item.is_default ? " · 默认" : ""}</td><td><details><summary>查看</summary><pre>{JSON.stringify(item.config || {}, null, 2)}</pre></details></td><td><button type="button" onClick={() => void action({ action: "create_report_template", code: item.code, label: item.label, config: item.config || {}, status: "active", isDefault: true, reason: `重新发布报告模板 v${item.version}` })}>重新发布并设为默认</button></td></tr>)}</tbody></table>
    </section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">GROWTH ORDERS</span><h2>权益订单</h2></div></div><table className="data-table"><thead><tr><th>类型/SKU</th><th>金额</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.orders.map((item) => <tr key={item.id}><td>{item.kind} / {item.sku}</td><td>¥{Number(item.amount).toFixed(2)}</td><td>{item.status}</td><td>{item.status === "paid" ? <button type="button" onClick={() => void action({ action: "refund_growth_order", id: item.id, reason: "后台权益退款" })}>退款</button> : "—"}</td></tr>)}</tbody></table></section>
  </section>;
}
