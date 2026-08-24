"use client";
import Image from "next/image";
import { useEffect, useState } from "react";
import { apiFetch } from "@/lib/api";
import type { AiRun } from "@/domain/models";

export function AiResultsClient({ runId }: { runId: string }) {
  const [run, setRun] = useState<AiRun>(); const [message, setMessage] = useState(""); const [busy, setBusy] = useState(false); const [sharePath, setSharePath] = useState(""); const [rerollReason, setRerollReason] = useState<"owner-not-like" | "pet-not-like" | "too-animal" | "composition">("composition");
  async function load() { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`); setRun(next); return next; }
  useEffect(() => { let timer: ReturnType<typeof setTimeout>; let active = true; const poll = async () => { try { const next = await load(); if (active && ["queued", "processing"].includes(next.status)) timer = setTimeout(poll, 1600); } catch (error) { if (active) setMessage(error instanceof Error ? error.message : "任务加载失败"); } }; poll(); return () => { active = false; clearTimeout(timer); }; }, [runId]); // eslint-disable-line react-hooks/exhaustive-deps
  async function mutate(path: string, body: Record<string, unknown>, success: string, method = "POST") { setBusy(true); try { const next = await apiFetch<AiRun>(path, { method, body: JSON.stringify(body) }); setRun(next); setMessage(success); } catch (error) { setMessage(error instanceof Error ? error.message : "操作失败"); } finally { setBusy(false); } }
  async function select(candidateId: string) { setBusy(true); try { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`, { method: "PATCH", body: JSON.stringify({ action: "select", candidateId }) }); setRun(next); setMessage("这一张已归档到作品库，订单只对应这个候选结果。"); } catch (error) { setMessage(error instanceof Error ? error.message : "选择失败"); } finally { setBusy(false); } }
  async function unlock() {
    setBusy(true);
    try {
      const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}/unlock`, { method: "POST", body: "{}" }); setRun(next);
      if (!next.order) throw new Error("订单创建失败");
      const prepared = await apiFetch<{ clientParams: Record<string, string> }>(`/api/orders/${next.order.id}/prepare`, { method: "POST", body: "{}" });
      if (prepared.clientParams.mode === "development") await apiFetch(`/api/orders/${next.order.id}/pay`, { method: "POST", body: "{}" });
      else {
        const bridge = (window as Window & { WeixinJSBridge?: { invoke(name: string, params: Record<string, string>, callback: (result: { err_msg?: string }) => void): void } }).WeixinJSBridge;
        if (!bridge) { setMessage("订单已建立。请在微信内打开本页完成支付，或前往小程序继续。"); return; }
        await new Promise<void>((resolve, reject) => bridge.invoke("getBrandWCPayRequest", prepared.clientParams, (result) => result.err_msg?.includes(":ok") ? resolve() : reject(new Error("支付未完成"))));
      }
      const paid = await load(); setMessage(paid.selectedUnlocked ? "支付成功，高清文件与作品权益已生效。" : "支付结果确认中，请稍后刷新。");
    } catch (error) { setMessage(error instanceof Error ? error.message : "支付准备失败"); } finally { setBusy(false); }
  }
  async function share() { if (!run?.workId) return; setBusy(true); try { const result = await apiFetch<{ path: string }>(`/api/works/${run.workId}/share`, { method: "POST", body: JSON.stringify({ expiresInHours: 168 }) }); setSharePath(result.path); setMessage("作品分享已开启，有效期 7 天。"); } catch (error) { setMessage(error instanceof Error ? error.message : "分享创建失败"); } finally { setBusy(false); } }
  if (!run) return <div className="empty-state"><b>正在读取任务状态…</b></div>;
  const humanMode = run.roleInputs.subjectMode === "pet-human";
  if (["queued", "processing"].includes(run.status)) return <section className="panel task-state-card"><div className="progress-orbit"><span className="progress-number">{run.status === "queued" ? run.queuePosition || 1 : run.attempt}</span></div><div className="progress-copy"><span className="eyebrow">{run.status === "queued" ? "QUEUE" : "PROCESSING"}</span><h2>{run.status === "queued" ? "正在排队" : `正在生成${humanMode ? "两张" : "四张"}候选`}</h2><p>{run.status === "queued" ? `前方约 ${Math.max(0, (run.queuePosition || 1) - 1)} 个任务，预计 ${run.estimatedSeconds || 20} 秒` : `第 ${run.attempt} 次处理，Provider 与模型快照会随结果保存。`}</p></div><button className="secondary-button" disabled={busy} onClick={() => mutate(`/api/ai-runs/${runId}`, { action: "cancel" }, "任务已取消。", "PATCH")} type="button">取消任务</button></section>;
  if (run.status === "cancelled") return <div className="empty-state"><div><b>任务已经取消</b><p>没有产生订单或权益扣减。</p><a className="primary-button" href="/ai/create">重新创建</a></div></div>;
  if (run.status === "failed") return <div className="empty-state"><div><b>这次生成没有完成</b><p>{run.errorCode || "Provider 暂不可用"} · 已尝试 {run.attempt} 次</p><button className="primary-button" disabled={busy || run.retryCount >= 2} onClick={async () => { setBusy(true); try { const next = await apiFetch<AiRun>(`/api/ai-runs/${runId}`, { method: "PATCH", body: JSON.stringify({ action: "retry" }) }); setRun(next); setMessage("失败任务已重新排队。"); } catch (error) { setMessage(error instanceof Error ? error.message : "重试失败"); } finally { setBusy(false); } }} type="button">{run.retryCount >= 2 ? "重试次数已用完" : "恢复并重试"}</button></div></div>;
  return <>
    <section className="ai-task-meta"><span>Provider：{run.provider || "待确认"}</span><span>模型：{run.modelVersion || "默认"}</span><span>{humanMode ? "本次生成不支持重抽" : `重抽剩余：${run.rerollRemaining}`}</span></section>
    <div className="ai-candidate-grid">{run.candidates.map((candidate, index) => <button aria-pressed={run.selectedId === candidate.id} className={run.selectedId === candidate.id ? "ai-candidate selected" : "ai-candidate"} disabled={busy || Boolean(run.order) && run.selectedId !== candidate.id} key={candidate.id} onClick={() => select(candidate.id)} type="button"><span className="candidate-number">0{index + 1}</span><span className="candidate-image"><Image alt={`AI 候选 ${index + 1}`} fill sizes="240px" src={`/api/ai-runs/${runId}/candidates/${encodeURIComponent(candidate.id)}`} unoptimized /></span><b>{run.selectedId === candidate.id ? "已选中并归档" : "选择这一张"}</b><small>{run.selectedUnlocked && run.selectedId === candidate.id ? "高清权益已生效" : "带水印 AI 预览"}</small></button>)}</div>
    <div className="button-row"><button className="primary-button" disabled={busy || !run.selectedId || run.selectedUnlocked} onClick={unlock} type="button">{run.order?.status === "pending" ? "继续支付解锁" : "支付解锁选中结果"}</button>{!humanMode ? <><select aria-label="重抽原因" disabled={busy || !run.rerollRemaining || Boolean(run.workId)} onChange={(event) => setRerollReason(event.target.value as typeof rerollReason)} value={rerollReason}>{run.roleInputs.subjectMode === "owner-pet" ? <option value="owner-not-like">主人不像</option> : null}<option value="pet-not-like">宠物不像</option><option value="composition">构图偏离</option></select><button className="secondary-button" disabled={busy || !run.rerollRemaining || Boolean(run.workId)} onClick={() => mutate(`/api/ai-runs/${runId}/reroll`, { reason: rerollReason }, "新一组候选已进入队列。")} type="button">重抽一组（剩 {run.rerollRemaining}）</button></> : null}</div>
    {run.selectedUnlocked && run.workId ? <div className="button-row"><a className="primary-button" href={`/api/works/${run.workId}/download?format=image`}>下载高清图</a><button className="secondary-button" disabled={busy} onClick={share} type="button">创建 7 天分享</button><a className="secondary-button" href={`/works/${run.workId}`}>查看作品档案</a>{sharePath ? <a className="secondary-button" href={sharePath}>打开分享页</a> : null}</div> : null}
    {message ? <div className="error-banner" role="status">{message}</div> : null}
  </>;
}
