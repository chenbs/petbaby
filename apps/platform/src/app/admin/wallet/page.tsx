import Link from "next/link";
import { WalletAdminClient } from "@/components/wallet-admin-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function WalletAdminPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">WALLET</span><h1>冻干钱包管理</h1><p>查看充值、消耗、余额与流水，按原因发放有期限的赠送补偿。</p></div><WalletAdminClient /></main>;
}
