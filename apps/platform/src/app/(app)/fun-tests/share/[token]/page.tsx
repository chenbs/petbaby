import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";

import { FunTestResultView } from "@/components/fun-test-result";
import { getPublicFunTestResult } from "@/server/fun-test-service";

import "../../fun-tests.css";

export const dynamic = "force-dynamic";

type Context = { params: Promise<{ token: string }> };

export async function generateMetadata({ params }: Context): Promise<Metadata> {
  try {
    const result = await getPublicFunTestResult((await params).token);
    const requestHeaders = await headers();
    const origin = process.env.PUBLIC_APP_URL || `http://${requestHeaders.get("host") || "localhost:3000"}`;
    return {
      metadataBase: new URL(origin),
      title: `${result.petName}是${result.outcome.name} | 麻麻抱我`,
      description: result.outcome.description,
      openGraph: { title: `${result.petName}的趣味测试结果`, description: result.outcome.description, images: [`/fun-tests/${result.cover}.jpg`] },
      robots: { index: false, follow: false },
    };
  } catch { return { title: "分享已失效 | 麻麻抱我", robots: { index: false, follow: false } }; }
}

export default async function FunTestSharePage({ params }: Context) {
  let result;
  try { result = await getPublicFunTestResult((await params).token); }
  catch { result = null; }
  return <main className="screen ft-screen">
    <header className="ft-topbar"><Link href="/fun-tests" aria-label="测试首页">←</Link><span>麻麻抱我 / 趣味测试</span><span>SHARE</span></header>
    {result ? <FunTestResultView result={result} /> : <section className="ft-heading"><span className="ft-eyebrow">RESULT UNAVAILABLE</span><h1>这份结果已失效</h1><p>它可能已经被删除，或分享链接不完整。</p><Link className="ft-primary" href="/fun-tests">去测测我的宠物</Link></section>}
  </main>;
}
