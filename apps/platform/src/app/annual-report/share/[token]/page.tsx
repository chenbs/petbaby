import { AnnualReportShareClient } from "@/components/annual-report-share-client";
export default async function AnnualReportSharePage({params}:{params:Promise<{token:string}>}){const{token}=await params;return <main className="screen"><AnnualReportShareClient token={token}/></main>}
