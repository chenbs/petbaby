"use client";

import Image from "next/image";
import { useEffect, useState } from "react";

import { apiFetch } from "@/lib/api";

type SharedReport = { year: number; previewUrl: string };

export function AnnualReportShareClient({ token }: { token: string }) {
  const [data, setData] = useState<SharedReport | null>(null);
  const [error, setError] = useState("");
  useEffect(() => { apiFetch<SharedReport>(`/api/annual-report-share/${token}`).then(setData).catch((reason: unknown) => setError(reason instanceof Error ? reason.message : "报告读取失败")); }, [token]);
  if (error) return <div className="empty-state"><h1>报告分享已失效</h1><p>{error}</p></div>;
  if (!data) return <div className="empty-state">正在打开年度报告…</div>;
  return <section className="panel"><span className="eyebrow">PETBABY WRAPPED</span><h1>{data.year} 年度报告</h1><Image src={data.previewUrl} alt="年度报告预览" width={1080} height={1920} sizes="100vw" style={{ width: "100%", height: "auto" }} unoptimized /><p>这是一份只读预览，不展示原始照片。</p></section>;
}
