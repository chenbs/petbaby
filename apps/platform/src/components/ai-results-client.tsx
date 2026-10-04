"use client";
import { payWebOrder, webPaymentEnabled, webPaymentNotice } from "@/lib/payment";
import { AiDisclosureLink } from "@/components/ai-disclosure-link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AiRun } from "@/domain/models";

export function AiResultsClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<AiRun>(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [sharePath, setSharePath] = useState(""); const [rerollReason, setRerollReason] = useState<"owner-not-like" | "pet-not-like" | "too-animal" | "composition">("composition");
  async function load() { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`); setRun(next); return next; }
  useEffect(() => { let timer: ReturnType<typeof setTimeout>; let active = true; const poll = async () => { try { const next = await load(); if (active && ["queued", "processing"].includes(next.status)) timer = setTimeout(poll, 1600); } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "任务加载失败"); } }; poll(); return () => { active = false; clearTimeout(timer); }; }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mutate(path: string, body: Record<string, unknown>, success: string, method = "POST") { setBusy(true); try { const next = await apiFetch<AiRun>(path, { method, body: JSON.stringify(body) }); setRun(next); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); } }
  async function select(candidateId: string) { setBusy(true); try { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`, { method: "PATCH", body: JSON.stringify({ action: "select", candidateId }) }); setRun(next); setMessage("这一张已归档到作品库。"); } catch (error) { setMessage(error instanceof Error ? error.message : "选择失败"); } finally { setBusy(false); } }
  async function unlock() {
    setBusy(true);
    try {
      const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}/unlock`, { method: "POST", body: "{}" }); setRun(next);
      if (!next.order) throw new Error("订单创建失败");
      await payWebOrder("work", next.order.id);
      const paid = await load(); setMessage(paid.selectedUnlocked ? "支付成功，高清原图可以下载了。" : "支付结果确认中，请稍后刷新。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "支付准备失败"); } finally { setBusy(false); }
  }
  async function share() { if (!run?.workId) return; setBusy(true); try { const result = await apiFetch<{ path: string }>(`/api/works/${run.workId}/share`, { method: "POST", body: JSON.stringify({ expiresInHours: 168 }) }); setSharePath(result.path); setMessage("作品分享已开启，有效期 7 天。"); } catch (error) { setMessage(error instanceof Error ? error.message : "分享创建失败"); } finally { setBusy(false); } }
  if (!run) return <div className="empty-state"><b>正在读取任务状态…</b></div>;
  const humanMode = run.roleInputs.subjectMode === "pet-human";
  if (["queued", "processing"].includes(run.status)) return <section className="panel task-state-card"><div className="progress-orbit"><span className="progress-number">{run.status === "queued" ? run.queuePosition || 1 : run.attempt}</span></div><div className="progress-copy"><span className="eyebrow">{run.status === "queued" ? "QUEUE" : "PROCESSING"}</span><h2>{run.status === "queued" ? "正在排队" : "正在为我拍这组照片"}</h2><p>{run.status === "queued" ? `前方约 ${Math.max(0, (run.queuePosition || 1) - 1)} 个任务，预计 ${run.estimatedSeconds || 55} 秒` : `大约还要 ${run.estimatedSeconds || 55} 秒，离开也会继续做。`}</p></div><button className="secondary-button" disabled={busy} onClick={() => mutate(`/api/ai-runs/${runId}`, { action: "cancel" }, "任务已取消。", "PATCH")} type="button">取消任务</button></section>;
  if (run.status === "cancelled") return <div className="empty-state"><div><b>任务已经取消</b><p>没有产生订单或权益扣减。</p><a className="primary-button" href="/ai/create">重新创建</a></div></div>;
  if (run.status === "failed") return <div className="empty-state"><div><b>这次生成没有完成</b><p>制作服务暂时没有完成 · 已尝试 {run.attempt} 次，免费次数已返还</p><button className="primary-button" disabled={busy || run.retryCount >= 2} onClick={async () => { setBusy(true); try { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`, { method: "PATCH", body: JSON.stringify({ action: "retry" }) }); setRun(next); setMessage("失败任务已重新排队。"); } catch (error) { setMessage(error instanceof Error ? error.message : "重试失败"); } finally { setBusy(false); } }} type="button">{run.retryCount >= 2 ? "重试次数已用完" : "恢复并重试"}</button></div></div>;
  return <>
    {!webPaymentEnabled ? <p className="privacy-note">{webPaymentNotice}</p> : null}
    <section className="ai-task-meta"><span>{humanMode ? "「如果我是人」不支持重抽" : `重抽剩余：${run.rerollRemaining}`}</span></section>
    <div className="ai-candidate-grid">{run.candidates.map((candidate, index) => <button aria-pressed={run.selectedId === candidate.id} className={run.selectedId === candidate.id ? "ai-candidate selected" : "ai-candidate"} disabled={busy || Boolean(run.order) && run.selectedId !== candidate.id} key={candidate.id} onClick={() => select(candidate.id)} type="button"><span className="candidate-number">0{index + 1}</span><span className="candidate-image"><Image alt={`第 ${index + 1} 张`} fill sizes="240px" src={`/api/ai-runs/${runId}/candidates/${encodeURIComponent(candidate.id)}`} unoptimized /><span className="ai-mask">{run.aiNotice}</span></span><b>{run.selectedId === candidate.id ? "已选中并归档" : "选择这一张"}</b><small>{run.selectedUnlocked && run.selectedId === candidate.id ? "高清原图已保存" : "预览"}</small></button>)}</div>
    <div className="button-row"><button className="primary-button" disabled={!webPaymentEnabled || busy || !run.selectedId || run.selectedUnlocked} onClick={unlock} type="button">{run.order?.status === "pending" ? "继续支付" : "保存高清原图"}</button>{!humanMode ? <><select aria-label="重抽原因" disabled={busy || !run.rerollRemaining || Boolean(run.order)} onChange={(event) => setRerollReason(event.target.value as typeof rerollReason)} value={rerollReason}>{run.roleInputs.subjectMode === "owner-pet" ? <option value="owner-not-like">主人不像</option> : null}<option value="pet-not-like">宠物不像</option><option value="composition">构图偏离</option></select><button className="secondary-button" disabled={busy || !run.rerollRemaining || Boolean(run.order)} onClick={() => mutate(`/api/ai-runs/${runId}/reroll`, { reason: rerollReason }, "已重新排队，拍好后自动替换。")} type="button">重拍一张（剩 {run.rerollRemaining}）</button></> : null}</div>
    {run.selectedUnlocked && run.workId ? <div className="button-row"><AiDisclosureLink aiGenerated className="primary-button" href={`/api/works/${run.workId}/download?format=image`}>下载高清原图</AiDisclosureLink><button className="secondary-button" disabled={busy} onClick={share} type="button">创建 7 天分享</button><a className="secondary-button" href={`/works/${run.workId}`}>查看作品档案</a>{sharePath ? <a className="secondary-button" href={sharePath}>打开分享页</a> : null}</div> : null}
    {message ? <div className="error-banner" role="status">{message}</div> : null}
  </>;
}
