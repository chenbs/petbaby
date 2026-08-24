"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type CatalogItem = { id: string; kind: string; code: string; label: string; version: number; status: string; is_default: boolean; config: Record<string, unknown> };
type Render = { id: string; project_title?: string; status: string; progress: number; error_code?: string; config: Record<string, unknown>; draft_snapshot?: Record<string, unknown>; output_key?: string; preview_key?: string; project_work_id?: string; template_code?: string; template_version?: string; order_status?: string; order_amount?: number };
type Data = { catalog: CatalogItem[]; renders: Render[] };

export function VideoAdminClient() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState("");
  const [kind, setKind] = useState("template");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [config, setConfig] = useState("{}");
  const [reason, setReason] = useState("视频运营调整");

  async function load() {
    const query = new URLSearchParams();
    if (status) query.set("status", status);
    try { setData(await apiFetch<Data>(`/api/admin/video?${query}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "视频运营数据读取失败"); }
  }

  useEffect(() => { void load(); }, [status]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps

  async function add() {
    try {
      await apiFetch("/api/admin/video", { method: "POST", body: JSON.stringify({ kind, code, label, config: JSON.parse(config), status: "active", isDefault: false }) });
      setCode(""); setLabel(""); setConfig("{}"); setMessage("视频目录版本已发布"); await load();
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
  }

  async function mutate(body: Record<string, unknown>) {
    try { await apiFetch("/api/admin/video", { method: "PATCH", body: JSON.stringify({ ...body, reason }) }); setMessage("操作已完成"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
  }

  if (!data) return <><div className="empty-state">正在读取视频运营数据…</div>{message ? <div className="error-banner">{message}</div> : null}</>;
  return <section className="admin-dashboard">
    <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="video-kind">资源类型</label><select id="video-kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="template">模板</option><option value="font">字体</option><option value="bgm">BGM</option><option value="transition">转场</option><option value="asset">素材</option></select></div><div className="field"><label htmlFor="video-code">编码</label><input id="video-code" value={code} onChange={(event) => setCode(event.target.value)} /></div><div className="field"><label htmlFor="video-label">名称</label><input id="video-label" value={label} onChange={(event) => setLabel(event.target.value)} /></div><div className="field"><label htmlFor="video-config">配置 JSON</label><textarea id="video-config" value={config} onChange={(event) => setConfig(event.target.value)} /></div><div className="field"><label htmlFor="video-reason">操作原因</label><input id="video-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div></div><button className="primary-button" disabled={!code || !label} onClick={add} type="button">发布新版本</button></section>
    {message ? <div className="error-banner" role="status">{message}</div> : null}
    <section className="panel"><h2>目录版本</h2><table className="data-table"><thead><tr><th>类型/编码</th><th>名称/版本</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.catalog.map((item) => <tr key={item.id}><td>{item.kind} / {item.code}</td><td>{item.label} / v{item.version}</td><td>{item.status}{item.is_default ? " · 默认" : ""}</td><td><button type="button" onClick={() => void mutate({ action: "set_status", id: item.id, status: item.status === "active" ? "paused" : "active" })}>{item.status === "active" ? "停用" : "启用"}</button>{item.status === "active" && !item.is_default ? <button type="button" onClick={() => void mutate({ action: "set_default", id: item.id })}>设为默认</button> : null}<button type="button" onClick={() => void mutate({ action: "rollback", id: item.id })}>重新发布此版本</button></td></tr>)}</tbody></table></section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">RENDERS</span><h2>视频任务</h2></div><select aria-label="任务状态" value={status} onChange={(event) => setStatus(event.target.value)}><option value="">全部</option><option value="queued">排队</option><option value="processing">处理中</option><option value="failed">失败</option><option value="cancelled">已取消</option><option value="succeeded">成功</option></select></div><table className="data-table"><thead><tr><th>项目/模板</th><th>状态/进度</th><th>输入快照</th><th>产物/权益</th><th>操作</th></tr></thead><tbody>{data.renders.map((item) => <tr key={item.id}><td>{item.project_title || item.id.slice(0, 8)}<br />{item.template_code || "—"} v{item.template_version || "—"}</td><td>{item.status} / {item.progress}%<br />{item.error_code || ""}</td><td><details><summary>查看</summary><pre>{JSON.stringify(item.draft_snapshot || item.config || {}, null, 2)}</pre></details></td><td>{item.output_key || item.preview_key ? "已有产物" : "—"}<br />{item.project_work_id ? `作品 ${item.project_work_id.slice(0, 8)}` : "未归档"}<br />{item.order_status ? `订单 ${item.order_status} / ¥${Number(item.order_amount || 0).toFixed(2)}` : "无订单权益"}</td><td>{["failed", "cancelled"].includes(item.status) ? <button type="button" onClick={() => void mutate({ resource: "render", action: "retry", id: item.id })}>重试</button> : null}{["queued", "processing", "preview_ready"].includes(item.status) ? <button type="button" onClick={() => void mutate({ resource: "render", action: "cancel", id: item.id })}>取消</button> : null}</td></tr>)}</tbody></table></section>
  </section>;
}
