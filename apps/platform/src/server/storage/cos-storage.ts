import "server-only";

import { createHash, createHmac } from "node:crypto";
import { AppError } from "@/server/errors";
import type { ObjectStorage, StoredObject } from "@/server/storage/types";

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signCosRequest(method: string, pathname: string, headers: Record<string, string>, accessKey: string, secret: string, now = Date.now()) {
  const start = Math.floor(now / 1000);
  const keyTime = `${start};${start + 600}`;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${encode(name.toLowerCase())}=${encode(headers[name])}`).join("&");
  const canonical = `${method.toLowerCase()}\n${pathname}\n\n${canonicalHeaders}\n`;
  const signKey = createHmac("sha1", secret).update(keyTime).digest("hex");
  const stringToSign = `sha1\n${keyTime}\n${createHash("sha1").update(canonical).digest("hex")}\n`;
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");
  return `q-sign-algorithm=sha1&q-ak=${encode(accessKey)}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${names.join(";")}&q-url-param-list=&q-signature=${signature}`;
}

export class CosObjectStorage implements ObjectStorage {
  private config() {
    const bucket = process.env.OSS_BUCKET;
    const region = process.env.STORAGE_REGION;
    const accessKey = process.env.OSS_ACCESS_KEY_ID;
    const secret = process.env.OSS_ACCESS_KEY_SECRET;
    if (!bucket || !region || !accessKey || !secret) throw new AppError("STORAGE_CONFIG_PENDING", "腾讯云 COS 配置尚未补齐", 503);
    if (!/^[a-z0-9][a-z0-9-]*-\d+$/.test(bucket) || !/^[a-z]+-[a-z]+(?:-\d+)?$/.test(region)) throw new AppError("STORAGE_CONFIG_INVALID", "COS 存储桶或地域格式错误", 503);
    const host = `${bucket}.cos.${region}.myqcloud.com`;
    if (process.env.OSS_ENDPOINT && process.env.OSS_ENDPOINT.replace(/\/$/, "") !== `https://${host}`) throw new AppError("STORAGE_CONFIG_INVALID", "COS 地址必须与私有存储桶及地域一致", 503);
    return { host, accessKey, secret };
  }

  private async request(method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType = "application/octet-stream") {
    if (!key || Buffer.byteLength(key) > 1024 || /[\\\x00-\x1f\x7f]/.test(key) || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new AppError("INVALID_OBJECT_KEY", "对象路径无效", 400);
    const config = this.config();
    const headers: Record<string, string> = { host: config.host };
    if (method === "PUT") {
      headers["content-type"] = contentType;
      headers["content-md5"] = createHash("md5").update(body ?? new Uint8Array()).digest("base64");
      headers["x-cos-acl"] = "private";
    }
    if (process.env.OSS_SESSION_TOKEN) headers["x-cos-security-token"] = process.env.OSS_SESSION_TOKEN;
    const authorization = signCosRequest(method, `/${key}`, headers, config.accessKey, config.secret);
    const response = await fetch(`https://${config.host}/${key.split("/").map(encode).join("/")}`, {
      method,
      headers: { ...headers, Authorization: authorization },
      body: method === "PUT" ? new Blob([Uint8Array.from(body ?? [])], { type: contentType }) : undefined,
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    });
    if (response.status === 404 && method !== "PUT") return null;
    if (!response.ok) throw new AppError("STORAGE_REQUEST_FAILED", `COS 对象存储请求失败 ${response.status}`, 502);
    return response;
  }

  async put(key: string, body: Uint8Array, contentType: string) {
    await this.request("PUT", key, body, contentType);
  }

  async get(key: string): Promise<StoredObject | null> {
    const response = await this.request("GET", key);
    return response ? { body: new Uint8Array(await response.arrayBuffer()), contentType: response.headers.get("content-type") || "application/octet-stream" } : null;
  }

  async delete(key: string) {
    await this.request("DELETE", key);
  }
}
