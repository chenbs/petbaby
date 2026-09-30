import Link from "next/link";
import { AiCreateClient } from "@/components/ai-create-client";

export default async function AiCreatePage({ searchParams }: { searchParams: Promise<{ entryId?: string }> }) {
  const { entryId } = await searchParams;
  const human = entryId === "human";
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/">← 返回玩法</Link><span className="eyebrow">{human ? "PET HUMAN" : "PL-10 · PET ART PHOTO"}</span><h1>{human ? "人类转生计划" : "宠物艺术写真"}</h1><p>{human ? "挑一款人像造型，看看我的另一种模样。" : "选好场景和宠物身份照，看看我在不同画面里的神态。"}</p></div><AiCreateClient initialEntryId={human ? "human" : ""} /></main>;
}
