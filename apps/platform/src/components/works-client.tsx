"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useState } from "react";

import type { GenerationTask, Pet, PluginManifest, PublicWork } from "@/domain/models";
import { apiFetch } from "@/lib/api";

export function WorksClient() {
  const [works, setWorks] = useState<PublicWork[] | null>(null);
  const [tasks, setTasks] = useState<GenerationTask[]>([]);
  const [pets, setPets] = useState<Pet[]>([]);
  const [plugins, setPlugins] = useState<PluginManifest[]>([]);
  const [status, setStatus] = useState("all");
  const [petId, setPetId] = useState("");
  const [pluginId, setPluginId] = useState("");
  const [now] = useState(() => Date.now());

  useEffect(() => {
    Promise.all([
      apiFetch<PublicWork[]>("/api/works"),
      apiFetch<GenerationTask[]>("/api/generations"),
      apiFetch<Pet[]>("/api/pets"),
      apiFetch<PluginManifest[]>("/api/plugins"),
    ]).then(([nextWorks, nextTasks, nextPets, nextPlugins]) => {
      setWorks(nextWorks); setTasks(nextTasks); setPets(nextPets); setPlugins(nextPlugins);
    }).catch(() => setWorks([]));
  }, []);

  if (works === null) return <div className="empty-state"><b>正在整理作品柜…</b></div>;

  const filtered = works.filter((work) => {
    if (petId && work.petId !== petId) return false;
    if (pluginId && work.pluginId !== pluginId) return false;
    if (status === "locked" && !work.locked) return false;
    if (status === "unlocked" && work.locked) return false;
    if (status === "expired" && (!work.locked || !work.expiresAt || new Date(work.expiresAt).getTime() >= now)) return false;
    return true;
  });
  const pendingTasks = tasks.filter((task) => ["queued", "processing", "failed"].includes(task.status) && (!petId || task.petId === petId) && (!pluginId || task.pluginId === pluginId) && (status === "all" || status === task.status || status === "processing" && ["queued", "processing"].includes(task.status)));

  return <>
    <section className="panel" style={{ marginBottom: 18 }}><div className="form-grid">
      <div className="field"><label htmlFor="works-pet">宠物</label><select id="works-pet" value={petId} onChange={(event) => setPetId(event.target.value)}><option value="">全部宠物</option>{pets.map((pet) => <option key={pet.id} value={pet.id}>{pet.name}</option>)}</select></div>
      <div className="field"><label htmlFor="works-plugin">玩法</label><select id="works-plugin" value={pluginId} onChange={(event) => setPluginId(event.target.value)}><option value="">全部玩法</option>{plugins.map((plugin) => <option key={plugin.id} value={plugin.id}>{plugin.name}</option>)}</select></div>
      <div className="field"><label htmlFor="works-status">状态</label><select id="works-status" value={status} onChange={(event) => setStatus(event.target.value)}><option value="all">全部状态</option><option value="processing">生成中</option><option value="failed">失败</option><option value="locked">待解锁</option><option value="unlocked">已解锁</option><option value="expired">已过期</option></select></div>
    </div></section>
    <div className="work-list">
      {pendingTasks.map((task) => <div className="work-list-item" key={task.id}><div className="work-list-copy"><span>{task.pluginId}</span><h2>{task.status === "failed" ? "生成失败" : "作品生成中"}</h2><p>{task.status === "failed" ? `错误：${task.errorCode || "未知错误"}，免费次数已返还` : `当前进度 ${task.progress}%`}</p>{task.status === "failed" ? <Link className="secondary-button" href={`/create/${task.pluginId}?petId=${task.petId}`}>重新尝试</Link> : null}</div></div>)}
      {filtered.map((work) => <Link className="work-list-item" href={`/works/${work.id}`} key={work.id}><div className="work-list-photo">{work.assetKind === "video" ? <video muted playsInline poster={work.photo.url} src={work.outputUrl} /> : <Image src={work.outputUrl || work.photo.url} alt={`${work.pet.name}的作品`} fill sizes="108px" unoptimized />}</div><div className="work-list-copy"><span>{work.plugin.code} · {work.assetKind === "video" ? "15 秒视频" : work.locked ? "待解锁" : "高清版"}</span><h2>{work.title}</h2><p>{new Date(work.createdAt).toLocaleDateString("zh-CN")} · {work.pet.name} · v{work.version}</p></div></Link>)}
    </div>
    {!pendingTasks.length && !filtered.length ? <div className="empty-state"><div><b>没有符合筛选条件的作品</b><p>调整筛选，或从一个免费玩法开始。</p><Link className="primary-button" href="/">挑一个玩法</Link></div></div> : null}
  </>;
}
