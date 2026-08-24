import Link from "next/link";
import { AiCreateClient } from "@/components/ai-create-client";

export default function AiCreatePage() {
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/">← 返回玩法</Link><span className="eyebrow">PL-10 · AI PORTRAIT</span><h1>为它生成四张新肖像</h1><p>从宠物与照片开始，选择玩法、风格和提示词方向。任务、成本与 Provider 快照会保留在本次生成中。</p></div><AiCreateClient /></main>;
}
