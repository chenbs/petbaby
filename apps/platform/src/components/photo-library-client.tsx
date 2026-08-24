"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import type { Pet, Photo } from "@/domain/models";
import { apiFetch } from "@/lib/api";

export function PhotoLibraryClient() {
  const [pets, setPets] = useState<Pet[]>([]); const [petId, setPetId] = useState(""); const [photos, setPhotos] = useState<Photo[]>([]); const [message, setMessage] = useState("");
  useEffect(() => { apiFetch<Pet[]>("/api/pets").then((items) => { setPets(items); setPetId(items.find((item) => item.isDefault)?.id || items[0]?.id || ""); }); }, []);
  useEffect(() => { if (petId) apiFetch<Photo[]>(`/api/photos?petId=${petId}`).then(setPhotos); }, [petId]);
  async function remove(id: string) { await apiFetch(`/api/photos/${id}`, { method: "DELETE" }); setPhotos((items) => items.filter((item) => item.id !== id)); }
  async function move(index: number, offset: number) { const target = index + offset; if (target < 0 || target >= photos.length) return; const next = [...photos]; [next[index], next[target]] = [next[target], next[index]]; setPhotos(next); await apiFetch("/api/photos", { method: "PATCH", body: JSON.stringify({ petId, photoIds: next.map((item) => item.id) }) }); setMessage("顺序已保存"); }
  return <><div className="field"><label htmlFor="photo-pet">宠物</label><select id="photo-pet" value={petId} onChange={(event) => setPetId(event.target.value)}>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></div><div className="work-list">{photos.map((photo, index) => <div className="work-list-item" key={photo.id}><div className="work-list-photo"><Image alt={photo.filename} fill sizes="108px" src={photo.url} unoptimized /></div><div className="work-list-copy"><span>{photo.quality === "blurry" ? "清晰度偏低" : "照片库"}</span><h2>{photo.filename}</h2><div className="button-row"><button className="secondary-button" onClick={() => move(index, -1)} type="button">上移</button><button className="secondary-button" onClick={() => move(index, 1)} type="button">下移</button><button className="secondary-button" onClick={() => remove(photo.id)} type="button">删除</button></div></div></div>)}</div>{!photos.length ? <div className="empty-state"><b>当前宠物还没有照片</b></div> : null}{message ? <div className="error-banner" role="status">{message}</div> : null}</>;
}
