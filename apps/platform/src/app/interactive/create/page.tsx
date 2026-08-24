import Link from "next/link";
import { InteractiveStudioClient } from "@/components/interactive-studio-client";

export default function InteractiveCreatePage() { return <main className="screen"><div className="page-heading"><Link className="back-link" href="/">← 返回玩法</Link><span className="eyebrow">PL-15 · INTERACTIVE H5</span><h1>编辑一页会回应的回忆</h1><p>选择宠物和照片，编辑主题与文案。公开分享可撤销，服务端会统一导出 15 秒 MP4 并归档到作品库。</p></div><InteractiveStudioClient /></main>; }
