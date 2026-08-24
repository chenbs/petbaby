"use client";

import Image from "next/image";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";

import { WorkPreview } from "@/components/work-preview";
import type { GenerationTask, Order, Pet, Photo, PluginManifest, PublicWork } from "@/domain/models";
import { apiFetch, apiUploadWithProgress } from "@/lib/api";
import { clearCreateDraft, compressImage, loadCreateDraft, saveCreateDraft } from "@/lib/create-draft";

type Stage = "profile" | "photos" | "generating" | "preview";
type SelectedPhoto = { file: File; dataUrl: string };
type TaskResponse = GenerationTask & { work?: PublicWork };
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

/**
 * 档位说明文案。**按「你可以做什么」而不是「你不足以做什么」**（L3 的措辞要求）。
 *
 * 所以是「再攒 11 张可做进阶版 ¥39.9」而不是「照片不足 21 张，无法制作进阶版」——
 * 前者是邀请，后者是拒绝，而用户此刻正打算给自己的宠物做点东西。
 */
function nextTierCopy(pricing: DeliveryPricing): string | undefined {
  const next = pricing.nextTier;
  if (!next) return undefined;
  const price = pricing.tierPrices?.[next.tier];
  const target = `${TIER_NAME[next.tier]}版${price ? ` ¥${price}` : ""}`;
  if (next.tier === "advanced" && next.photosNeeded) return `再攒 ${next.photosNeeded} 张照片，就能做${target}。`;
  if (next.daysNeeded) return `照片跨度再满 ${next.daysNeeded} 天，就能做${target}。`;
  return undefined;
}


function fileToDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("照片读取失败，请重新选择"));
    reader.readAsDataURL(file);
  });
}

export function CreateFlow({ plugin }: { plugin: PluginManifest }) {
  const searchParams = useSearchParams();
  const sourceWorkId = searchParams.get("sourceWorkId") || undefined;
  const sourcePetId = searchParams.get("petId") || undefined;
  const [stage, setStage] = useState<Stage>("profile");
  const [pets, setPets] = useState<Pet[]>([]);
  const [pet, setPet] = useState<Pet>();
  const [photos, setPhotos] = useState<SelectedPhoto[]>([]);
  const [existingPhotos, setExistingPhotos] = useState<Photo[]>([]);
  const [selectedExistingIds, setSelectedExistingIds] = useState<string[]>([]);
  const [task, setTask] = useState<TaskResponse>();
  const [work, setWork] = useState<PublicWork>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sharePath, setSharePath] = useState("");
  const [style, setStyle] = useState("classic");
  const [composition, setComposition] = useState("portrait");
  const [review, setReview] = useState("");
  const [documentType, setDocumentType] = useState("identity");
  const [theme, setTheme] = useState("growth");
  const [coverTitle, setCoverTitle] = useState("");
  const [pageCaptions, setPageCaptions] = useState("");
  const [uploadProgress, setUploadProgress] = useState(0);
  /*
   * 档位与价格在**制作前**取（改造项 L3）。17 号文 3.5 自己的判据是
   * 「档位必须在制作前可见，不能生成完才告价 —— 那是诱导」。
   *
   * 与下单走同一个 resolveOrderPricing（服务端 getDeliveryPricing），
   * 端上不自己算档 —— 展示价与实收价由两份代码算出来必然走散。
   */
  const [pricing, setPricing] = useState<DeliveryPricing>();
  const uploadAbort = useRef<AbortController | null>(null);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTracked = useRef(false);

  useEffect(() => {
    apiFetch<Pet[]>("/api/pets").then((items) => {
      setPets(items);
      const selected = sourcePetId ? items.find((item) => item.id === sourcePetId) : undefined;
      if (selected) {
        setPet(selected);
        setStage("photos");
        return;
      }
      loadCreateDraft(plugin.id).then(async (draft) => {
        if (!draft) return;
        const draftPet = items.find((item) => item.id === draft.petId);
        if (!draftPet) return;
        setPet(draftPet);
        setSelectedExistingIds(draft.existingPhotoIds);
        setStyle(draft.options.style || "classic");
        setComposition(draft.options.composition || "portrait");
        setReview(draft.options.review || "");
        setDocumentType(draft.options.documentType || "identity");
        setTheme(draft.options.theme || "growth");
        setCoverTitle(draft.options.coverTitle || "");
        setPageCaptions(draft.options.pageCaptions || "");
        setPhotos(await Promise.all(draft.files.map(async (file) => ({ file, dataUrl: await fileToDataUrl(file) }))));
        setStage("photos");
      }).catch(() => undefined);
    }).catch(() => setPets([]));
  }, [plugin.id, sourcePetId]);

  useEffect(() => {
    if (!pet || stage !== "photos") return;
    apiFetch<Photo[]>(`/api/photos?petId=${pet.id}`).then(setExistingPhotos).catch(() => setExistingPhotos([]));
  }, [pet, stage]);

  /*
   * 定价随宠物变，不随本次选了几张照片变 —— 分档看的是这只宠物的**积累总量**
   * （measureAccumulation 数的是全部未删照片），不是本次交付物用了几张。
   * 挂在选照片阶段拉一次即可，不必跟着勾选状态重算。
   */
  useEffect(() => {
    if (!pet || stage !== "photos") { return; }
    apiFetch<DeliveryPricing>(`/api/pets/${pet.id}/pricing?pluginId=${encodeURIComponent(plugin.id)}`).then(setPricing).catch(() => setPricing(undefined));
  }, [pet, plugin.id, stage]);

  useEffect(() => {
    if (!pet || stage !== "photos") return;
    saveCreateDraft({
      pluginId: plugin.id,
      petId: pet.id,
      existingPhotoIds: selectedExistingIds,
      files: photos.map((photo) => photo.file),
      options: { style, composition, review, documentType, theme, coverTitle, pageCaptions },
    }).catch(() => undefined);
  }, [composition, coverTitle, documentType, pageCaptions, pet, photos, plugin.id, review, selectedExistingIds, stage, style, theme]);

  useEffect(() => {
    if (stage !== "generating" || !task?.id) return;
    const poll = async () => {
      try {
        const next = await apiFetch<TaskResponse>(`/api/generations/${task.id}`);
        setTask(next);
        if (next.status === "succeeded" && next.work) {
          setWork(next.work);
          setStage("preview");
          return;
        }
        if (next.status === "failed") {
          setError("生成没有完成，免费次数已返还，请重新尝试。");
          setStage("photos");
          return;
        }
        pollTimer.current = setTimeout(poll, 800);
      } catch (pollError) {
        setError(pollError instanceof Error ? pollError.message : "查询进度失败");
        setStage("photos");
      }
    };
    pollTimer.current = setTimeout(poll, 600);
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [stage, task?.id]);

  useEffect(() => {
    if (stage !== "preview" || !work || previewTracked.current) return;
    previewTracked.current = true;
    apiFetch("/api/events", { method: "POST", body: JSON.stringify({ name: "previewed", pluginId: plugin.id, channel: "web" }) }).catch(() => undefined);
  }, [plugin.id, stage, work]);

  async function submitPet(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    try {
      const created = await apiFetch<Pet>("/api/pets", {
        method: "POST",
        body: JSON.stringify({
          name: form.get("name"),
          species: form.get("species"),
          gender: form.get("gender"),
          birthday: form.get("birthday"),
          dateType: form.get("dateType"),
          lifeStage: "active",
        }),
      });
      setPets((current) => [...current, created]);
      setPet(created);
      setStage("photos");
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "档案保存失败");
    } finally {
      setBusy(false);
    }
  }

  async function selectPhotos(event: ChangeEvent<HTMLInputElement>) {
    setError("");
    const available = Math.max(0, plugin.input.photos.max - selectedExistingIds.length);
    const selected = [...(event.target.files || [])].slice(0, available);
    try {
      const next = await Promise.all(selected.map(async (file) => {
        const compressed = await compressImage(file);
        if (compressed.size > 2_500_000) throw new Error(`${file.name} 压缩后仍超过 2.5MB`);
        return { file: compressed, dataUrl: await fileToDataUrl(compressed) };
      }));
      setPhotos(next);
    } catch (readError) {
      setError(readError instanceof Error ? readError.message : "照片处理失败");
    }
  }

  function toggleExistingPhoto(id: string) {
    setSelectedExistingIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : current.length + photos.length < plugin.input.photos.max ? [...current, id] : current);
  }

  async function startGeneration() {
    if (!pet) return;
    const totalPhotos = selectedExistingIds.length + photos.length;
    if (totalPhotos < plugin.input.photos.min || totalPhotos > plugin.input.photos.max) {
      setError(`请选择 ${plugin.input.photos.min}-${plugin.input.photos.max} 张照片。`);
      return;
    }
    setBusy(true);
    setError("");
    const uploadController = new AbortController();
    uploadAbort.current = uploadController;
    try {
      const uploaded: Array<{ id: string }> = [];
      for (const [index, photo] of photos.entries()) {
        const form = new FormData();
        form.set("petId", pet.id);
        form.set("filename", photo.file.name);
        form.set("file", photo.file);
        let lastError: unknown;
        for (let attempt = 0; attempt < 3; attempt += 1) {
          try {
            uploaded.push(await apiUploadWithProgress<{ id: string }>("/api/uploads", form, (percent) => {
              setUploadProgress(Math.round((index * 100 + percent) / Math.max(1, photos.length)));
            }, uploadController.signal));
            lastError = undefined;
            break;
          } catch (uploadError) {
            lastError = uploadError;
            if (uploadError instanceof DOMException && uploadError.name === "AbortError") throw uploadError;
          }
        }
        if (lastError) throw lastError;
      }
      const options = plugin.id === "pet-id-card"
        ? { documentType }
        : plugin.id === "pet-movie-poster"
          ? { style, composition, review: review || undefined }
          : plugin.id === "pet-time-album"
            ? { voice: "pet", theme, coverTitle: coverTitle || undefined, pageCaptions: pageCaptions.split("\n").map((item) => item.trim()).filter(Boolean) }
            : {};
      const created = await apiFetch<TaskResponse>("/api/generations", {
        method: "POST",
        body: JSON.stringify({
          pluginId: plugin.id,
          petId: pet.id,
          photoIds: [...selectedExistingIds, ...uploaded.map((photo) => photo.id)],
          idempotencyKey: crypto.randomUUID(),
          sourceWorkId,
          options,
        }),
      });
      setTask(created);
      setStage("generating");
      await clearCreateDraft(plugin.id);
    } catch (generationError) {
      setError(generationError instanceof Error ? generationError.message : "创建失败");
    } finally {
      setBusy(false);
      uploadAbort.current = null;
    }
  }

  async function unlock() {
    if (!work) return;
    setBusy(true);
    setError("");
    try {
      /*
       * SKU 恒为 `${pluginId}-single`。`pet-id-card-bundle`（四证套餐 19.9）
       * 已随 PL-01 转免费下线，`createOrder` 会按 SKU_INVALID 拒掉 ——
       * 端上还在按 documentType 拼那个 SKU，走到这条分支必然 422。
       */
      const order = await apiFetch<Order>("/api/orders", { method: "POST", body: JSON.stringify({ workId: work.id, sku: `${plugin.id}-single` }) });
      const result = await apiFetch<{ order: Order; work: PublicWork }>(`/api/orders/${order.id}/pay`, { method: "POST" });
      setWork(result.work);
    } catch (paymentError) {
      setError(paymentError instanceof Error ? paymentError.message : "解锁失败");
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    if (!work) return;
    setBusy(true);
    try {
      const result = await apiFetch<{ path: string }>(`/api/works/${work.id}/share`, { method: "POST" });
      setSharePath(result.path);
    } catch (shareError) {
      setError(shareError instanceof Error ? shareError.message : "分享链接创建失败");
    } finally {
      setBusy(false);
    }
  }

  const selectedCount = selectedExistingIds.length + photos.length;
  const stageNumber = { profile: 1, photos: 2, generating: 3, preview: 4 }[stage];

  return (
    <main className="screen">
      <div className="page-heading">
        <Link className="back-link" href="/">返回玩法</Link>
        <span className="eyebrow">{plugin.code} · {plugin.generator.type}</span>
        <h1>{plugin.name}</h1>
        <p>{plugin.description}</p>
      </div>
      <div className="flow-steps" aria-label={`制作进度，第 ${stageNumber} 步，共 4 步`}>
        {[1, 2, 3, 4].map((step) => <span className={step <= stageNumber ? "flow-step done" : "flow-step"} key={step} />)}
      </div>
      {error ? <div className="error-banner" role="alert">{error}</div> : null}

      {stage === "profile" ? <section className="panel">
        {pets.length ? <><span className="eyebrow">选择已有档案</span><div className="existing-pets">{pets.map((item) =>
          <button className="pet-choice" key={item.id} onClick={() => { setPet(item); setStage("photos"); }} type="button"><b>{item.name}</b><span>用这个档案</span></button>)}</div><div className="divider-label">或建立新档案</div></> : null}
        <form className="form-grid" onSubmit={submitPet}>
          <div className="field"><label htmlFor="name">它叫什么？</label><input id="name" name="name" maxLength={20} required /></div>
          <div className="field"><label htmlFor="species">物种</label><select id="species" name="species" defaultValue="cat"><option value="cat">猫咪</option><option value="dog">狗狗</option><option value="other">其他宠物</option></select></div>
          <div className="field"><label htmlFor="gender">性别</label><select id="gender" name="gender" defaultValue="unknown"><option value="unknown">暂不填写</option><option value="female">女孩子</option><option value="male">男孩子</option></select></div>
          <div className="field"><label htmlFor="dateType">日期类型</label><select id="dateType" name="dateType" defaultValue="birthday"><option value="birthday">生日</option><option value="got_home">到家日</option></select></div>
          <div className="field"><label htmlFor="birthday">日期（选填）</label><input id="birthday" name="birthday" type="date" /></div>
          <button className="primary-button" disabled={busy} type="submit">{busy ? "正在保存…" : "保存档案，选择照片"}</button>
        </form>
      </section> : null}

      {stage === "photos" ? <section className="panel">
        {plugin.id === "pet-id-card" ? <div className="field"><label htmlFor="document-type">证件 SKU</label><select id="document-type" value={documentType} onChange={(event) => setDocumentType(event.target.value)}><option value="identity">身份证</option><option value="passport">护照</option><option value="household">户口本</option><option value="vaccine">疫苗证</option><option value="bundle">四款套装</option></select></div> : null}
        {plugin.id === "pet-movie-poster" ? <><div className="field"><label htmlFor="poster-style">海报风格</label><select id="poster-style" value={style} onChange={(event) => setStyle(event.target.value)}><option value="classic">大片</option><option value="arthouse">文艺</option><option value="hongkong">港片</option></select></div><div className="field"><label htmlFor="composition">构图</label><select id="composition" value={composition} onChange={(event) => setComposition(event.target.value)}><option value="portrait">主角肖像</option><option value="closeup">面部特写</option><option value="ensemble">群像拼贴</option></select></div><div className="field"><label htmlFor="review">影评人短评（选填）</label><input id="review" value={review} maxLength={120} onChange={(event) => setReview(event.target.value)} /></div></> : null}
        {plugin.id === "pet-time-album" ? <><div className="field"><label htmlFor="album-theme">画册主题</label><select id="album-theme" value={theme} onChange={(event) => setTheme(event.target.value)}><option value="growth">成长</option><option value="birthday">生日</option><option value="healing">治愈日常</option><option value="holiday">节日</option></select></div><div className="field"><label htmlFor="cover-title">封面标题（选填）</label><input id="cover-title" value={coverTitle} maxLength={60} onChange={(event) => setCoverTitle(event.target.value)} /></div><div className="field"><label htmlFor="page-captions">逐页文案（每行一页）</label><textarea id="page-captions" value={pageCaptions} onChange={(event) => setPageCaptions(event.target.value)} /></div>{pageCaptions.trim() ? <div className="settings-list" aria-label="分页文案预览">{pageCaptions.split("\n").filter(Boolean).slice(0, plugin.input.photos.max).map((caption, index) => <div key={`${index}-${caption}`}><b>第 {index + 1} 页</b><span>{caption}</span></div>)}</div> : null}</> : null}

        {existingPhotos.length ? <><div className="section-heading"><div><span className="eyebrow">照片库</span><h2>手动选择历史照片</h2></div><span>{selectedExistingIds.length} 张</span></div><div className="photo-thumbs">{existingPhotos.map((photo) => <button className={`photo-thumb ${selectedExistingIds.includes(photo.id) ? "selected" : ""}`} key={photo.id} onClick={() => toggleExistingPhoto(photo.id)} type="button"><Image alt={photo.filename} fill sizes="96px" src={photo.url} unoptimized /><span className="sr-only">{selectedExistingIds.includes(photo.id) ? "取消选择" : "选择"}</span></button>)}</div></> : null}
        <label className="upload-drop"><input accept="image/jpeg,image/png,image/webp" multiple={plugin.input.photos.max > 1} onChange={selectPhotos} type="file" /><span className="upload-copy"><span className="upload-icon">＋</span><b>追加新照片</b><span>已选 {selectedCount}/{plugin.input.photos.max} 张，浏览器会自动压缩</span></span></label>
        {photos.length ? <div className="photo-thumbs">{photos.map((photo) => <div className="photo-thumb" key={`${photo.file.name}-${photo.file.lastModified}`}><Image alt="新选择的宠物照片" fill sizes="96px" src={photo.dataUrl} unoptimized /></div>)}</div> : null}
        {/*
          档位与价格在制作前展示（L3）。免费玩法整块不出现 ——
          给一个 ¥0 的价格区块只是噪声。
        */}
        {pricing && !pricing.free ? <section className="settings-list" aria-label="解锁价格">
          <div>
            <span><b>{pricing.tiered && pricing.specTier ? `${TIER_NAME[pricing.specTier]}版 · ${pricing.label}` : pricing.label}</b>
              {pricing.tiered && pricing.accumulation ? <small style={{ display: "block" }}>已积累 {pricing.accumulation.photoCount} 张照片，跨度 {pricing.accumulation.spanDays} 天</small> : null}
              {pricing.isMember && pricing.memberSaving > 0 ? <small style={{ display: "block" }}>会员价，比单买省 ¥{pricing.memberSaving}</small> : null}
              {!pricing.isMember && nextTierCopy(pricing) ? <small style={{ display: "block" }}>{nextTierCopy(pricing)}</small> : null}
            </span>
            <span><b>¥{pricing.amount}</b>{pricing.memberSaving > 0 ? <small style={{ display: "block", textDecoration: "line-through" }}>¥{pricing.listPrice}</small> : null}</span>
          </div>
        </section> : null}
        <button className="primary-button" disabled={busy || selectedCount < plugin.input.photos.min || selectedCount > plugin.input.photos.max} onClick={startGeneration} type="button">{busy ? "照片上传中…" : "免费生成预览"}</button>
        {busy ? <><p className="privacy-note">上传进度 {uploadProgress}%（单文件失败自动重试）</p><button className="secondary-button" onClick={() => uploadAbort.current?.abort()} type="button">取消上传</button></> : null}
        <p className="privacy-note">草稿会保存在当前浏览器；刷新页面后仍可继续。</p>
      </section> : null}

      {stage === "generating" ? <section className="panel progress-panel"><div className="progress-copy"><div className="progress-orbit"><span className="progress-number">{task?.progress || 8}%</span></div><h2>正在给灵感装订成册</h2><p>{task?.status === "queued" ? `当前排队第 ${task.queuePosition || 1} 位，预计 ${task.estimatedSeconds || 15} 秒` : "照片和文案正在排版"}</p></div></section> : null}

      {/*
        预览页的价格取 pricing.amount（分档后的实收价），不取 manifest 的
        unlockPrice —— 后者是**基础价**，分档玩法上它恒等于最低档，
        写在这里会让一个 80 张照片的用户看到 ¥19.9 却被收 ¥49。
        pricing 未取到时回落 manifest 价，好过不显示价格。
      */}
      {stage === "preview" && work ? <section><WorkPreview work={work} /><div className="preview-actions"><div className="price-line"><span>{work.locked ? (pricing && pricing.tiered && pricing.specTier ? `${TIER_NAME[pricing.specTier]}版 · ${pricing.label}` : plugin.pricing.label) : "已解锁高清版本"}</span><strong>{work.locked ? `¥${pricing && !pricing.free ? pricing.amount : plugin.pricing.unlockPrice}` : "✓"}</strong></div>{work.locked && pricing?.memberSaving ? <p className="privacy-note">会员价，比单买省 ¥{pricing.memberSaving}</p> : null}{work.locked ? <button className="primary-button" disabled={busy} onClick={unlock} type="button">{busy ? "正在解锁…" : "支付并去水印"}</button> : <div className="button-row"><Link className="secondary-button" href="/works">去作品库</Link><button className="primary-button" disabled={busy} onClick={share} type="button">生成分享页</button></div>}{sharePath ? <Link className="primary-button" href={sharePath}>打开分享页</Link> : null}</div></section> : null}
    </main>
  );
}
