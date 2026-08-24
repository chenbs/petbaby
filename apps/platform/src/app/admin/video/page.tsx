import Link from "next/link";
import { VideoAdminClient } from "@/components/video-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function VideoAdminPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">VIDEO OPERATIONS</span><h1>视频模板与渲染任务</h1><p>维护模板、字体、背景音乐和转场白名单，并处理失败任务。</p></div><VideoAdminClient /></main>;
}
