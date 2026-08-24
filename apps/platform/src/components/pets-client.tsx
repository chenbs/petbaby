"use client";

import Image from "next/image";
import { useEffect, useState, type ChangeEvent } from "react";

import type { Pet } from "@/domain/models";
import { apiFetch, apiUpload } from "@/lib/api";

export function PetsClient() {
  const [pets, setPets] = useState<Pet[]>([]);
  const [editing, setEditing] = useState<Pet>();
  const [message, setMessage] = useState("");
  const reload = () => apiFetch<Pet[]>("/api/pets").then(setPets).catch((error) => setMessage(error instanceof Error ? error.message : "加载失败"));
  useEffect(() => { reload(); }, []);

  async function save() {
    if (!editing) return;
    const updated = await apiFetch<Pet>(`/api/pets/${editing.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: editing.name,
        species: editing.species,
        gender: editing.gender,
        birthday: editing.birthday || "",
        dateType: editing.dateType,
        lifeStage: editing.lifeStage,
      }),
    });
    setPets((items) => items.map((item) => item.id === updated.id ? updated : item));
    setEditing(undefined);
    setMessage("档案已保存");
  }

  async function uploadAvatar(event: ChangeEvent<HTMLInputElement>) {
    if (!editing || !event.target.files?.[0]) return;
    const form = new FormData();
    form.set("file", event.target.files[0]);
    const updated = await apiUpload<Pet>(`/api/pets/${editing.id}/avatar`, form);
    setEditing(updated);
    setPets((items) => items.map((item) => item.id === updated.id ? updated : item));
  }

  async function setDefault(id: string) { await apiFetch(`/api/pets/${id}`, { method: "POST" }); await reload(); }
  async function remove(id: string) { await apiFetch(`/api/pets/${id}`, { method: "DELETE" }); await reload(); }

  return <>
    {editing ? <section className="panel" style={{ marginBottom: 20 }}><div className="form-grid">
      {editing.avatarUrl ? <div style={{ position: "relative", width: 96, height: 96 }}><Image alt={`${editing.name}头像`} fill sizes="96px" src={editing.avatarUrl} unoptimized /></div> : null}
      <div className="field"><label htmlFor="pet-avatar">头像</label><input id="pet-avatar" accept="image/jpeg,image/png,image/webp" onChange={uploadAvatar} type="file" /></div>
      <div className="field"><label htmlFor="pet-name">名字</label><input id="pet-name" value={editing.name} onChange={(event) => setEditing({ ...editing, name: event.target.value })} /></div>
      <div className="field"><label htmlFor="pet-species">物种</label><select id="pet-species" value={editing.species} onChange={(event) => setEditing({ ...editing, species: event.target.value as Pet["species"] })}><option value="cat">猫</option><option value="dog">狗</option><option value="other">其他</option></select></div>
      <div className="field"><label htmlFor="pet-gender">性别</label><select id="pet-gender" value={editing.gender} onChange={(event) => setEditing({ ...editing, gender: event.target.value as Pet["gender"] })}><option value="unknown">未填写</option><option value="female">女孩子</option><option value="male">男孩子</option></select></div>
      <div className="field"><label htmlFor="pet-date-type">日期类型</label><select id="pet-date-type" value={editing.dateType} onChange={(event) => setEditing({ ...editing, dateType: event.target.value as Pet["dateType"] })}><option value="birthday">生日</option><option value="got_home">到家日</option></select></div>
      <div className="field"><label htmlFor="pet-date">日期</label><input id="pet-date" type="date" value={editing.birthday || ""} onChange={(event) => setEditing({ ...editing, birthday: event.target.value })} /></div>
      <div className="field"><label htmlFor="pet-stage">生命阶段</label><select id="pet-stage" value={editing.lifeStage} onChange={(event) => setEditing({ ...editing, lifeStage: event.target.value as Pet["lifeStage"] })}><option value="active">普通档案</option><option value="memorial">纪念档案</option></select></div>
      <div className="button-row"><button className="primary-button" disabled={!editing.name.trim()} onClick={save} type="button">保存档案</button><button className="secondary-button" onClick={() => setEditing(undefined)} type="button">取消</button></div>
    </div></section> : null}
    <section className="settings-list">
      {pets.map((pet) => <div key={pet.id}><span><b>{pet.name}</b><small style={{ display: "block" }}>{pet.species} · {pet.birthday || "未填写日期"} · {pet.lifeStage === "memorial" ? "纪念档案" : "普通档案"}</small></span><span><button className="secondary-button" onClick={() => setEditing(pet)} type="button">编辑</button>{pet.isDefault ? " 默认宠物" : <button className="secondary-button" onClick={() => setDefault(pet.id)} type="button">设为默认</button>}<button className="secondary-button" onClick={() => remove(pet.id)} type="button">删除</button></span></div>)}
      {!pets.length ? <div><b>还没有宠物档案</b><span>请从任一玩法创建</span></div> : null}
      {message ? <div role="status">{message}</div> : null}
    </section>
  </>;
}
