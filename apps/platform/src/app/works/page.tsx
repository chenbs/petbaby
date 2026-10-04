import { WorksClient } from "@/components/works-client";

export default function WorksPage() {
  return (
    <main className="screen">
      <div className="page-heading">
        <span className="eyebrow">MY CABINET</span>
        <h1>我的作品柜</h1>
        <p>作品会一直保存在这里，保存高清原图后可以下载。</p>
      </div>
      <WorksClient />
    </main>
  );
}
