import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { cookies } from "next/headers";

import { AppError } from "@/server/errors";
import { getDatabase } from "@/server/db/client";

const COOKIE_NAME = "petbaby_session";
const DEMO_USER_ID = "00000000-0000-4000-8000-000000000001";

function sessionSecret() {
  const configured = process.env.SESSION_SECRET;
  if (configured && configured.length >= 32) return configured;
  if (process.env.NODE_ENV === "production") throw new Error("SESSION_SECRET must be at least 32 characters");
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

export async function getOptionalUserId(request?: Request) {
  const authorization = request?.headers.get("authorization");
  const bearer = authorization?.startsWith("Bearer ") ? authorization.slice(7) : undefined;
  const cookieStore = await cookies();
  const session = verifySession(bearer || cookieStore.get(COOKIE_NAME)?.value);
  if (session) {
    const database = await getDatabase();
    const rows = await database.query("SELECT id FROM users WHERE id=$1 AND deleted_at IS NULL AND admin_suspended_at IS NULL", [session.userId]);
    if (rows[0]) return session.userId;
  }
  if (process.env.NODE_ENV !== "production") return ensureDemoUser();
  return null;
}

export async function requireUserId(request?: Request) {
  const userId = await getOptionalUserId(request);
  if (userId) return userId;
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
