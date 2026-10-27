import "server-only";

import { createHash, createHmac } from "node:crypto";
import { AppError } from "@/server/errors";
import { displayKeyOf } from "@/server/storage/display-key";
import type { ObjectStorage, SignedObjectUrl, StoredObject } from "@/server/storage/types";

function encode(value: string) {
  return encodeURIComponent(value).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

export function signCosRequest(method: string, pathname: string, headers: Record<string, string>, accessKey: string, secret: string, now = Date.now(), lifetimeSeconds = 600) {
  const start = Math.floor(now / 1000);
  const keyTime = `${start};${start + lifetimeSeconds}`;
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${encode(name.toLowerCase())}=${encode(headers[name])}`).join("&");
  const canonical = `${method.toLowerCase()}\n${pathname}\n\n${canonicalHeaders}\n`;
  const signKey = createHmac("sha1", secret).update(keyTime).digest("hex");
  const stringToSign = `sha1\n${keyTime}\n${createHash("sha1").update(canonical).digest("hex")}\n`;
  const signature = createHmac("sha1", signKey).update(stringToSign).digest("hex");
  return `q-sign-algorithm=sha1&q-ak=${encode(accessKey)}&q-sign-time=${keyTime}&q-key-time=${keyTime}&q-header-list=${names.join(";")}&q-url-param-list=&q-signature=${signature}`;
}

/*
 * 客户端直连 COS 的预签名地址（2026-10-27）：服务器只做鉴权与签名，字节不再经过服务器出网带宽。
 *
 * 签名起点按 30 分钟对齐、有效期 60 分钟：同一窗口内同一对象的地址不变，端上缓存才命中；
 * 任何时刻签出的地址都至少还能用 30 分钟。删除、封禁、解锁这类变化最多滞后一个有效期。
 */
const LINK_WINDOW_SECONDS = 1800;

function assertObjectKey(key: string) {
  if (!key || Buffer.byteLength(key) > 1024 || /[\\\x00-\x1f\x7f]/.test(key) || key.split("/").some((segment) => !segment || segment === "." || segment === "..")) throw new AppError("INVALID_OBJECT_KEY", "对象路径无效", 400);
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

  private async request(method: "PUT" | "GET" | "DELETE", key: string, body?: Uint8Array, contentType = "application/octet-stream", unsigned: Record<string, string> = {}) {
    assertObjectKey(key);
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
      headers: { ...headers, ...unsigned, Authorization: authorization },
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

  async exists(key: string) {
    // 只取首字节：CAM 里 HeadObject 是独立权限，最小权限凭据未必有；GetObject 一定有
    const response = await this.request("GET", key, undefined, undefined, { range: "bytes=0-0" });
    await response?.body?.cancel();
    return Boolean(response);
  }

  /** 连同展示小图一起删：派生文件只在这里清理，既有删除链路都不用改。 */
  async delete(key: string) {
    await this.request("DELETE", key);
    const display = displayKeyOf(key);
    if (display) await this.request("DELETE", display);
  }

  /** 只签 GET 与 host，端上不带任何自定义头即可下载。 */
  signedUrl(key: string, now = Date.now()): SignedObjectUrl {
    assertObjectKey(key);
    const config = this.config();
    const start = Math.floor(now / 1000 / LINK_WINDOW_SECONDS) * LINK_WINDOW_SECONDS;
    const signature = signCosRequest("GET", `/${key}`, { host: config.host }, config.accessKey, config.secret, start * 1000, LINK_WINDOW_SECONDS * 2);
    const token = process.env.OSS_SESSION_TOKEN ? `&x-cos-security-token=${encode(process.env.OSS_SESSION_TOKEN)}` : "";
    return {
      url: `https://${config.host}/${key.split("/").map(encode).join("/")}?${signature.replace(/;/g, "%3B")}${token}`,
      expiresAt: new Date((start + LINK_WINDOW_SECONDS * 2) * 1000).toISOString(),
    };
  }
}
