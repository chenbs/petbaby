import Link from "next/link";
import { VideoCreateClient } from "@/components/video-create-client";

export default function VideoCreatePage() {
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">PL-19 · MEMORY FILM</span><h1>剪一段只属于你们的短片</h1><p>先选时长，再把照片排成你的节奏，加上字幕、转场和一首背景音乐。</p></div><VideoCreateClient /></main>;
}
