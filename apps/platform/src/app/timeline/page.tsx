import Link from "next/link";

import { TimelineClient } from "@/components/timeline-client";

/**
 * 成长时间线（改造项 E6）。
 *
 * 与小程序 `pages/timeline` 同数据源（`GET /api/pets/[id]/timeline`）。
 * 服务端能力早已建成，此前只有小程序有页面 —— 积累层的底座只有单端是反的。
 *
 * `petId` 走 searchParams 而不是路径段：这一页的主体是「时间线」而不是某只宠物，
 * 且页内有宠物选择器，路径段会让切换宠物变成一次导航。
 */
export const dynamic = "force-dynamic";

export default async function TimelinePage({ searchParams }: { searchParams: Promise<{ petId?: string }> }) {
  const { petId } = await searchParams;
  return <main className="screen">
    <div className="page-heading">
      <Link className="back-link" href="/me">返回我的</Link>
      <span className="eyebrow">TIMELINE</span>
      <h1>成长时间线</h1>
      <p>按记录日期回看收好的照片，每张都注明日期来源。</p>
    </div>
    <TimelineClient initialPetId={petId} />
  </main>;
}
