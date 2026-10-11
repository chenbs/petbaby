import { redirect } from "next/navigation";

import { requireAdminPage } from "@/server/admin/page-guard";

export const dynamic = "force-dynamic";

/** 旧「订阅、履约与权益」入口：订阅消息与年度报告在「消息与报告」，实体履约与退款在「订单与履约」。 */
export default async function LegacyBusinessPage() {
  await requireAdminPage("/admin/business");
  redirect("/admin/messages");
}
