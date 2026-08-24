import "server-only";

import { notFound } from "next/navigation";

import { AppError } from "@/server/errors";

function adminUserIds() {
  return new Set(
    (process.env.ADMIN_USER_IDS || "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
}

export function isAdmin(userId: string) {
  if (process.env.NODE_ENV !== "production") return true;
  return adminUserIds().has(userId);
}

export function assertAdmin(userId: string) {
  if (!isAdmin(userId)) throw new AppError("ADMIN_NOT_FOUND", "页面不存在", 404);
}

export function assertAdminPage(userId: string) {
  if (!isAdmin(userId)) notFound();
}
