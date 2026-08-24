import Link from "next/link";
import { InteractiveGuestClient } from "@/components/interactive-guest-client";
import { AppError } from "@/server/errors";
import { getPublicInteractiveSession } from "@/server/growth-service";

export const dynamic = "force-dynamic";
export default async function InteractiveSharePage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ source?: string }> }) {
  const { token } = await params; const query = await searchParams;
  let session; let expired = false;
  try { session = await getPublicInteractiveSession(token); }
  catch (error) { expired = error instanceof AppError && error.status === 410; }
  if (!session) return <main className="share-screen"><section className="empty-state"><div><b>{expired ? "这份互动分享已经失效" : "没有找到这份互动页"}</b><p>{expired ? "主人已撤销分享或有效期已经结束。" : "链接可能不完整。"}</p><Link className="primary-button" href="/">返回宠物造物局</Link></div></section></main>;
  return <main className="share-screen interactive-share-screen"><header className="share-intro"><span>PETBABY INTERACTIVE</span><h1>{String(session.snapshot.title || "一页会回应的回忆")}</h1></header><InteractiveGuestClient session={session} source={query.source || "share"} token={token} /><Link className="primary-button share-cta" href="/interactive/create">给我的宠物也做一页</Link></main>;
}
