"use client";

import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type CatalogItem = { id: string; kind: string; code: string; label: string; version: number; status: string; is_default: boolean };
type Space = { id: string; title: string; status: string; lifecycle: string; visibility: string; share_token?: string; product_jobs: Record<string, { status?: string; renderId?: string }>; work_ids: Record<string, string>; video_status?: string; video_progress?: number; video_error?: string; updated_at: string };
type Data = { spaces: Space[]; catalog: CatalogItem[] };

export function MemorialAdminClient() {
  const [data, setData] = useState<Data | null>(null);
  const [message, setMessage] = useState("");
  const [kind, setKind] = useState("template");
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [lifecycle, setLifecycle] = useState("");
  const [visibility, setVisibility] = useState("");
  const [reason, setReason] = useState("纪念产品运营调整");

  async function load() {
    const query = new URLSearchParams();
    if (lifecycle) query.set("lifecycle", lifecycle);
    if (visibility) query.set("visibility", visibility);
    try { setData(await apiFetch<Data>(`/api/admin/memorials?${query}`)); }
    catch (error) { setMessage(error instanceof Error ? error.message : "纪念运营数据读取失败"); }
  }
  useEffect(() => { void load(); }, [lifecycle, visibility]); // eslint-disable-line react-hooks/set-state-in-effect, react-hooks/exhaustive-deps

  async function add() {
    try { await apiFetch("/api/admin/memorials", { method: "POST", body: JSON.stringify({ kind, code, label, config: {}, status: "active", isDefault: false }) }); setCode(""); setLabel(""); setMessage("纪念目录版本已发布"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
  }

  async function mutate(body: Record<string, unknown>) {
    try { await apiFetch("/api/admin/memorials", { method: "PATCH", body: JSON.stringify({ ...body, reason }) }); setMessage("操作已完成"); await load(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); }
  }

  if (!data) return <><div className="empty-state">正在读取纪念运营数据…</div>{message ? <div className="error-banner">{message}</div> : null}</>;
  return <section className="admin-dashboard">
    <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="memorial-kind">资源类型</label><select id="memorial-kind" value={kind} onChange={(event) => setKind(event.target.value)}><option value="template">模板</option><option value="theme">主题</option><option value="bgm">BGM</option><option value="asset">素材</option></select></div><div className="field"><label htmlFor="memorial-code">编码</label><input id="memorial-code" value={code} onChange={(event) => setCode(event.target.value)} /></div><div className="field"><label htmlFor="memorial-label">名称</label><input id="memorial-label" value={label} onChange={(event) => setLabel(event.target.value)} /></div><div className="field"><label htmlFor="memorial-reason">操作原因</label><input id="memorial-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div></div><button className="primary-button" onClick={add} disabled={!code || !label} type="button">发布目录版本</button></section>
    {message ? <div className="error-banner" role="status">{message}</div> : null}
    <section className="panel"><h2>模板、主题与素材版本</h2><table className="data-table"><thead><tr><th>类型/编码</th><th>名称/版本</th><th>状态</th><th>操作</th></tr></thead><tbody>{data.catalog.map((item) => <tr key={item.id}><td>{item.kind} / {item.code}</td><td>{item.label} / v{item.version}</td><td>{item.status}{item.is_default ? " · 默认" : ""}</td><td><button type="button" onClick={() => void mutate({ action: "catalog_status", id: item.id, status: item.status === "active" ? "paused" : "active" })}>{item.status === "active" ? "停用" : "启用"}</button>{item.status === "active" && !item.is_default ? <button type="button" onClick={() => void mutate({ action: "catalog_default", id: item.id })}>设为默认</button> : null}<button type="button" onClick={() => void mutate({ action: "catalog_rollback", id: item.id })}>重新发布此版本</button></td></tr>)}</tbody></table></section>
    <section className="panel"><div className="section-heading"><div><span className="eyebrow">MEMORIAL SPACES</span><h2>空间与生成任务</h2></div><div className="button-row"><select aria-label="生命周期" value={lifecycle} onChange={(event) => setLifecycle(event.target.value)}><option value="">全部生命周期</option><option value="active">active</option><option value="hidden">hidden</option><option value="restored">restored</option></select><select aria-label="分享状态" value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="">全部可见性</option><option value="private">private</option><option value="shared">shared</option></select></div></div><table className="data-table"><thead><tr><th>空间</th><th>生命周期/分享</th><th>产物任务</th><th>作品</th><th>操作</th></tr></thead><tbody>{data.spaces.map((item) => <tr key={item.id}><td>{item.title}<br /><small>{new Date(item.updated_at).toLocaleString("zh-CN")}</small></td><td>{item.lifecycle} / {item.visibility}</td><td><pre>{JSON.stringify(item.product_jobs || {}, null, 2)}</pre>{item.video_status ? <small>视频：{item.video_status} / {item.video_progress || 0}% {item.video_error || ""}</small> : null}</td><td>{Object.entries(item.work_ids || {}).map(([type, id]) => <small key={type} style={{ display: "block" }}>{type}: {id.slice(0, 8)}</small>)}</td><td>{item.visibility === "shared" ? <button type="button" onClick={() => void mutate({ action: "close_share", id: item.id })}>关闭分享</button> : null}{["failed", "cancelled"].includes(item.video_status || "") ? <button type="button" onClick={() => void mutate({ action: "retry_video", id: item.id })}>重试视频</button> : null}</td></tr>)}</tbody></table></section>
  </section>;
}
