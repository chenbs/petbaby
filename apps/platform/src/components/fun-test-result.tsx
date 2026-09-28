"use client";

import Link from "next/link";
import { useState } from "react";

export type FunTestResult = {
  id: string;
  testId: string;
  testTitle: string;
  category: string;
  cover: string;
  petName: string;
  outcomeId: string;
  shareToken: string;
  createdAt: string;
  disclaimer: string;
  outcome: {
    id: string;
    name: string;
    description: string;
    typical: string;
    bond: string;
    closing: string;
    keywords: string[];
    tip: string;
  };
};

function drawLine(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  let line = "";
  for (const character of text) {
    if (ctx.measureText(line + character).width > maxWidth && line) {
      ctx.fillText(line, x, y);
      y += lineHeight;
      line = character;
    } else line += character;
  }
  if (line) ctx.fillText(line, x, y);
  return y + lineHeight;
}

async function downloadPoster(result: FunTestResult) {
  const canvas = document.createElement("canvas");
  canvas.width = 1080;
  canvas.height = 1440;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("当前浏览器无法生成图片");
  ctx.fillStyle = "#edf8f2";
  ctx.fillRect(0, 0, 1080, 1440);
  const photo = new Image();
  photo.src = `/fun-tests/${result.cover}.jpg`;
  await new Promise<void>((resolve, reject) => { photo.onload = () => resolve(); photo.onerror = () => reject(new Error("封面载入失败")); });
  const side = Math.min(photo.width, photo.height);
  ctx.drawImage(photo, (photo.width - side) / 2, (photo.height - side) / 2, side, side, 0, 0, 1080, 500);
  ctx.fillStyle = "rgba(20, 37, 28, .50)";
  ctx.fillRect(0, 0, 1080, 500);
  ctx.fillStyle = "#fffef9";
  ctx.font = "600 38px sans-serif";
  ctx.fillText("麻麻抱我 · 宠物趣味测试", 76, 92);
  ctx.font = "800 72px sans-serif";
  drawLine(ctx, result.petName + "的测试结果", 76, 332, 930, 84);
  ctx.fillStyle = "#f6c949";
  ctx.fillRect(76, 550, 96, 12);
  ctx.fillStyle = "#53645b";
  ctx.font = "500 34px sans-serif";
  ctx.fillText(result.testTitle, 76, 620);
  ctx.fillStyle = "#14251c";
  ctx.font = "800 94px sans-serif";
  let y = drawLine(ctx, result.outcome.name, 76, 760, 930, 106);
  ctx.font = "42px sans-serif";
  y = drawLine(ctx, result.outcome.description, 76, y + 42, 920, 64);
  ctx.font = "38px sans-serif";
  ctx.fillStyle = "#216844";
  y = drawLine(ctx, result.outcome.closing, 76, y + 38, 920, 56);
  ctx.fillStyle = "#53645b";
  ctx.font = "32px sans-serif";
  ctx.fillText(result.outcome.keywords.map((word) => `#${word}`).join("   "), 76, Math.min(y + 48, 1225));
  ctx.fillStyle = "#14251c";
  ctx.fillRect(76, 1280, 928, 2);
  ctx.font = "28px sans-serif";
  ctx.fillText("这是一份轻松的娱乐测试 · 来测测你的宠物", 76, 1338);
  ctx.fillStyle = "#53645b";
  ctx.fillText("麻麻抱我  /  petbaby", 76, 1390);
  const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("图片生成失败")), "image/png"));
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${result.petName}-${result.outcome.name}.png`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function FunTestResultView({ result, onRetry, onDelete }: { result: FunTestResult; onRetry?: () => void; onDelete?: () => void }) {
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const shareUrl = typeof window === "undefined" ? "" : `${window.location.origin}/fun-tests/share/${result.shareToken}`;

  async function share() {
    try {
      if (navigator.share) await navigator.share({ title: `${result.petName}是${result.outcome.name}`, text: result.outcome.description, url: shareUrl });
      else { await navigator.clipboard.writeText(shareUrl); setMessage("分享链接已复制"); }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("分享未完成，可使用下方复制链接");
    }
  }

  async function copy() {
    try { await navigator.clipboard.writeText(shareUrl); setMessage("分享链接已复制"); }
    catch { setMessage("复制失败，请打开分享页后使用浏览器分享"); }
  }

  async function save() {
    setBusy(true);
    try { await downloadPoster(result); setMessage("结果海报已保存"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "海报生成失败"); }
    finally { setBusy(false); }
  }

  return <div className={`ft-result ft-theme-${result.cover}`}>
    <div className="ft-result-reveal" aria-hidden="true">RESULT REVEAL <span>✳</span> 结果揭晓</div>
    <section className="ft-result-sheet" aria-labelledby="ft-result-name">
      <div className="ft-sheet-top"><span>麻麻抱我 / 趣味测试</span><span>01 / 01</span></div>
      <p className="ft-result-kicker">{result.petName} · {result.testTitle}</p>
      <h1 id="ft-result-name">{result.outcome.name}</h1>
      <p className="ft-result-lead">{result.outcome.description}</p>
      <div className="ft-keywords">{result.outcome.keywords.map((word) => <span key={word}>#{word}</span>)}</div>
      <div className="ft-result-details">
        <div><span>日常名场面</span><p>{result.outcome.typical}</p></div>
        <div><span>你们之间</span><p>{result.outcome.bond}</p></div>
        <div><span>今日小纸条</span><p>{result.outcome.tip}</p></div>
      </div>
      <p className="ft-result-closing">{result.outcome.closing}</p>
      <p className="ft-disclaimer">{result.disclaimer}</p>
    </section>
    <div className="ft-actions">
      <button className="ft-primary" type="button" onClick={share}>分享结果</button>
      <button className="ft-secondary" type="button" onClick={save} disabled={busy}>{busy ? "生成中…" : "保存海报"}</button>
      <button className="ft-text-button" type="button" onClick={copy}>复制链接</button>
    </div>
    {message ? <p className="ft-message" role="status">{message}</p> : null}
    <div className="ft-after-result">
      {onRetry ? <button type="button" onClick={onRetry}>再测一次</button> : <Link href="/fun-tests">给我的宠物也测测</Link>}
      {onDelete ? <button className="ft-delete" type="button" onClick={onDelete}>删除这份结果</button> : null}
    </div>
  </div>;
}
