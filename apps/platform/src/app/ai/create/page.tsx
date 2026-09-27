import Link from "next/link";
import { AiCreateClient } from "@/components/ai-create-client";

export default function AiCreatePage() {
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/">← 返回玩法</Link><span className="eyebrow">PL-10 · PET ART PHOTO</span><h1>宠物艺术写真</h1><p>选好场景和宠物身份照，看看它在不同画面里的神态。</p></div><AiCreateClient /></main>;
}
