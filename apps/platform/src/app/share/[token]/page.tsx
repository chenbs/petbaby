import { notFound } from "next/navigation";
import Image from "next/image";

import { ShareTracker } from "@/components/share-tracker";
import { WorkPreview } from "@/components/work-preview";
import { AppError } from "@/server/errors";
import { getSharedWork } from "@/server/platform-service";

export const dynamic = "force-dynamic";

export default async function SharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ source?: string; code?: string }> }) {
  const { token } = await params;
  const query = await searchParams;
  let work;
  try { work = await getSharedWork(token, query.code); }
  catch (error) {
    if (error instanceof AppError && error.code === "SHARE_ACCESS_CODE_REQUIRED") {
      return <main className="share-screen"><section className="panel"><span className="eyebrow">PRIVATE SHARE</span><h1>这份作品需要访问码</h1><form><div className="field"><label htmlFor="code">4-8 位访问码</label><input id="code" name="code" inputMode="numeric" maxLength={8} required /></div>{query.source ? <input name="source" type="hidden" value={query.source} /> : null}<button className="primary-button" type="submit">查看作品</button></form></section></main>;
    }
    notFound();
  }
  const source = query.source || "share";
  return <main className="share-screen"><ShareTracker accessCode={query.code} source={source} token={token} /><header className="share-intro"><span>MADE WITH PETBABY</span><h1>{work.pet.name}刚刚领到一件新作品</h1></header><WorkPreview work={work} /><section className="share-pet-card"><b>主角：{work.pet.name}</b><p>这是主人主动公开的作品，宠物档案仍保持私密。</p><Image alt="分享二维码" height={144} src={`/api/share/${token}/qr${query.code ? `?code=${encodeURIComponent(query.code)}` : ""}`} unoptimized width={144} /></section><a className="primary-button share-cta" href={`/api/share/${token}/cta?source=${encodeURIComponent(source)}${query.code ? `&code=${encodeURIComponent(query.code)}` : ""}`}>给我的宠物也做一个</a></main>;
}
