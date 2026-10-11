import type { Metadata } from "next";
import { Toaster } from "sonner";

import { AdminShell, THEME_BOOT_SCRIPT } from "@/components/admin/shell";
import { attentionQueue } from "@/server/admin/analytics";
import { isAdmin } from "@/server/auth/admin";
import { getOptionalUserId } from "@/server/auth/session";
import { getDatabase } from "@/server/db/client";
import { runtimeMode } from "@/server/runtime-mode";

import "./admin.css";

/*
 * 运营后台是独立的根布局：桌面优先的控制台，与消费端（src/app/(app)，手机框）的样式完全隔离。
 * 权限在每个 page 的 requireAdminPage() 里判断；这里只在确认是管理员后才渲染导航外壳，
 * 非管理员只看到 404，不会看到后台结构。
 */

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "运营控制台 · 麻麻抱我", template: "%s · 麻麻抱我运营控制台" },
  robots: { index: false, follow: false },
  icons: { icon: "/icon.svg" },
};

const MODE_LABELS = { production: "正式生产", staging: "测试机", development: "本地开发" } as const;

export default async function AdminLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const userId = await getOptionalUserId();
  const admin = userId ? isAdmin(userId) : false;
  let shell: React.ReactNode = children;
  if (userId && admin) {
    const [attention, operatorRows] = await Promise.all([
      attentionQueue(),
      (await getDatabase()).query("SELECT display_name, account_name FROM users WHERE id=$1", [userId]),
    ]);
    const mode = runtimeMode();
    const name = String(operatorRows[0]?.display_name || operatorRows[0]?.account_name || "管理员");
    shell = (
      <AdminShell
        operator={{ id: userId, name }}
        environment={{ mode, label: MODE_LABELS[mode] }}
        badges={{
          tasks: attention.failedAi + attention.failedTasks + attention.failedVideos + attention.staleTasks,
          orders: attention.physicalPending + attention.pendingRefunds,
          messages: attention.failedMessages,
        }}
      >
        {children}
      </AdminShell>
    );
  }
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        {/* 首屏前写好 data-theme，避免深色模式下先闪一下白底 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        {shell}
        <Toaster position="top-center" richColors closeButton toastOptions={{ className: "!rounded-xl" }} />
      </body>
    </html>
  );
}
