"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import type { InteractiveSession, Pet, Photo } from "@/domain/models";
import { apiFetch } from "@/lib/api";
import { InteractiveCanvas } from "@/components/interactive-canvas";

export function InteractiveStudioClient({ sessionId }: { sessionId?: string }) {
  const [pets, setPets] = useState<Pet[]>([]); const [petId, setPetId] = useState(""); const [photos, setPhotos] = useState<Photo[]>([]); const [photoIds, setPhotoIds] = useState<string[]>([]); const [session, setSession] = useState<InteractiveSession>();
  const [title, setTitle] = useState("每一次想念，都在这里发光"); const [copy, setCopy] = useState("把它最熟悉的样子，轻轻放进星光里。"); const [theme, setTheme] = useState("stardust"); const [stardust, setStardust] = useState(0); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false);
  const snapshot = useMemo(() => ({ title, copy, theme, stardust }), [copy, stardust, theme, title]);
  async function loadSession() { if (!sessionId) return; const next = await apiFetch<InteractiveSession>(`/api/interactive-sessions/${sessionId}`); setSession(next); const current = next.snapshot; setPetId(next.petId); setPhotoIds(next.photoIds); setTitle(String(current.title || title)); setCopy(String(current.copy || copy)); setTheme(String(current.theme || theme)); setStardust(Number(current.stardust || 0)); return next; }
  useEffect(() => { Promise.all([apiFetch<Pet[]>("/api/pets"), sessionId ? apiFetch<InteractiveSession>(`/api/interactive-sessions/${sessionId}`) : Promise.resolve(undefined)]).then(([nextPets, nextSession]) => { setPets(nextPets); if (nextSession) { setSession(nextSession); setPetId(nextSession.petId); setPhotoIds(nextSession.photoIds); setTitle(String(nextSession.snapshot.title || title)); setCopy(String(nextSession.snapshot.copy || copy)); setTheme(String(nextSession.snapshot.theme || theme)); setStardust(Number(nextSession.snapshot.stardust || 0)); } else setPetId(nextPets.find((pet) => pet.isDefault)?.id || nextPets[0]?.id || ""); }).catch((error) => setMessage(error instanceof Error ? error.message : "互动页加载失败")); }, [sessionId]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (!petId) return; apiFetch<Photo[]>(`/api/photos?petId=${encodeURIComponent(petId)}`).then(setPhotos).catch((error) => setMessage(error instanceof Error ? error.message : "照片加载失败")); }, [petId]);
  useEffect(() => { if (!session || session.exportStatus !== "queued" && session.exportStatus !== "processing") return; const timer = setTimeout(() => loadSession().catch(() => undefined), 1600); return () => clearTimeout(timer); }, [session]); // eslint-disable-line react-hooks/exhaustive-deps
  function togglePhoto(id: string) { setPhotoIds((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length < 6 ? [...current, id] : current); }
  async function save() {
    if (!petId || !photoIds.length) { setMessage("请选择宠物和 1-6 张照片"); return; } setBusy(true);
    try {
      if (!sessionId) { const created = await apiFetch<InteractiveSession>("/api/interactive-sessions", { method: "POST", body: JSON.stringify({ pluginId: "pl-15", petId, photoIds, snapshot }) }); window.location.href = `/interactive/${created.id}`; return; }
      const updated = await apiFetch<InteractiveSession>(`/api/interactive-sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ snapshot, photoIds }) }); setSession(updated); setMessage("互动场景已保存。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); } finally { setBusy(false); }
  }
  async function action(path: string, body: Record<string, unknown>, success: string) { if (!sessionId) return; setBusy(true); try { const updated = await apiFetch<InteractiveSession>(path, { method: "POST", body: JSON.stringify(body) }); setSession(updated); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); } }
  const firstPhoto = photos.find((photo) => photo.id === photoIds[0]);
  return <>
    <section className="panel"><div className="form-grid">
      <div className="field"><label htmlFor="interactive-pet">宠物</label><select disabled={Boolean(sessionId)} id="interactive-pet" value={petId} onChange={(event) => { setPetId(event.target.value); setPhotoIds([]); }}><option value="">选择宠物</option>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></div>
      <div className="field"><span>场景照片（1-6 张）</span><div className="asset-choice-grid">{photos.map((photo) => <button aria-pressed={photoIds.includes(photo.id)} className={photoIds.includes(photo.id) ? "asset-choice selected" : "asset-choice"} key={photo.id} onClick={() => togglePhoto(photo.id)} type="button"><Image alt={photo.filename} fill sizes="120px" src={photo.url} unoptimized /><span>{photoIds.includes(photo.id) ? "已选" : "选择"}</span></button>)}</div></div>
      <div className="field"><label htmlFor="interactive-title">标题</label><input id="interactive-title" maxLength={60} onChange={(event) => setTitle(event.target.value)} value={title} /></div>
      <div className="field"><label htmlFor="interactive-copy">页面文案</label><textarea id="interactive-copy" maxLength={180} onChange={(event) => setCopy(event.target.value)} rows={4} value={copy} /></div>
      <div className="field"><label htmlFor="interactive-theme">主题</label><select id="interactive-theme" onChange={(event) => setTheme(event.target.value)} value={theme}><option value="stardust">深夜星尘</option><option value="meadow">清晨草地</option><option value="sunset">暖色日落</option></select></div>
      <button className="primary-button" disabled={busy} onClick={save} type="button">{sessionId ? "保存场景" : "创建互动页"}</button>
    </div></section>
    <section style={{ marginTop: 20 }}><div className="section-heading"><div><span className="eyebrow">LIVE PREVIEW</span><h2>实时预览</h2></div><span className="hand-note">不支持动效时仍保留静态内容</span></div>{!sessionId || session ? <InteractiveCanvas photoUrl={firstPhoto?.url} sessionId={sessionId} snapshot={snapshot} /> : <div className="empty-state"><b>正在读取互动场景…</b></div>}</section>
    {sessionId ? <section className="panel" style={{ marginTop: 20 }}><div className="section-heading"><div><span className="eyebrow">PUBLISH & EXPORT</span><h2>公开访问与 15 秒导出</h2></div><b>{session?.state || "active"}</b></div><div className="button-row"><button className="primary-button" disabled={busy} onClick={() => action(`/api/interactive-sessions/${sessionId}/share`, { expiresInHours: 168 }, "公开分享已开启 7 天。")} type="button">开启公开分享</button><button className="secondary-button" disabled={busy || !session?.shareToken || Boolean(session.revokedAt)} onClick={() => action(`/api/interactive-sessions/${sessionId}/revoke-share`, {}, "分享已经撤销，访客页将显示失效状态。")} type="button">撤销分享</button><button className="primary-button" disabled={busy || session?.exportStatus === "queued" || session?.exportStatus === "processing"} onClick={() => action(`/api/interactive-sessions/${sessionId}/export`, {}, "15 秒 MP4 已进入服务端导出队列。")} type="button">{session?.exportStatus === "queued" || session?.exportStatus === "processing" ? `导出中 ${session.exportProgress || 0}%` : "导出 15 秒 MP4"}</button>{session?.sharePath && !session.revokedAt ? <a className="secondary-button" href={session.sharePath}>打开公开访客页</a> : null}{session?.workId ? <Link className="secondary-button" href={`/works/${session.workId}`}>查看归档作品</Link> : null}</div></section> : null}
    {message ? <div className="error-banner" role="status">{message}</div> : null}
  </>;
}
