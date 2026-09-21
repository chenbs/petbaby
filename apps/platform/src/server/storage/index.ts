import "server-only";

import { isRealProduction } from "@/server/runtime-mode";
import { LocalObjectStorage } from "@/server/storage/local-storage";
import { ConfiguredCloudStorage } from "@/server/storage/cloud-storage";
import { CosObjectStorage } from "@/server/storage/cos-storage";
import { AppError } from "@/server/errors";
import type { ObjectStorage } from "@/server/storage/types";

export function selectObjectStorage(): ObjectStorage {
  const provider = process.env.OBJECT_STORAGE_PROVIDER?.trim().toLowerCase();
  if (provider === "cos") return new CosObjectStorage();
  if (provider === "s3") return new ConfiguredCloudStorage();
  if (provider === "local") return isRealProduction() ? new CosObjectStorage() : new LocalObjectStorage();
  if (provider) throw new AppError("STORAGE_CONFIG_INVALID", "不支持的对象存储服务", 503);
  if (process.env.NODE_ENV === "production") return new CosObjectStorage();
  return new LocalObjectStorage();
}

export const objectStorage = selectObjectStorage();

const signatures: Record<string, { mime: string; extension: string }> = {
  "ffd8ff": { mime: "image/jpeg", extension: "jpg" },
  "89504e470d0a1a0a": { mime: "image/png", extension: "png" },
  "52494646": { mime: "image/webp", extension: "webp" },
};

export function inspectImage(body: Uint8Array, declaredMime?: string) {
  const header = Buffer.from(body.subarray(0, 12)).toString("hex");
  const match = Object.entries(signatures).find(([signature]) => header.startsWith(signature));
  if (!match) return null;
  if (declaredMime && declaredMime !== "application/octet-stream" && match[1].mime !== declaredMime) return null;
  if (match[1].mime === "image/webp" && Buffer.from(body.subarray(8, 12)).toString("ascii") !== "WEBP") return null;
  return match[1];
}
