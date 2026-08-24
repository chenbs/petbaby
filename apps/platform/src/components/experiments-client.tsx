"use client";

import { useCallback, useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type Metrics = {
  completion_rate: number;
  paid_rate: number;
  gross_profit: number;
};

type Experiment = Metrics & {
  id: string;
  plugin_id: string;
  variant_code: string;
  status: string;
  channel: string;
  config: Record<string, unknown>;
  exposure: number;
  starts: number;
  completion: number;
  paid: number;
  refunds: number;
  cost: number;
  revenue: number;
  superseded_live_id?: string;
  live_baseline_id?: string;
  baseline?: Metrics;
  delta?: Metrics;
};

type ExperimentDetail = {
  variant: Experiment;
  metrics: Array<{ id: string; metric: string; value: number; revenue: number; source: string; channel: string; period_start: string }>;
  operations: Array<{ id: string; from_status?: string; to_status: string; reason: string; created_at: string }>;
};

const nextStates: Record<string, string[]> = {
  idea: ["testing", "archived"],
  testing: ["live", "archived"],
  live: ["archived"],
  archived: ["testing"],
};

function percent(value: number) {
  return `${(Number(value || 0) * 100).toFixed(1)}%`;
}

export function ExperimentsClient() {
  const [items, setItems] = useState<Experiment[]>([]);
  const [pluginId, setPluginId] = useState("");
  const [variantCode, setVariantCode] = useState("v1");
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [reason, setReason] = useState("运营评审通过");
  const [detail, setDetail] = useState<ExperimentDetail | null>(null);
  const [metric, setMetric] = useState("exposure");
  const [metricValue, setMetricValue] = useState("0");
  const [metricRevenue, setMetricRevenue] = useState("0");
  const [message, setMessage] = useState("");

  const reload = useCallback(async () => {
    const query = new URLSearchParams();
    if (pluginId.trim()) query.set("pluginId", pluginId.trim());
    if (status) query.set("status", status);
    if (channel) query.set("channel", channel);
    if (from) query.set("from", from);
    if (to) query.set("to", to);
    try {
      setItems(await apiFetch<Experiment[]>(`/api/admin/experiments?${query}`));
      setMessage("");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "实验列表读取失败");
    }
  }, [channel, from, pluginId, status, to]);

  useEffect(() => { void reload(); }, [reload]); // eslint-disable-line react-hooks/set-state-in-effect

  async function create() {
    try {
      await apiFetch("/api/admin/experiments", { method: "POST", body: JSON.stringify({ pluginId, variantCode, status: "idea", channel: channel || "all", config: {}, reason: "创建赛马变体" }) });
      setVariantCode("v1");
      setMessage("变体已创建，当前 live 玩法保持不变");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "创建失败");
    }
  }

  async function move(item: Experiment, next: string) {
    try {
      await apiFetch(`/api/admin/experiments/${item.id}`, { method: "PATCH", body: JSON.stringify({ status: next, config: item.config || {}, reason }) });
      setMessage(`已流转到 ${next}`);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "流转失败");
    }
  }

  async function rollback(item: Experiment) {
    try {
      await apiFetch(`/api/admin/experiments/${item.id}`, { method: "POST", body: JSON.stringify({ action: "rollback", reason }) });
      setMessage("已恢复上一 live 变体");
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "回滚失败");
    }
  }

  async function open(id: string) {
    try {
      setDetail(await apiFetch<ExperimentDetail>(`/api/admin/experiments/${id}`));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "详情读取失败");
    }
  }

  async function addMetric() {
    if (!detail) return;
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    try {
      await apiFetch("/api/admin/experiments/metrics", {
        method: "POST",
        body: JSON.stringify({ variantId: detail.variant.id, metric, value: Number(metricValue), revenue: Number(metricRevenue), source: "manual", channel: channel || "all", periodStart: start.toISOString(), periodEnd: now.toISOString() }),
      });
      setMessage("人工指标已记录");
      await open(detail.variant.id);
      await reload();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "指标记录失败");
    }
  }

  return <>
    <section className="panel">
      <div className="form-grid">
        <div className="field"><label htmlFor="experiment-plugin">玩法 ID</label><input id="experiment-plugin" value={pluginId} onChange={(event) => setPluginId(event.target.value)} placeholder="例如 pl-19" /></div>
        <div className="field"><label htmlFor="experiment-code">新变体编码</label><input id="experiment-code" value={variantCode} onChange={(event) => setVariantCode(event.target.value)} /></div>
        <div className="field"><label htmlFor="experiment-status">状态</label><select id="experiment-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="idea">idea</option><option value="testing">testing</option><option value="live">live</option><option value="archived">archived</option></select></div>
        <div className="field"><label htmlFor="experiment-channel">渠道</label><select id="experiment-channel" value={channel} onChange={(event) => setChannel(event.target.value)}><option value="">全部</option><option value="web">Web</option><option value="miniprogram">小程序</option><option value="all">全渠道</option></select></div>
        <div className="field"><label htmlFor="experiment-from">开始日期</label><input id="experiment-from" type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></div>
        <div className="field"><label htmlFor="experiment-to">结束日期</label><input id="experiment-to" type="date" value={to} onChange={(event) => setTo(event.target.value)} /></div>
        <div className="field"><label htmlFor="experiment-reason">操作原因</label><input id="experiment-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
      </div>
      <div className="button-row"><button className="secondary-button" onClick={() => void reload()} type="button">应用筛选</button><button className="primary-button" disabled={!pluginId.trim() || !variantCode.trim()} onClick={create} type="button">加入赛马</button></div>
    </section>
    {message ? <div className="error-banner" role="status">{message}</div> : null}
    <table className="data-table"><thead><tr><th>玩法/变体</th><th>状态</th><th>曝光/开始/完成/支付</th><th>完成率/支付率</th><th>收入/成本/毛利</th><th>相对 live</th><th>流转</th></tr></thead><tbody>{items.map((item) => <tr key={item.id}>
      <td><button type="button" onClick={() => void open(item.id)}>{item.plugin_id} / {item.variant_code || "default"}</button></td>
      <td>{item.status}{item.live_baseline_id === item.id ? " · live 基准" : ""}</td>
      <td>{item.exposure} / {item.starts} / {item.completion} / {item.paid}<br /><small>退款 {item.refunds}</small></td>
      <td>{percent(item.completion_rate)} / {percent(item.paid_rate)}</td>
      <td>¥{Number(item.revenue).toFixed(2)} / ¥{Number(item.cost).toFixed(2)} / ¥{Number(item.gross_profit).toFixed(2)}</td>
      <td>{item.delta && item.live_baseline_id !== item.id ? `${percent(item.delta.completion_rate)} / ${percent(item.delta.paid_rate)} / ¥${Number(item.delta.gross_profit).toFixed(2)}` : "—"}</td>
      <td><div className="button-row">{nextStates[item.status]?.map((next) => <button key={next} type="button" onClick={() => void move(item, next)}>{next}</button>)}{item.status === "live" && item.superseded_live_id ? <button type="button" onClick={() => void rollback(item)}>回滚上一 live</button> : null}</div></td>
    </tr>)}</tbody></table>
    {detail ? <section className="panel" style={{ marginTop: 20 }}>
      <div className="section-heading"><div><span className="eyebrow">EXPERIMENT DETAIL</span><h2>{detail.variant.plugin_id} / {detail.variant.variant_code}</h2></div><button className="secondary-button" type="button" onClick={() => setDetail(null)}>关闭</button></div>
      <h3>人工指标补录</h3><div className="form-grid"><div className="field"><label htmlFor="metric-kind">指标</label><select id="metric-kind" value={metric} onChange={(event) => setMetric(event.target.value)}><option value="exposure">曝光</option><option value="start">开始</option><option value="completion">完成</option><option value="paid">支付</option><option value="refund">退款</option><option value="cost">成本</option></select></div><div className="field"><label htmlFor="metric-value">数值</label><input id="metric-value" type="number" min="0" step="0.01" value={metricValue} onChange={(event) => setMetricValue(event.target.value)} /></div><div className="field"><label htmlFor="metric-revenue">收入</label><input id="metric-revenue" type="number" min="0" step="0.01" value={metricRevenue} onChange={(event) => setMetricRevenue(event.target.value)} /></div></div><button className="primary-button" type="button" onClick={addMetric}>记录人工指标</button>
      <h3>指标明细</h3><table className="data-table"><thead><tr><th>周期</th><th>指标</th><th>数值</th><th>收入</th><th>来源/渠道</th></tr></thead><tbody>{detail.metrics.map((item) => <tr key={item.id}><td>{new Date(item.period_start).toLocaleDateString("zh-CN")}</td><td>{item.metric}</td><td>{item.value}</td><td>¥{Number(item.revenue || 0).toFixed(2)}</td><td>{item.source} / {item.channel}</td></tr>)}</tbody></table>
      <h3>操作历史</h3><div className="settings-list">{detail.operations.map((operation) => <div key={operation.id}><span>{operation.from_status || "new"} → {operation.to_status}<small style={{ display: "block" }}>{new Date(operation.created_at).toLocaleString("zh-CN")}</small></span><span>{operation.reason}</span></div>)}</div>
    </section> : null}
  </>;
}
