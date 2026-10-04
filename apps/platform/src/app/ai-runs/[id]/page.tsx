import Link from "next/link";
import { AiResultsClient } from "@/components/ai-results-client";
export default async function AiRunPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main className="screen"><div className="page-heading"><Link className="back-link" href="/ai/create">← 返回玩法</Link><span className="eyebrow">制作结果</span><h1>为我拍的这一张</h1><p>离开也会继续做，拍好后自动进作品柜，保存高清原图时再付费。</p></div><AiResultsClient runId={id} /></main>; }
