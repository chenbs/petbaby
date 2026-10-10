import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

import { AppError } from "@/server/errors";
import { isTestHarness } from "@/server/runtime-mode";

/*
 * 本地开发与生产同口径（2026-10-09）：缺密钥明确失败，不再用固定串加密收货地址。
 * 只有自动化测试夹具用固定密钥。惰性读取，避免模块加载时就因缺变量崩掉整条路由。
 */
function key() {
  const configured = process.env.ADDRESS_ENCRYPTION_KEY;
  if (!configured && !isTestHarness()) throw new AppError("ADDRESS_KEY_CONFIG_PENDING", "收货地址服务尚未配置", 503);
  return createHash("sha256").update(configured || "petbaby-test-address-key").digest();
}

export function encryptAddress(value: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptAddress(value: string): Record<string, string> {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) throw new Error("ADDRESS_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as Record<string, string>;
}
