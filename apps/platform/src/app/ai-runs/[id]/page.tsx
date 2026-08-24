import Link from "next/link";
import { AiResultsClient } from "@/components/ai-results-client";
export default async function AiRunPage({ params }: { params: Promise<{ id: string }> }) { const { id } = await params; return <main className="screen"><div className="page-heading"><Link className="back-link" href="/ai/create">← 返回 AI 创建</Link><span className="eyebrow">AI IMAGE · 4 SELECT 1</span><h1>选择最像它的一张</h1><p>任务会经历排队、处理、失败恢复和成功状态。只有选中的候选会归档并建立高清订单。</p></div><AiResultsClient runId={id} /></main>; }
