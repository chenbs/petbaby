import Link from "next/link";
import { notFound } from "next/navigation";

import { WorkDetailClient } from "@/components/work-detail-client";
import { requireUserId } from "@/server/auth/session";
import { getWork } from "@/server/platform-service";

export const dynamic = "force-dynamic";

export default async function WorkPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let work;
  try { work = await getWork(await requireUserId(), id); } catch { notFound(); }
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/works">← 返回作品柜</Link><span className="eyebrow">WORK · V{work.version}</span><h1>{work.title}</h1><p>修改文案、重新生成、下载或管理分享状态。</p></div><WorkDetailClient initialWork={work} /></main>;
}
