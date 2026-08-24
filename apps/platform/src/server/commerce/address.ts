import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";

const key = createHash("sha256").update(process.env.ADDRESS_ENCRYPTION_KEY || "petbaby-local-address-key").digest();

export function encryptAddress(value: Record<string, string>) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return `${iv.toString("base64url")}.${cipher.getAuthTag().toString("base64url")}.${body.toString("base64url")}`;
}

export function decryptAddress(value: string): Record<string, string> {
  const [iv, tag, body] = value.split(".");
  if (!iv || !tag || !body) throw new Error("ADDRESS_CIPHERTEXT_INVALID");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(body, "base64url")), decipher.final()]).toString("utf8")) as Record<string, string>;
}
