"use client";

import Image from "next/image";
import { useEffect, useMemo, useState } from "react";

import type { OwnerPhoto, Pet, Photo } from "@/domain/models";
import { apiFetch, apiUpload } from "@/lib/api";

type ImageTemplate = {
  entryId: string;
  templateId: string;
  title: string;
  subjectMode: "pet" | "owner-pet" | "pet-human";
  orientation: "portrait" | "landscape";
  size: "720x1280" | "1280x720";
  version: string;
  status: "live";
  sampleUrl: string;
  candidateCount: 2 | 4;
  rerollSupported: boolean;
};

type TemplateEntry = { id: string; title: string; templates: ImageTemplate[] };

export function AiCreateClient() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [petId, setPetId] = useState("");
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [photoId, setPhotoId] = useState("");
  const [entries, setEntries] = useState<TemplateEntry[]>([]);
  const [entryId, setEntryId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [ownerPhotos, setOwnerPhotos] = useState<OwnerPhoto[]>([]);
  const [ownerPhotoId, setOwnerPhotoId] = useState("");
  const [authorizationConfirmed, setAuthorizationConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const activeEntry = entries.find((entry) => entry.id === entryId);
  const activeTemplate = useMemo(
    () => entries.flatMap((entry) => entry.templates).find((template) => template.templateId === templateId),
    [entries, templateId],
  );

  useEffect(() => {
    Promise.all([
      apiFetch<Pet[]>("/api/pets"),
      apiFetch<{ entries: TemplateEntry[] }>("/api/image-templates"),
      apiFetch<OwnerPhoto[]>("/api/owner-photos"),
    ]).then(([petItems, catalog, owners]) => {
      const defaultPet = petItems.find((item) => item.isDefault) || petItems[0];
      const firstEntry = catalog.entries[0];
      setPets(petItems);
      setPetId(defaultPet?.id || "");
      setEntries(catalog.entries);
      setEntryId(firstEntry?.id || "");
      setTemplateId(firstEntry?.templates[0]?.templateId || "");
      setOwnerPhotos(owners);
    }).catch((loadError) => setError(loadError instanceof Error ? loadError.message : "制作页加载失败"));
  }, []);

  useEffect(() => {
    if (!petId) return;
    apiFetch<Photo[]>(`/api/photos?petId=${encodeURIComponent(petId)}`)
      .then((items) => { setPhotos(items); setPhotoId(""); })
      .catch((loadError) => setError(loadError instanceof Error ? loadError.message : "照片加载失败"));
  }, [petId]);

  function chooseEntry(nextEntryId: string) {
    const entry = entries.find((item) => item.id === nextEntryId);
    setEntryId(nextEntryId);
    setTemplateId(entry?.templates[0]?.templateId || "");
    setOwnerPhotoId("");
    setAuthorizationConfirmed(false);
  }

  async function uploadOwnerPhoto(file?: File) {
    if (!file) return;
    if (!authorizationConfirmed) { setError("请先确认照片中的本人已同意用于本次 AI 生图"); return; }
    setBusy(true); setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      form.append("filename", file.name);
      form.append("authorizationConfirmed", "true");
      const created = await apiUpload<OwnerPhoto>("/api/owner-photos", form);
      setOwnerPhotos((current) => [created, ...current]);
      setOwnerPhotoId(created.id);
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : "主人照片上传失败");
    } finally {
      setBusy(false);
    }
  }

  async function removeOwnerPhoto(id: string) {
    setBusy(true); setError("");
    try {
      await apiFetch(`/api/owner-photos/${encodeURIComponent(id)}`, { method: "DELETE" });
      setOwnerPhotos((current) => current.filter((photo) => photo.id !== id));
      if (ownerPhotoId === id) setOwnerPhotoId("");
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "主人照片删除失败");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    if (!activeTemplate || !petId || !photoId) { setError("请先选择模板、宠物和 1 张宠物身份照"); return; }
    if (activeTemplate.subjectMode === "owner-pet" && (!ownerPhotoId || !authorizationConfirmed)) {
      setError("人宠模板需要选择 1 张已授权的主人照片"); return;
    }
    setBusy(true); setError("");
    try {
      const run = await apiFetch<{ id: string }>("/api/ai-runs", {
        method: "POST",
        body: JSON.stringify({
          pluginId: "pl-10",
          templateId: activeTemplate.templateId,
          petId,
          photoIds: [photoId],
          ownerPhotoIds: activeTemplate.subjectMode === "owner-pet" ? [ownerPhotoId] : [],
          authorizationConfirmed: activeTemplate.subjectMode === "owner-pet" && authorizationConfirmed,
          promptVersion: `template-${activeTemplate.version}`,
          modelVersion: "provider-v1",
          idempotencyKey: `web-${Date.now()}-${activeTemplate.templateId}-${photoId}`,
        }),
      });
      window.location.href = `/ai-runs/${run.id}`;
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "AI 任务创建失败");
      setBusy(false);
    }
  }

  return <>
    <section className="panel ai-brief-card"><span className="eyebrow">TEMPLATE SHELF</span><h2>先选玩法，再替换成你们</h2><p>运行时只使用自有模板和你选择的身份照片；候选均保留 AI 标识。</p></section>
    <section className="panel" style={{ marginTop: 18 }}><div className="form-grid">
      <div className="field"><label htmlFor="ai-entry">玩法入口</label><select id="ai-entry" value={entryId} onChange={(event) => chooseEntry(event.target.value)}>{entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.title}</option>)}</select></div>
      <div className="field"><span>模板</span><div className="asset-choice-grid">{activeEntry?.templates.map((template) => <button aria-pressed={templateId === template.templateId} className={templateId === template.templateId ? "asset-choice selected" : "asset-choice"} key={template.templateId} onClick={() => setTemplateId(template.templateId)} type="button"><Image alt={template.title} fill sizes="160px" src={template.sampleUrl} unoptimized /><span>{template.title}</span></button>)}</div></div>
      <div className="field"><label htmlFor="ai-pet">宠物</label><select id="ai-pet" value={petId} onChange={(event) => setPetId(event.target.value)}><option value="">选择宠物</option>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></div>
      <div className="field"><span>宠物身份照（1 张）</span><div className="asset-choice-grid">{photos.map((photo) => <button aria-pressed={photoId === photo.id} className={photoId === photo.id ? "asset-choice selected" : "asset-choice"} key={photo.id} onClick={() => setPhotoId(photo.id)} type="button"><Image alt={photo.filename} fill sizes="120px" src={photo.url} unoptimized /><span>{photoId === photo.id ? "已选" : "选择"}</span></button>)}</div>{!photos.length ? <p className="field-hint">这只宠物还没有照片，请先去照片库上传。</p> : null}</div>
      {activeTemplate?.subjectMode === "owner-pet" ? <>
        <label className="field"><span>主人照片授权</span><span><input checked={authorizationConfirmed} onChange={(event) => setAuthorizationConfirmed(event.target.checked)} type="checkbox" /> 照片中的本人已同意将照片用于本次 AI 生图</span></label>
        <div className="field"><span>主人身份照（1 张）</span><input accept="image/jpeg,image/png,image/webp" disabled={busy || !authorizationConfirmed} onChange={(event) => uploadOwnerPhoto(event.target.files?.[0])} type="file" /><div className="asset-choice-grid">{ownerPhotos.map((photo) => <div key={photo.id}><button aria-pressed={ownerPhotoId === photo.id} className={ownerPhotoId === photo.id ? "asset-choice selected" : "asset-choice"} onClick={() => setOwnerPhotoId(photo.id)} type="button"><Image alt={photo.filename} fill sizes="120px" src={photo.url} unoptimized /><span>{ownerPhotoId === photo.id ? "已选" : "选择"}</span></button><button disabled={busy} onClick={() => removeOwnerPhoto(photo.id)} type="button">删除</button></div>)}</div></div>
      </> : null}
      <button className="primary-button" disabled={busy || !activeTemplate || !photoId || activeTemplate.subjectMode === "owner-pet" && (!ownerPhotoId || !authorizationConfirmed)} onClick={create} type="button">{busy ? "正在建立生成任务…" : `生成 ${activeTemplate?.candidateCount || 4} 张候选`}</button>
    </div></section>
    {error ? <div className="error-banner" role="alert">{error}</div> : null}
  </>;
}
