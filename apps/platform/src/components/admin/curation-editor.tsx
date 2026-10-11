"use client";
/* eslint-disable @next/next/no-img-element -- 样片走站内接口、尺寸很小，不需要 next/image 的优化链路 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Check, Plus, Search, Star, X } from "lucide-react";

import { apiFetch } from "@/lib/api";
import { inputClass } from "./action-dialog";
import { buttonClass, Card, CardBody, CardHeader, cn } from "./ui";

type Template = { id: string; title: string; entry: string; sample: string | null };
type Scene = { id: string; title: string; description: string };
type Curation = { lead: { templateId: string; title: string; subtitle: string }; templateIds: string[]; sceneIds: string[]; note: string; version: number };

const MAX_TEMPLATES = 12;
const MAX_SCENES = 12;

function move<T>(list: T[], index: number, delta: number) {
  const next = list.slice();
  const target = index + delta;
  if (target < 0 || target >= next.length) return list;
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

export function CurationEditor({ initial, templates, scenes }: { initial: Curation; templates: Template[]; scenes: Scene[] }) {
  const router = useRouter();
  const [lead, setLead] = useState(initial.lead);
  const [templateIds, setTemplateIds] = useState(initial.templateIds);
  const [sceneIds, setSceneIds] = useState(initial.sceneIds);
  const [note, setNote] = useState(initial.note);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("");
  const [busy, setBusy] = useState(false);
  const byId = useMemo(() => new Map(templates.map((template) => [template.id, template])), [templates]);
  const sceneById = useMemo(() => new Map(scenes.map((scene) => [scene.id, scene])), [scenes]);
  const candidates = templates.filter((template) => !templateIds.includes(template.id) && (!filter || `${template.title}${template.entry}${template.id}`.toLowerCase().includes(filter.toLowerCase())));
  const dirty = JSON.stringify({ lead, templateIds, sceneIds, note }) !== JSON.stringify({ lead: initial.lead, templateIds: initial.templateIds, sceneIds: initial.sceneIds, note: initial.note });

  async function save() {
    if (reason.trim().length < 2) { toast.error("请填写发布原因（至少 2 个字）"); return; }
    setBusy(true);
    try {
      const result = await apiFetch<{ version: number }>("/api/admin/home-curation", { method: "PUT", body: JSON.stringify({ config: { lead, templateIds, sceneIds, note }, reason }) });
      toast.success(`已发布 v${result.version}`);
      setReason("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "发布失败");
    } finally {
      setBusy(false);
    }
  }

  const leadTemplate = byId.get(lead.templateId);

  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
      <div className="space-y-4">
        <Card>
          <CardHeader title="主推位" description="首页精选区最大的一张卡" actions={<Star aria-hidden className="size-4 text-accent" />} />
          <CardBody className="grid gap-4 sm:grid-cols-[160px_1fr]">
            <div className="aspect-[9/16] overflow-hidden rounded-lg bg-surface-2">
              {leadTemplate?.sample ? <img src={leadTemplate.sample} alt={leadTemplate.title} className="size-full object-cover" /> : <div className="grid size-full place-items-center text-xs text-muted">无样片</div>}
            </div>
            <div className="space-y-3">
              <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">模板</span>
                <select className={inputClass} value={lead.templateId} onChange={(event) => setLead({ ...lead, templateId: event.target.value })}>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.entry} · {template.title}</option>)}
                </select>
              </label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">标题（≤ 20 字）</span><input className={inputClass} maxLength={20} value={lead.title} onChange={(event) => setLead({ ...lead, title: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">副标题（≤ 40 字）</span><input className={inputClass} maxLength={40} value={lead.subtitle} onChange={(event) => setLead({ ...lead, subtitle: event.target.value })} /></label>
              <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">角标（≤ 12 字）</span><input className={inputClass} maxLength={12} value={note} onChange={(event) => setNote(event.target.value)} /></label>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`精选模板 · ${templateIds.length}/${MAX_TEMPLATES}`} description="按顺序展示；用箭头调整位置" />
          <CardBody>
            {templateIds.length ? (
              <ol className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {templateIds.map((id, index) => {
                  const template = byId.get(id);
                  return (
                    <li key={id} className="flex items-center gap-3 rounded-lg border border-line p-2">
                      <span className="grid w-5 shrink-0 place-items-center text-xs text-muted tnum">{index + 1}</span>
                      <div className="size-12 shrink-0 overflow-hidden rounded-md bg-surface-2">{template?.sample ? <img src={template.sample} alt="" className="size-full object-cover" /> : null}</div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm text-ink">{template?.title || id}</p>
                        <p className="truncate text-[11px] text-muted">{template ? template.entry : "已下架，保存时会被拒绝"}</p>
                      </div>
                      <div className="flex shrink-0 flex-col">
                        <button type="button" aria-label="上移" disabled={!index} onClick={() => setTemplateIds(move(templateIds, index, -1))} className="grid size-5 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"><ArrowUp className="size-3.5" /></button>
                        <button type="button" aria-label="下移" disabled={index === templateIds.length - 1} onClick={() => setTemplateIds(move(templateIds, index, 1))} className="grid size-5 place-items-center rounded text-muted hover:bg-surface-2 hover:text-ink disabled:opacity-30"><ArrowDown className="size-3.5" /></button>
                      </div>
                      <button type="button" aria-label={`移除 ${template?.title || id}`} onClick={() => setTemplateIds(templateIds.filter((item) => item !== id))} className="grid size-6 shrink-0 place-items-center rounded text-muted hover:bg-surface-2 hover:text-critical-ink"><X className="size-4" /></button>
                    </li>
                  );
                })}
              </ol>
            ) : <p className="py-6 text-center text-xs text-muted">至少选 1 个模板</p>}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title={`写真场景 · ${sceneIds.length}/${MAX_SCENES}`} description="点选加入或移除" />
          <CardBody className="flex flex-wrap gap-2">
            {scenes.map((scene) => {
              const on = sceneIds.includes(scene.id);
              return (
                <button
                  key={scene.id}
                  type="button"
                  aria-pressed={on}
                  disabled={!on && sceneIds.length >= MAX_SCENES}
                  onClick={() => setSceneIds(on ? sceneIds.filter((id) => id !== scene.id) : [...sceneIds, scene.id])}
                  title={scene.description}
                  className={cn("inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs transition-colors disabled:opacity-40", on ? "border-ink bg-ink text-surface" : "border-line text-ink-2 hover:border-line-strong hover:text-ink")}
                >
                  {on ? <Check className="size-3.5" /> : null}{scene.title}
                </button>
              );
            })}
          </CardBody>
        </Card>
      </div>

      <div className="space-y-4 xl:sticky xl:top-20 xl:self-start">
        <Card>
          <CardHeader title="发布" description={`当前线上版本 v${initial.version || 0}`} />
          <CardBody className="space-y-3">
            <label className="block space-y-1.5"><span className="text-xs font-medium text-ink-2">发布原因 *</span><textarea className={cn(inputClass, "resize-y")} rows={2} value={reason} onChange={(event) => setReason(event.target.value)} placeholder="例如：本周主推国庆旅行主题" /></label>
            {sceneIds.length ? <p className="text-xs text-muted">场景：{sceneIds.map((id) => sceneById.get(id)?.title || id).join("、")}</p> : null}
            <div className="flex gap-2">
              <button type="button" disabled={!dirty || busy} onClick={() => { setLead(initial.lead); setTemplateIds(initial.templateIds); setSceneIds(initial.sceneIds); setNote(initial.note); }} className={buttonClass("ghost")}>还原</button>
              <button type="button" disabled={!dirty || busy || !templateIds.length} onClick={() => void save()} className={cn(buttonClass("primary"), "flex-1")}>{busy ? "发布中…" : dirty ? "发布新版本" : "没有改动"}</button>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="添加模板" description={`可选 ${candidates.length} 个上架模板`} />
          <CardBody className="space-y-3">
            <div className="relative"><Search aria-hidden className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" /><input aria-label="筛选模板" className={cn(inputClass, "pl-9")} value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="按名称或入口筛选" /></div>
            <ul className="scrollbar-thin max-h-[420px] space-y-1 overflow-y-auto pr-1">
              {candidates.slice(0, 80).map((template) => (
                <li key={template.id}>
                  <button type="button" disabled={templateIds.length >= MAX_TEMPLATES} onClick={() => setTemplateIds([...templateIds, template.id])} className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left hover:bg-surface-2 disabled:opacity-40">
                    <div className="size-9 shrink-0 overflow-hidden rounded bg-surface-2">{template.sample ? <img src={template.sample} alt="" loading="lazy" className="size-full object-cover" /> : null}</div>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm text-ink">{template.title}</span><span className="block truncate text-[11px] text-muted">{template.entry}</span></span>
                    <Plus aria-hidden className="size-4 text-muted" />
                  </button>
                </li>
              ))}
            </ul>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}
