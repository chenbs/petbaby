import Link from "next/link";
import { VideoProjectClient } from "@/components/video-project-client";

export default async function VideoProjectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/video/create">返回视频编辑</Link><span className="eyebrow">VIDEO PROJECT</span><h1>项目进度与成片</h1><p>预览完成后可直接保存到作品库，高清版通过统一订单解锁。</p></div><VideoProjectClient id={id} /></main>;
}
