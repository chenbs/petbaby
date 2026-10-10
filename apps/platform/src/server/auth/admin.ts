import "server-only";

import { notFound } from "next/navigation";

import { AppError } from "@/server/errors";
import { isTestHarness } from "@/server/runtime-mode";

function adminUserIds() {
  return new Set(
    (process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isAdmin(userId: string) {
  // 本地开发与生产一样按 ADMIN_USER_IDS 白名单判断，只有自动化测试夹具默认放行。
  if (isTestHarness()) return true;
  return adminUserIds().has(userId);
}

export function assertAdmin(userId: string) {
  if (!isAdmin(userId)) throw new AppError("ADMIN_NOT_FOUND", "页面不存在", 404);
}

export function assertAdminPage(userId: string) {
  if (!isAdmin(userId)) notFound();
}
