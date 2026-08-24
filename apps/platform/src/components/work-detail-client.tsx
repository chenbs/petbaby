"use client";

import Link from "next/link";
import { useState } from "react";
import { useEffect } from "react";

import type { PublicWork } from "@/domain/models";
import { WorkPreview } from "@/components/work-preview";
import { apiFetch } from "@/lib/api";

/** `GET /api/pets/[id]/pricing` 的返回形状。服务端在 platform-service.getDeliveryPricing */
type DeliveryPricing = {
  free: boolean;
  tiered: boolean;
  isMember: boolean;
  accumulation?: { photoCount: number; spanDays: number };
  specTier?: "basic" | "advanced" | "annual";
  amount: number;
  listPrice: number;
  memberSaving: number;
  label: string;
  nextTier?: { tier: "advanced" | "annual"; photosNeeded?: number; daysNeeded?: number };
  tierPrices?: { basic?: number; advanced?: number; annual?: number };
};

const TIER_NAME: Record<string, string> = { basic: "基础", advanced: "进阶", annual: "年度" };

/** 「你可以做什么」而不是「你不足以做什么」—— L3 的措辞要求，同 create-flow。 */
function nextTierCopy(pricing: DeliveryPricing): string | undefined {
  const next = pricing.nextTier;
  if (!next) return undefined;
  const price = pricing.tierPrices?.[next.tier];
  const target = `${TIER_NAME[next.tier]}版${price ? ` ¥${price}` : ""}`;
  if (next.tier === "advanced" && next.photosNeeded) return `再攒 ${next.photosNeeded} 张照片，下次可做${target}。`;
  if (next.daysNeeded) return `照片跨度再满 ${next.daysNeeded} 天，下次可做${target}。`;
  return undefined;
}

export function WorkDetailClient({ initialWork }: { initialWork: PublicWork }) {
  const [work, setWork] = useState(initialWork);
  const [title, setTitle] = useState(work.title);
  const [subtitle, setSubtitle] = useState(work.subtitle);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [shareCode, setShareCode] = useState("");
  const [shareHours, setShareHours] = useState("168");
  const [versions, setVersions] = useState<Array<{ id: string; version: number; title: string; created_at: string }>>([]);
  /*
   * 解锁价在**点解锁之前**就要看得见（改造项 L3）。原先这一页
   * 没有任何价格文案，用户点「支付」才知道要花多少 —— 分档玩法下
   * 这个数字还会因积累量在 19.9 到 49 之间变动。
   */
  const [pricing, setPricing] = useState<DeliveryPricing>();
  const remakePath = work.plugin.category === "ai-image" ? "/ai/create" : work.plugin.category === "interactive" ? "/interactive/create" : `/create/${work.pluginId}?sourceWorkId=${work.id}&petId=${work.petId}`;
  const reloadVersions = () => apiFetch<Array<{ id: string; version: number; title: string; created_at: string }>>(`/api/works/${work.id}/versions`).then(setVersions).catch(() => undefined);
  useEffect(() => { reloadVersions(); }, [work.id]); // eslint-disable-line react-hooks/exhaustive-deps
  /*
   * 已解锁的作品不查价 —— 那个数字对它没有意义了。
   *
   * 「已解锁就清空」不在 effect 里同步 setState（会触发级联渲染），
   * 而是在渲染时用 `work.locked` 一起判断：解锁后价格块本来就不渲染，
   * 状态里留着上一次的值也没人读。
   */
  useEffect(() => {
    if (!work.locked) return;
    apiFetch<DeliveryPricing>(`/api/pets/${work.petId}/pricing?pluginId=${encodeURIComponent(work.pluginId)}`).then(setPricing).catch(() => undefined);
  }, [work.locked, work.petId, work.pluginId]);

  async function save() {
    setBusy(true); setMessage("");
    try { const updated = await apiFetch<PublicWork>(`/api/works/${work.id}`, { method: "PATCH", body: JSON.stringify({ title, subtitle }) }); setWork(updated); setMessage("文案已保存"); await reloadVersions(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "保存失败"); }
    finally { setBusy(false); }
  }

  async function share(resetToken = false) {
    setBusy(true);
    try { const result = await apiFetch<{ path: string; expiresAt: string }>(`/api/works/${work.id}/share`, { method: "POST", body: JSON.stringify({ accessCode: shareCode || undefined, expiresInHours: Number(shareHours), resetToken }) }); setMessage(`分享页已创建：${result.path}，有效至 ${new Date(result.expiresAt).toLocaleString("zh-CN")}`); setWork({ ...work, public: true }); }
    catch (error) { setMessage(error instanceof Error ? error.message : "分享失败"); }
    finally { setBusy(false); }
  }

  async function revoke() {
    setBusy(true);
    try { await apiFetch(`/api/works/${work.id}/revoke-share`, { method: "POST" }); setWork({ ...work, public: false, shareToken: undefined }); setMessage("分享已经关闭"); }
    catch (error) { setMessage(error instanceof Error ? error.message : "关闭失败"); }
    finally { setBusy(false); }
  }

  async function copy() {
    setBusy(true);
    try { const duplicated = await apiFetch<PublicWork>(`/api/works/${work.id}/copy`, { method: "POST" }); setMessage(`副本已创建：${duplicated.title}`); }
    catch (error) { setMessage(error instanceof Error ? error.message : "复制失败"); }
    finally { setBusy(false); }
  }

  async function remove() {
    setBusy(true);
    try { await apiFetch(`/api/works/${work.id}`, { method: "DELETE" }); window.location.href = "/works"; }
    catch (error) { setMessage(error instanceof Error ? error.message : "删除失败"); setBusy(false); }
  }

  /*
   * 解锁。原先这一页只有「未解锁时隐藏下载按钮」，没有解锁入口 ——
   * 用户从作品柜进来的话唯一出路是回制作页重做一遍。
   * 展示了价格就该能付，否则那个价格只是在提醒他买不了。
   */
  async function unlock() {
    setBusy(true); setMessage("");
    try {
      const order = await apiFetch<{ id: string }>("/api/orders", { method: "POST", body: JSON.stringify({ workId: work.id, sku: `${work.pluginId}-single` }) });
      const result = await apiFetch<{ work: PublicWork }>(`/api/orders/${order.id}/pay`, { method: "POST" });
      setWork(result.work);
      setMessage("已解锁高清无水印版本");
    } catch (error) { setMessage(error instanceof Error ? error.message : "解锁失败"); }
    finally { setBusy(false); }
  }

  async function restore(versionId: string) {
    setBusy(true);
    try {
      const restored = await apiFetch<PublicWork>(`/api/works/${work.id}/versions`, { method: "POST", body: JSON.stringify({ versionId }) });
      setWork(restored);
      setTitle(restored.title);
      setSubtitle(restored.subtitle);
      setMessage("历史版本已恢复为最新版本");
      await reloadVersions();
    } catch (error) { setMessage(error instanceof Error ? error.message : "版本恢复失败"); }
    finally { setBusy(false); }
  }

  return (
    <>
      <WorkPreview work={work} />
      {/*
        解锁价与档位（L3）。免费玩法不出现这一块 ——
        它们以 locked=false 入库，本来也走不到这里。
      */}
      {work.locked && pricing && !pricing.free ? <section className="panel" style={{ marginTop: 20 }}>
        <div className="price-line">
          <span>{pricing.tiered && pricing.specTier ? `${TIER_NAME[pricing.specTier]}版 · ${pricing.label}` : pricing.label}</span>
          <strong>¥{pricing.amount}{pricing.memberSaving > 0 ? <small style={{ marginLeft: 8, textDecoration: "line-through", fontWeight: 400 }}>¥{pricing.listPrice}</small> : null}</strong>
        </div>
        {pricing.tiered && pricing.accumulation ? <p className="privacy-note">已积累 {pricing.accumulation.photoCount} 张照片，跨度 {pricing.accumulation.spanDays} 天。</p> : null}
        {pricing.isMember && pricing.memberSaving > 0 ? <p className="privacy-note">会员价，比单买省 ¥{pricing.memberSaving}。</p> : null}
        {!pricing.isMember && nextTierCopy(pricing) ? <p className="privacy-note">{nextTierCopy(pricing)}</p> : null}
        <button className="primary-button" disabled={busy} onClick={unlock} type="button">{busy ? "正在解锁…" : `支付 ¥${pricing.amount} 解锁高清无水印`}</button>
      </section> : null}
      {versions.length > 1 ? <section className="panel" style={{ marginTop: 20 }}><b>历史版本</b><div className="button-row" style={{ marginTop: 12 }}>{versions.map((version) => <button className={version.version === work.version ? "primary-button" : "secondary-button"} disabled={busy || version.version === work.version} key={version.id} onClick={() => restore(version.id)} type="button">v{version.version} · {version.title}</button>)}</div></section> : null}
      <section className="panel" style={{ marginTop: 26 }}>
        <div className="form-grid">
          <div className="field"><label htmlFor="work-title">作品标题</label><input id="work-title" value={title} onChange={(event) => setTitle(event.target.value)} /></div>
          <div className="field"><label htmlFor="work-subtitle">作品文案</label><input id="work-subtitle" value={subtitle} onChange={(event) => setSubtitle(event.target.value)} /></div>
          <button className="secondary-button" disabled={busy} onClick={save} type="button">保存文案</button>
        </div>
      </section>
      <div className="button-row">
        <Link className="secondary-button" href={remakePath}>换照片重新生成</Link>
        {work.public ? <button className="primary-button" disabled={busy} onClick={revoke} type="button">关闭分享</button> : <button className="primary-button" disabled={busy} onClick={() => share(false)} type="button">创建分享页</button>}
      </div>
      <section className="panel"><div className="form-grid"><div className="field"><label htmlFor="share-code">访问码（选填，4-8 位数字）</label><input id="share-code" inputMode="numeric" maxLength={8} value={shareCode} onChange={(event) => setShareCode(event.target.value.replace(/\D/g, ""))} /></div><div className="field"><label htmlFor="share-hours">有效期</label><select id="share-hours" value={shareHours} onChange={(event) => setShareHours(event.target.value)}><option value="24">1 天</option><option value="168">7 天</option><option value="720">30 天</option><option value="8760">1 年</option></select></div>{work.public ? <button className="secondary-button" disabled={busy || Boolean(shareCode) && shareCode.length < 4} onClick={() => share(true)} type="button">重置分享令牌与设置</button> : null}</div></section>
      {!work.locked ? <div className="button-row"><a className="secondary-button" href={`/api/works/${work.id}/download?format=${work.assetKind === "video" ? "video" : "image"}`}>{work.assetKind === "video" ? "下载 MP4" : "下载高清图"}</a>{work.plugin.output.formats.includes("pdf") ? <a className="primary-button" href={`/api/works/${work.id}/download?format=pdf`}>下载 PDF</a> : null}</div> : null}
      <div className="button-row"><button className="secondary-button" disabled={busy} onClick={copy} type="button">复制作品</button><button className="secondary-button" disabled={busy} onClick={remove} type="button">删除作品</button></div>
      {message ? <div className="error-banner" role="status">{message}</div> : null}
    </>
  );
}
