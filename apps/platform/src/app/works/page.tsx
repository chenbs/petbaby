import { WorksClient } from "@/components/works-client";

export default function WorksPage() {
  return (
    <main className="screen">
      <div className="page-heading">
        <span className="eyebrow">MY CABINET</span>
        <h1>我的作品柜</h1>
        <p>免费作品保留 90 天，已解锁作品会一直陪着你。</p>
      </div>
      <WorksClient />
    </main>
  );
}
