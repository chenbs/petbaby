import Link from "next/link";
import { AccountClient } from "@/components/account-client";
export default function AccountPage() { return <main className="screen"><div className="page-heading"><Link className="back-link" href="/me">返回我的</Link><span className="eyebrow">ACCOUNT & PRIVACY</span><h1>账户与隐私</h1><p>你可以查看、导出或删除自己的资料。财务订单按合规要求保留。</p></div><AccountClient /></main>; }
