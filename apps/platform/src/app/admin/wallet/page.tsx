import { redirect } from "next/navigation";

import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";

/** 旧「冻干钱包管理」入口：全站报表并入「收入与冻干」，单个用户的钱包与补偿在用户详情页。 */
export default async function LegacyWalletPage() {
  await requireAdminPage("/admin/wallet");
  redirect("/admin/revenue");
}
