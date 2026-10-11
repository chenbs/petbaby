import Link from "next/link";import { MemorialClient } from "@/components/memorial-client";
export default function MemorialsPage(){return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">MEMORIAL</span><h1>纪念空间</h1><p>安静保存照片和故事，不展示营销内容，也不开放公开留言。</p></div><MemorialClient/></main>}
