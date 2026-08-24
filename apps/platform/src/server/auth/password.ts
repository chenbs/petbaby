import "server-only";

import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";

const scrypt = promisify(scryptCallback) as (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number }) => Promise<Buffer>;

const KEY_LENGTH = 64;
const COST = { N: 16384, r: 8, p: 1 };
const ACCOUNT_PATTERN = /^[a-zA-Z][a-zA-Z0-9._-]{2,31}$/;

/** 账号密码登录默认只在非生产开启；测试机需显式设置 `PASSWORD_AUTH_ENABLED=true`。 */
export function passwordAuthEnabled() {
  const flag = process.env.PASSWORD_AUTH_ENABLED?.trim().toLowerCase();
  if (flag) return flag === "1" || flag === "true" || flag === "on";
  return process.env.NODE_ENV !== "production";
}

export function assertPasswordAuthEnabled() {
  if (!passwordAuthEnabled()) throw new AppError("PASSWORD_AUTH_DISABLED", "账号密码登录未启用", 403);
}

export function normalizeAccountName(value: string) {
  const account = value.trim();
  if (!ACCOUNT_PATTERN.test(account)) throw new AppError("ACCOUNT_NAME_INVALID", "账号需 3-32 位，以字母开头，仅含字母、数字、点、下划线或连字符", 422);
  return account;
}

export function assertPasswordStrength(password: string) {
  if (password.length < 10 || password.length > 72) throw new AppError("PASSWORD_WEAK", "密码需 10-72 位", 422);
  if (!/[a-zA-Z]/.test(password) || !/[0-9]/.test(password)) throw new AppError("PASSWORD_WEAK", "密码需同时包含字母和数字", 422);
}

export async function hashPassword(password: string) {
  const salt = randomBytes(16);
  const derived = await scrypt(password, salt, KEY_LENGTH, COST);
  return `scrypt$${COST.N}$${COST.r}$${COST.p}$${salt.toString("base64url")}$${derived.toString("base64url")}`;
}

export async function verifyPassword(password: string, stored: string | null | undefined) {
  if (!stored) return false;
  const [scheme, n, r, p, salt, digest] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !digest) return false;
  const cost = { N: Number(n), r: Number(r), p: Number(p) };
  if (!(cost.N > 1 && cost.N <= 1 << 17) || !(cost.r > 0 && cost.r <= 16) || !(cost.p > 0 && cost.p <= 4)) return false;
  const derived = await scrypt(password, Buffer.from(salt, "base64url"), KEY_LENGTH, cost);
  const expected = Buffer.from(digest, "base64url");
  return derived.length === expected.length && timingSafeEqual(derived, expected);
}

function assertInviteCode(supplied: string | undefined) {
  const required = process.env.PASSWORD_AUTH_INVITE_CODE?.trim();
  if (!required) return;
  const left = Buffer.from(supplied || "");
  const right = Buffer.from(required);
  if (left.length !== right.length || !timingSafeEqual(left, right)) throw new AppError("INVITE_CODE_INVALID", "邀请码不正确", 403);
}

export async function registerWithPassword(input: { accountName: string; password: string; displayName?: string; inviteCode?: string }) {
  assertPasswordAuthEnabled();
  assertInviteCode(input.inviteCode);
  const accountName = normalizeAccountName(input.accountName);
  assertPasswordStrength(input.password);
  const database = await getDatabase();
  const taken = await database.query<{ id: string }>("SELECT id FROM users WHERE lower(account_name)=lower($1)", [accountName]);
  if (taken.length) throw new AppError("ACCOUNT_TAKEN", "该账号已被注册", 409);
  const userId = crypto.randomUUID();
  const now = new Date();
  try {
    await database.query(
      "INSERT INTO users (id, account_name, password_hash, password_updated_at, display_name, created_at) VALUES ($1,$2,$3,$4,$5,$6)",
      [userId, accountName, await hashPassword(input.password), now, input.displayName?.trim().slice(0, 40) || accountName, now],
    );
  } catch {
    throw new AppError("ACCOUNT_TAKEN", "该账号已被注册", 409);
  }
  return { userId, accountName };
}

export async function loginWithPassword(input: { accountName: string; password: string }) {
  assertPasswordAuthEnabled();
  const accountName = input.accountName.trim();
  const database = await getDatabase();
  const rows = await database.query<{ id: string; password_hash: string | null; deleted_at: Date | null; admin_suspended_at: Date | null }>(
    "SELECT id, password_hash, deleted_at, admin_suspended_at FROM users WHERE lower(account_name)=lower($1)",
    [accountName],
  );
  const user = rows[0];
  const matched = await verifyPassword(input.password, user?.password_hash);
  if (!user || !matched) throw new AppError("INVALID_CREDENTIALS", "账号或密码不正确", 401);
  if (user.deleted_at) throw new AppError("ACCOUNT_DELETED", "该账号已注销", 403);
  if (user.admin_suspended_at) throw new AppError("ACCOUNT_SUSPENDED", "该账号已被暂停，请联系客服", 403);
  return { userId: user.id, accountName };
}
