import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { getDatabase } from "@/server/db/client";
import { AppError } from "@/server/errors";
import { requiredPaymentConfig } from "@/server/payments/config";

function encryptionKey() {
  const key = Buffer.from(requiredPaymentConfig("WECHAT_SESSION_ENCRYPTION_KEY"), "base64");
  if (key.length !== 32) throw new AppError("WECHAT_SESSION_CONFIG_INVALID", "微信会话加密密钥必须为 32 字节 Base64", 503);
  return key;
}

export async function storeWechatSession(userId: string, sessionKey: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), nonce);
  cipher.setAAD(Buffer.from(userId));
  const body = Buffer.concat([cipher.update(sessionKey, "utf8"), cipher.final()]);
  const ciphertext = [nonce, cipher.getAuthTag(), body].map((value) => value.toString("base64url")).join(".");
  await (await getDatabase()).query("INSERT INTO wechat_sessions (user_id,ciphertext,updated_at) VALUES ($1,$2,now()) ON CONFLICT (user_id) DO UPDATE SET ciphertext=$2,updated_at=now()", [userId, ciphertext]);
}

export async function readWechatSession(userId: string): Promise<string> {
  const rows = await (await getDatabase()).query("SELECT ciphertext FROM wechat_sessions WHERE user_id=$1 AND updated_at>now()-interval '90 minutes'", [userId]);
  if (!rows[0]) throw new AppError("WECHAT_SESSION_EXPIRED", "请重新登录微信后支付", 401);
  const [nonce, tag, body] = String(rows[0].ciphertext).split(".").map((value) => Buffer.from(value, "base64url"));
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), nonce);
  decipher.setAAD(Buffer.from(userId));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}
