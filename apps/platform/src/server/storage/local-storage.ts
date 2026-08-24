import "server-only";

import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import type { ObjectStorage } from "@/server/storage/types";

function safePath(root: string, key: string) {
  if (!/^[a-zA-Z0-9/_-]+\.[a-zA-Z0-9]+$/.test(key)) throw new Error("Invalid storage key");
  const target = path.resolve(root, key);
  if (!target.startsWith(`${path.resolve(root)}${path.sep}`)) throw new Error("Invalid storage path");
  return target;
}

export class LocalObjectStorage implements ObjectStorage {
  private readonly root = process.env.LOCAL_STORAGE_DIR
    ? path.resolve(process.env.LOCAL_STORAGE_DIR)
    : path.join(process.cwd(), ".data", "objects");

  async put(key: string, body: Uint8Array, contentType: string) {
    const target = safePath(this.root, key);
    await mkdir(path.dirname(target), { recursive: true });
    await Promise.all([
      writeFile(target, body),
      writeFile(`${target}.meta`, JSON.stringify({ contentType }), "utf8"),
    ]);
  }

  async get(key: string) {
    const target = safePath(this.root, key);
    try {
      const [body, metadata] = await Promise.all([
        readFile(target),
        readFile(`${target}.meta`, "utf8"),
      ]);
      return { body: new Uint8Array(body), contentType: JSON.parse(metadata).contentType as string };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }

  async delete(key: string) {
    const target = safePath(this.root, key);
    await Promise.allSettled([unlink(target), unlink(`${target}.meta`)]);
  }
}
