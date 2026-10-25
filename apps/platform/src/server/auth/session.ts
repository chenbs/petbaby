import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { AppError } from "@/server/errors";
import { getDatabase } from "@/server/db/client";
import { isTestHarness } from "@/server/runtime-mode";

const COOKIE_NAME = "petbaby_session";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

function sessionSecret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  // 本地开发与生产同口径：缺密钥直接失败，只有自动化测试夹具用固定密钥。
  if (!isTestHarness()) throw new Error("SESSION_SECRET must be at least 32 characters");
  return "local-development-secret-change-before-production";
}

function signature(value: string) {
  return createHmac("sha256", sessionSecret()).update(value).digest("base64url");
}

export function signSession(userId: string) {
  const expiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
  const payload = Buffer.from(JSON.stringify({ userId, expiresAt })).toString("base64url");
  return `${payload}.${signature(payload)}`;
}

export function verifySession(value: string | undefined) {
  if (!value) return null;
  const [payload, suppliedSignature] = value.split(".");
  if (!payload || !suppliedSignature) return null;
  const expected = signature(payload);
  const left = Buffer.from(suppliedSignature);
  const right = Buffer.from(expected);
  if (left.length !== right.length || !timingSafeEqual(left, right)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { userId: string; expiresAt: number };
    if (session.expiresAt <= Date.now() || !/^[0-9a-f-]{36}$/.test(session.userId)) return null;
    return session;
  } catch {
    return null;
  }
}

async function ensureDemoUser() {
  const database = await getDatabase();
  await database.query(
    "INSERT INTO users (id, created_at) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING",
    [DEMO_USER_ID, new Date()],
  );
  return DEMO_USER_ID;
}

export const ACCOUNT_SUSPENDED_MESSAGE = "账号已被封禁，如有疑问请联系客服";

/** 会话对应的账号；suspended=true 表示签名有效但账号已被后台封禁。 */
async function sessionAccount(request?: Request) {
  const authorization = request?.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const cookieStore = await cookies();
  const session = verifySession(bearer || cookieStore.get(COOKIE_NAME)?.value);
  if (!session) return null;
  const database = await getDatabase();
  const rows = await database.query<{ suspended: boolean }>("SELECT admin_suspended_at IS NOT NULL suspended FROM users WHERE id=$1 AND deleted_at IS NULL", [session.userId]);
  return rows[0] ? { userId: session.userId, suspended: Boolean(rows[0].suspended) } : null;
}

/** 公开页面用：封禁账号按未登录处理（看不到私有内容，也不报错）。 */
export async function getOptionalUserId(request?: Request) {
  const account = await sessionAccount(request);
  if (account && !account.suspended) return account.userId;
  // demo 用户只留给自动化测试夹具；本地开发与生产一样必须登录（2026-10-09）。
  if (!account && isTestHarness()) return ensureDemoUser();
  return null;
}

/**
 * 需要登录的接口。封禁账号返回 403 ACCOUNT_SUSPENDED 而不是 401：
 * 401 会让小程序重新 wx.login，而微信登录对封禁账号同样拒绝 —— 明确的封禁码让端上直接提示、不再重试。
 */
export async function requireUserId(request?: Request) {
  const account = await sessionAccount(request);
  if (account?.suspended) throw new AppError("ACCOUNT_SUSPENDED", ACCOUNT_SUSPENDED_MESSAGE, 403);
  if (account) return account.userId;
  if (isTestHarness()) return ensureDemoUser();
  throw new AppError("UNAUTHENTICATED", "登录状态已失效，请重新登录", 401);
}

export async function setSession(userId: string) {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, signSession(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 7 * 24 * 60 * 60,
  });
  return signSession(userId);
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, "", {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 0,
  });
}
