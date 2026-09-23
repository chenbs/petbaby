"use client";

import Image from "next/image";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";

import type { Pet, Photo } from "@/domain/models";
import { apiFetch } from "@/lib/api";
import { PHOTO_TAGS } from "@/domain/photo-memory";

/*
 * Web 成长时间线（改造项 E6）。
 *
 * 服务端 `getPetTimeline` 与 `GET /api/pets/[id]/timeline` 早已建成，
 * 但只有小程序有页面 —— 20 号文 2.2 把「积累层的底座只有单端」列为
 * 情绪价值的分发缺口之一。
 *
 * 与小程序 `pages/timeline` **同数据源、同口径**：「第几天」由服务端算好下发，
 * 端上一律不重算。两边各算一次就会出现「小程序写第 743 天、Web 写第 742 天」，
 * 而那种差异无法向用户解释。
 */

type TimelineEntry = {
  photo: Photo;
  day: number;
  date: string;
  dateSource: "manual" | "exif" | "upload";
  showDay: boolean;
  milestone?: string;
};

type Timeline = {
  petId: string;
  petName: string;
  anchor: string;
  anchorType: "birthday" | "got_home" | "created";
  totalDays: number;
  memorialSince?: string;
  entries: TimelineEntry[];
  totalCount: number;
  nextCursor?: string;
  milestones: Array<{ day: number; label: string; date?: string }>;
};

/** 起算日语义。有生日说「出生」，只有到家日说「到家」，都没有就只能从建档日算 */
const DATE_SOURCE = { manual: "你设置的日期", exif: "照片里的拍摄时间", upload: "按上传时间记录" };

/**
 * 陪伴天数文案。与 `domain/companion.ts` 的 `companionText` 同一套判断：
 * 已离开且**没有固定截止日**时不给数字 —— 用户可以直接把阶段改成「已离开」
 * 而不建纪念空间，此时天数会一路算到今天，出现「陪伴了 4078 天」这种
 * 过去式配递增数字的组合，正是拍板要避免的冒犯。
 */
function companionText(timeline: Timeline, lifeStage?: string) {
  if (lifeStage !== "memorial") return `陪伴第 ${timeline.totalDays} 天`;
  if (!timeline.memorialSince) return "曾一起走过一段";
  return `陪伴了 ${timeline.totalDays} 天`;
}

/** 按年份分组。一条平铺的长列表读不出「哪一年」，而时间线的意义正是让人看见跨度 */
function groupByYear(entries: TimelineEntry[]) {
  const groups: Array<{ year: string; items: TimelineEntry[] }> = [];
  for (const entry of entries) {
    const year = entry.date.slice(0, 4) || "更早";
    const last = groups[groups.length - 1];
    if (last && last.year === year) last.items.push(entry);
    else groups.push({ year, items: [entry] });
  }
  return groups;
}

export function TimelineClient({ initialPetId }: { initialPetId?: string }) {
  const [pets, setPets] = useState<Pet[]>([]);
  const [petId, setPetId] = useState(initialPetId || "");
  const [timeline, setTimeline] = useState<Timeline>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [filmYear, setFilmYear] = useState(new Date().getFullYear());
  const [filmDuration, setFilmDuration] = useState(20);
  const [loadingMore, setLoadingMore] = useState(false);
  const activePet = useRef(petId);
  const requestVersion = useRef(0);
  const filmVersion = useRef(0);
  const session = useRef("");
  const [filmPreview, setFilmPreview] = useState<{ petId: string; petName: string; year: number; durationSeconds: number; photos: Array<{ id: string; url: string; date: string }>; amount: number; label: string }>();

  useEffect(() => {
    apiFetch<Pet[]>("/api/pets").then((items) => {
      setPets(items);
      /*
       * 带 petId 进来时看的就是那只，不回落到默认宠物 ——
       * 小程序侧同一条约定（见 CLAUDE.md：不带 petId 会看到错的那只）。
       */
      setPetId((current) => current || items.find((item) => item.isDefault)?.id || items[0]?.id || "");
    }).catch((error: unknown) => setMessage(error instanceof Error ? error.message : "宠物档案加载失败"));
  }, []);

  useEffect(() => {
    if (!petId) return;
    activePet.current = petId;
    let active = true;
    const refresh = () => {
      const version = ++requestVersion.current;
      filmVersion.current++;
      setTimeline(undefined); setFilmPreview(undefined); setMessage("");
      setLoadingMore(false); setBusy(false);
      apiFetch<Timeline>(`/api/pets/${petId}/timeline?pageSize=50`).then((data) => {
        if (!active || version !== requestVersion.current) return;
        setTimeline(data);
        session.current ||= crypto.randomUUID();
        apiFetch("/api/events", { method: "POST", body: JSON.stringify({ name: "memory_viewed", channel: "web", metadata: { sessionId: session.current, petId, viewType: "timeline" } }) }).catch(() => undefined);
      }).catch((error: unknown) => { if (active && version === requestVersion.current) setMessage(error instanceof Error ? error.message : "时间线加载失败"); });
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => { active = false; requestVersion.current++; filmVersion.current++; window.removeEventListener("focus", refresh); };
  }, [petId]);

  async function more() {
    if (!timeline?.nextCursor || loadingMore) return;
    const selected = petId;
    const version = requestVersion.current;
    setLoadingMore(true);
    try {
      const page = await apiFetch<Timeline>(`/api/pets/${selected}/timeline?pageSize=50&cursor=${encodeURIComponent(timeline.nextCursor)}`);
      if (version === requestVersion.current && activePet.current === selected) setTimeline((current) => current ? { ...page, entries: [...current.entries, ...page.entries] } : page);
    } catch (error) { if (version === requestVersion.current) setMessage(error instanceof Error ? error.message : "加载失败"); }
    finally { if (version === requestVersion.current) setLoadingMore(false); }
  }

  /*
   * 叙事年度视频（E5 的 Web 侧）。只入队不轮询：四段 filtergraph 而队列并发是 1，
   * 渲染要几十秒到几分钟，让用户停在这一页等是错的。
   */
  async function createFilm() {
    if (busy) return;
    const version = ++filmVersion.current;
    setBusy(true); setMessage("");
    try {
      const [selection, pricing] = await Promise.all([
        apiFetch<NonNullable<typeof filmPreview>>(`/api/annual-films?petId=${petId}&year=${filmYear}&durationSeconds=${filmDuration}`),
        apiFetch<{ amount: number; label: string }>(`/api/pets/${petId}/pricing?pluginId=pl-19`),
      ]);
      if (activePet.current !== petId || version !== filmVersion.current) return;
      if (!selection.photos.length) throw new Error("这一年还没有可用照片，请先收好照片或校正日期");
      setFilmPreview({ ...selection, ...pricing });
      apiFetch("/api/events", { method: "POST", body: JSON.stringify({ name: "record_deliverable_opened", channel: "web", metadata: { petId, productId: "pl-19", entry: "timeline" } }) }).catch(() => undefined);
    } catch (error) { if (version === filmVersion.current) setMessage(error instanceof Error ? error.message : "年度短片生成失败"); }
    finally { if (version === filmVersion.current) setBusy(false); }
  }

  async function confirmFilm() {
    if (!filmPreview || busy) return;
    setBusy(true); setMessage("");
    try {
      const created = await apiFetch<{ shots: number; petName: string }>("/api/annual-films", { method: "POST", body: JSON.stringify({ petId: filmPreview.petId, year: filmPreview.year, durationSeconds: filmPreview.durationSeconds, photoIds: filmPreview.photos.map((photo) => photo.id) }) });
      if (activePet.current === filmPreview.petId) { setFilmPreview(undefined); setMessage(`已为 ${created.petName} 开始渲染，使用确认的 ${created.shots} 张照片，完成后到作品库查看。`); }
    } catch (error) { setMessage(error instanceof Error ? error.message : "年度短片生成失败"); }
    finally { setBusy(false); }
  }

  const pet = pets.find((item) => item.id === petId);
  const groups = timeline ? groupByYear(timeline.entries) : [];
  const thisYear = new Date().getFullYear();

  return <>
    {pets.length > 1 ? <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="timeline-pet">宠物</label><select id="timeline-pet" disabled={busy} value={petId} onChange={(event) => { activePet.current = event.target.value; requestVersion.current++; filmVersion.current++; setPetId(event.target.value); setTimeline(undefined); setFilmPreview(undefined); }}>{pets.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div></div></section> : null}

    {timeline ? <>
      <div className="page-heading">
        <span className="eyebrow">GROWTH TIMELINE</span>
        <h2>{companionText(timeline, pet?.lifeStage)}</h2>
        <p>按记录日期回看，每张照片都标明日期来源。</p>
      </div>

      {/* 已达成的里程碑。只列过去的 —— 服务端按 totalDays 过滤，纪念宠物按离开日封口 */}
      {timeline.milestones.length ? <section className="panel"><span className="eyebrow">已经走过</span><div className="settings-list">{timeline.milestones.map((milestone) => <div key={milestone.day}><span><b>{milestone.label}</b></span>{milestone.date ? <span>{milestone.date}</span> : null}</div>)}</div></section> : null}

      {timeline.entries.length === 0
        ? <section className="panel"><p>还没有照片。收好之后，这里会按记录日期排成一条线。</p><Link className="primary-button" href={`/photos?petId=${petId}`}>去照片库</Link></section>
        : groups.map((group) => <section className="panel" key={group.year}>
          <span className="eyebrow">{group.year}</span>
          <div className="work-list">{group.items.map((entry) => <div className="work-list-item" key={entry.photo.id}>
            <div className="photo-thumb" style={{ position: "relative", width: 96, height: 120, flex: "none" }}>
              <Image alt={`${timeline.petName} ${entry.date}`} fill sizes="96px" src={entry.photo.url} style={{ objectFit: "cover" }} unoptimized />
            </div>
            <div className="work-list-copy">
              {entry.showDay ? <h3>第 {entry.day} 天</h3> : null}
              <span>{entry.date}</span>
              {/* 没有 EXIF 的照片只有上传时间，标注出来，别把它当拍摄事实展示 */}
              <small style={{ display: "block" }}>{DATE_SOURCE[entry.dateSource]}</small>
              {entry.photo.caption ? <p>{entry.photo.caption}</p> : null}
              {entry.photo.tags?.length ? <small>{entry.photo.tags.map((code) => PHOTO_TAGS.find((tag) => tag.code === code)?.label).join(" · ")}</small> : null}
              {entry.milestone ? <small><b>{entry.milestone}</b></small> : null}
            </div>
          </div>)}</div>
        </section>)}
      <p>照片库共 {timeline.totalCount} 张</p>
      {timeline.nextCursor ? <button className="secondary-button" disabled={loadingMore} onClick={more} type="button">加载更多</button> : <p>没有更多了</p>}

      {/*
        叙事年度视频入口。有照片才出现：没照片的年份服务端会以
        ANNUAL_PHOTOS_REQUIRED 拒掉，先给按钮再报错是让用户白点一次。
      */}
      {timeline.entries.length ? <section className="panel">
        <span className="eyebrow">做成一段短片</span>
        <p>把这一年的照片按时间剪成一段叙事短片，带上「第 N 天」与当年的数字。</p>
        <div className="form-grid">
          <div className="field"><label htmlFor="film-year">年份</label><select id="film-year" disabled={busy} value={filmYear} onChange={(event) => { filmVersion.current++; setFilmPreview(undefined); setFilmYear(Number(event.target.value)); }}>{[thisYear, thisYear - 1].map((year) => <option key={year} value={year}>{year} 年</option>)}</select></div>
          <div className="field"><label htmlFor="film-duration">时长</label><select id="film-duration" disabled={busy} value={filmDuration} onChange={(event) => { filmVersion.current++; setFilmPreview(undefined); setFilmDuration(Number(event.target.value)); }}>{[10, 20, 30].map((seconds) => <option key={seconds} value={seconds}>{seconds} 秒</option>)}</select></div>
        </div>
        <button className="primary-button" disabled={busy} onClick={createFilm} type="button">确认年度素材与报价</button>
        {filmPreview ? <div><p>{filmPreview.petName} · {filmPreview.year} · {filmPreview.durationSeconds} 秒；采用以下 {filmPreview.photos.length} 张照片。</p><div className="photo-thumbs">{filmPreview.photos.map((photo) => <div key={photo.id}><Image src={photo.url} alt={photo.date} width={96} height={120} unoptimized /><small>{photo.date}</small></div>)}</div><p>解锁 ¥{filmPreview.amount} · {filmPreview.label}</p><button className="primary-button" disabled={busy} onClick={confirmFilm} type="button">用这些照片制作</button></div> : null}
      </section> : null}
    </> : null}

    {message ? <div className="error-banner" role="status">{message}</div> : null}
  </>;
}
