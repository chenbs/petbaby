import Link from "next/link";
import { InteractiveStudioClient } from "@/components/interactive-studio-client";
export default async function InteractivePage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main className="screen"><div className="page-heading"><Link className="back-link" href="/interactive/create">← 新建互动页</Link><span className="eyebrow">INTERACTIVE STUDIO</span><h1>互动场景编辑器</h1><p>实时预览、公开分享、撤销和服务端导出都在这里完成。</p></div><InteractiveStudioClient sessionId={id} /></main>; }
