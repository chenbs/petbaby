"use client";

import { useEffect, useRef, useState } from "react";
import { apiFetch } from "@/lib/api";

type Snapshot = { title?: unknown; copy?: unknown; theme?: unknown; stardust?: unknown };

export function InteractiveCanvas({ snapshot, photoUrl, sessionId, token, visitorKey }: { snapshot: Snapshot; photoUrl?: string; sessionId?: string; token?: string; visitorKey?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null); const [count, setCount] = useState(Number(snapshot.stardust || 0)); const [message, setMessage] = useState("点一下，让回忆多亮一颗星。");
  const title = String(snapshot.title || "每一次想念，都在这里发光"); const copy = String(snapshot.copy || "照片被轻轻放进星光里。"); const theme = String(snapshot.theme || "stardust");
  useEffect(() => {
    const canvas = canvasRef.current; const context = canvas?.getContext("2d"); if (!canvas || !context) return;
    const palette = theme === "meadow" ? ["#dff4d8", "#216844", "#fff1b7"] : theme === "sunset" ? ["#ffe1c7", "#9b4c35", "#fff6df"] : ["#0c241d", "#fff1b7", "#edf8f2"];
    context.clearRect(0, 0, canvas.width, canvas.height); const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height); gradient.addColorStop(0, palette[0]); gradient.addColorStop(1, theme === "stardust" ? "#173e52" : palette[2]); context.globalAlpha = photoUrl ? .72 : 1; context.fillStyle = gradient; context.fillRect(0, 0, canvas.width, canvas.height); context.globalAlpha = 1;
    for (let index = 0; index < 54; index += 1) { context.fillStyle = `${palette[1]}${theme === "stardust" ? "aa" : "55"}`; context.beginPath(); context.arc((index * 97) % canvas.width, (index * 59 + count * 7) % canvas.height, 1 + index % 4, 0, Math.PI * 2); context.fill(); }
    context.fillStyle = palette[1]; context.textAlign = "center";
  }, [copy, count, photoUrl, theme, title]);
  async function add() {
    const next = count + 1; setCount(next); setMessage(`已经收集 ${next} 粒星尘`);
    try {
      if (sessionId) await Promise.all([apiFetch(`/api/interactive-sessions/${sessionId}`, { method: "PATCH", body: JSON.stringify({ snapshot: { title, copy, theme, stardust: next } }) }), apiFetch(`/api/interactive-sessions/${sessionId}/events`, { method: "POST", body: JSON.stringify({ name: "stardust_collected", payload: { count: next } }) })]);
      if (token && visitorKey) await apiFetch(`/api/interactive-share/${token}`, { method: "POST", body: JSON.stringify({ name: "stardust_collected", visitorKey, source: "public-h5", payload: { count: next } }) });
    } catch (error) { setMessage(error instanceof Error ? error.message : "互动记录失败"); }
  }
  return <section className={`interactive-stage theme-${theme}`} style={photoUrl ? { backgroundImage: `linear-gradient(rgba(12,36,29,.22),rgba(12,36,29,.58)),url(${photoUrl})` } : undefined}><canvas aria-hidden="true" onClick={add} ref={canvasRef} width={720} height={960} /><div className="interactive-static-copy"><h2>{title}</h2><p>{copy}</p><b>{count} 粒星尘</b></div><div className="interactive-stage-actions"><button className="primary-button" onClick={add} type="button">收集一粒星尘</button><span>{message}</span></div></section>;
}
