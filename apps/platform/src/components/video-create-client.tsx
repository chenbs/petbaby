/* eslint-disable @next/next/no-img-element */
"use client";

import { useEffect, useMemo, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { Pet, Photo } from "@/domain/models";
import { DEFAULT_VIDEO_DURATION, VIDEO_DURATION_OPTIONS, maxPhotosFor } from "@/domain/video-duration";

export function VideoCreateClient() {
  const [pets, setPets] = useState<Pet[]>([]); const [photos, setPhotos] = useState<Photo[]>([]); const [petId, setPetId] = useState(""); const [selected, setSelected] = useState<string[]>([]); const [title, setTitle] = useState("我们的日常电影"); const [bgm, setBgm] = useState("none"); const [caption, setCaption] = useState(""); const [message, setMessage] = useState("");
  const [durationSeconds, setDurationSeconds] = useState<number>(DEFAULT_VIDEO_DURATION);
  // 张数上限随所选时长收紧：单张停留短于两段 fade 之和会让画面大半在黑场。
  const maxPhotos = maxPhotosFor(durationSeconds);
  useEffect(() => { apiFetch<Pet[]>("/api/pets").then((items) => { setPets(items); const pet = items.find((item) => item.isDefault) || items[0]; if (pet) { setPetId(pet.id); apiFetch<Photo[]>(`/api/photos?petId=${pet.id}`).then(setPhotos); } }).catch((error) => setMessage(error.message)); }, []);
  const activePhotos = useMemo(() => selected.map((id) => photos.find((photo) => photo.id === id)).filter((photo): photo is Photo => Boolean(photo)), [photos, selected]);
  function choosePet(id: string) { setPetId(id); setSelected([]); apiFetch<Photo[]>(`/api/photos?petId=${id}`).then(setPhotos).catch((error) => setMessage(error.message)); }
  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((item) => item !== id) : current.length >= maxPhotos ? current : [...current, id]); }
  /**
   * 换时长时如果已选照片超了新档的上限，不静默截断 —— 那等于替用户丢照片。
   * 只给出提示，由用户决定取消哪几张，创建按钮同时置灰。
   */
  function chooseDuration(next: number) {
    setDurationSeconds(next);
    const limit = maxPhotosFor(next);
    setMessage(selected.length > limit ? `${next} 秒的片子最多放 ${limit} 张照片，当前选了 ${selected.length} 张。取消几张再创建。` : "");
  }
  function move(index: number, direction: -1 | 1) { setSelected((current) => { const next = current.slice(); const target = index + direction; if (target < 0 || target >= next.length) return current; [next[index], next[target]] = [next[target], next[index]]; return next; }); }
  async function create() { try { if (!petId || !selected.length) throw new Error("请先选择至少一张照片"); if (selected.length > maxPhotos) throw new Error(`${durationSeconds} 秒的片子最多放 ${maxPhotos} 张照片`); const project = await apiFetch<{ id: string }>("/api/video-projects", { method: "POST", body: JSON.stringify({ petId, title, photoIds: selected, durationSeconds, captions: caption ? [caption] : [], bgm, transitions: selected.map(() => "fade") }) }); window.location.href = `/video/${project.id}`; } catch (error) { setMessage(error instanceof Error ? error.message : "创建失败"); } }
  return <><section className="panel"><div className="form-grid"><div className="field"><label htmlFor="video-pet">宠物</label><select id="video-pet" value={petId} onChange={(event) => choosePet(event.target.value)}>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></div><div className="field"><label htmlFor="video-title">项目名称</label><input id="video-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div><div className="field"><label htmlFor="video-bgm">背景音乐</label><select id="video-bgm" value={bgm} onChange={(event) => setBgm(event.target.value)}><option value="none">无音乐</option><option value="calm">晚风</option><option value="bright">晴天</option></select></div><div className="field"><label htmlFor="video-caption">片尾字幕</label><input id="video-caption" value={caption} onChange={(event) => setCaption(event.target.value)} placeholder="例如：和你一起的每一天" /></div><div className="field"><label htmlFor="video-duration">成片时长</label><select id="video-duration" value={durationSeconds} onChange={(event) => chooseDuration(Number(event.target.value))}>{VIDEO_DURATION_OPTIONS.map((option) => <option key={option} value={option}>{option} 秒（最多 {maxPhotosFor(option)} 张）</option>)}</select></div></div></section><section className="panel" style={{ marginTop: 20 }}><div className="section-heading"><div><span className="eyebrow">PHOTO EDITOR</span><h2>选择照片并排序</h2></div><span>{selected.length}/{maxPhotos} · 每张约 {(durationSeconds / Math.max(1, selected.length)).toFixed(1)} 秒</span></div><div className="photo-grid">{photos.map((photo) => <button className={selected.includes(photo.id) ? "photo-tile selected" : "photo-tile"} key={photo.id} onClick={() => toggle(photo.id)} type="button"><img src={photo.url} alt={photo.filename} /><span>{selected.indexOf(photo.id) + 1 || "选择"}</span></button>)}</div><div className="settings-list" style={{ marginTop: 18 }}>{activePhotos.map((photo, index) => <div key={photo.id}><span><b>{index + 1}. {photo.filename}</b><small style={{ display: "block" }}>转场：淡入淡出 · 逐段字幕可在项目页调整</small></span><span><button type="button" onClick={() => move(index, -1)}>上移</button><button type="button" onClick={() => move(index, 1)}>下移</button></span></div>)}</div><button className="primary-button" disabled={!selected.length || selected.length > maxPhotos} onClick={create} type="button">创建并进入编辑</button></section>{message ? <div className="error-banner" role="status">{message}</div> : null}</>;
}
