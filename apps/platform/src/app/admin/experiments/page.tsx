import Link from "next/link";

import { ExperimentsClient } from "@/components/experiments-client";
import { assertAdminPage } from "@/server/auth/admin";
import { requireUserId } from "@/server/auth/session";

export const dynamic = "force-dynamic";

export default async function ExperimentsPage() {
  assertAdminPage(await requireUserId());
  return <main className="screen"><div className="page-heading"><Link className="back-link" href="/admin">返回运营后台</Link><span className="eyebrow">EXPERIMENTS</span><h1>玩法赛马</h1><p>按 idea、testing、live、archived 流转玩法，不把运营状态写死在代码里。</p></div><ExperimentsClient /></main>;
}
