import "server-only";

import { z } from "zod";

import { getDatabase } from "@/server/db/client";
import { getAiRun } from "@/server/growth-service";
import { canDisplayResize, displayImage } from "@/server/media/display-image";
import { canReadMediaKey } from "@/server/media/media-access";
import { objectStorage } from "@/server/storage";
import { displayKeyOf } from "@/server/storage/display-key";

/*
 * 图片直连 COS（2026-10-27）。
 *
 * 原来每张图都是「小程序 → 服务器鉴权 → 服务器从 COS 取字节 → 再发给小程序」，瓶颈是服务器出网带宽。
 * 现在端上把要显示的接口路径（`/api/media/*` 等）批量交过来，这里按与原接口**同一份**归属校验逐条判定，
 * 通过的换成 COS 预签名地址（有效期见 cos-storage.ts），字节由端上直接从 COS 下载。
 *
 * - 桶仍是私有读写。不签名、签名过期、或被拒的路径都拿不到字节。
 * - 返回 null 的路径由端上回落到原接口：本地磁盘存储没有预签名能力，SVG 转 PNG 只能服务器做。
 * - 展示小图落成对象存储里的派生文件（storage/display-key.ts），由服务器经内网生成一次；
 *   删除原对象时 CosObjectStorage.delete 一并删除，既有删除链路不用改。
 * - 原图交付（保存到相册、AI 标识确认）不走这里，仍是各自的下载出口。
 */

export const directLinksSchema = z.object({
  paths: z.array(z.string().min(1).max(600)).min(1).max(100),
  display: z.boolean().default(true),
});

type Target = { kind: "media"; key: string; format?: string } | { kind: "owner" | "record"; id: string } | { kind: "candidate"; runId: string; candidateId: string };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseMediaPath(path: string): Target | null {
  const [pathname, query = ""] = path.split("?");
  if (pathname.startsWith("/api/media/")) {
    let key: string;
    try { key = pathname.slice("/api/media/".length).split("/").map(decodeURIComponent).join("/"); } catch { return null; }
    return { kind: "media", key, format: new URLSearchParams(query).get("format") || undefined };
  }
  const match = /^\/api\/(owner-photos|record-attachments)\/([^/]+)\/media$/.exec(pathname);
  if (match && UUID.test(match[2])) return { kind: match[1] === "owner-photos" ? "owner" : "record", id: match[2] };
  const candidate = /^\/api\/ai-runs\/([^/]+)\/candidates\/([^/]+)$/.exec(pathname);
  if (candidate && UUID.test(candidate[1])) {
    let candidateId: string;
    try { candidateId = decodeURIComponent(candidate[2]); } catch { return null; }
    if (/^[A-Za-z0-9-]{1,80}$/.test(candidateId)) return { kind: "candidate", runId: candidate[1], candidateId };
  }
  return null;
}

/** 已确认存在的展示小图。对象键带 uuid、内容不可变，进程内记住即可省掉重复的 HEAD。 */
const knownDisplayKeys = new Set<string>();
const KNOWN_LIMIT = 50_000;

function rememberDisplay(key: string) {
  if (knownDisplayKeys.size >= KNOWN_LIMIT) knownDisplayKeys.clear();
  knownDisplayKeys.add(key);
}

/** 把展示小图写进对象存储。写完再确认原对象仍在：并发删除时不留下孤儿小图。 */
export async function storeDisplayCopy(key: string, body: Buffer) {
  const target = displayKeyOf(key);
  if (!target || !objectStorage.signedUrl) return;
  await objectStorage.put(target, new Uint8Array(body), "image/jpeg");
  if (objectStorage.exists && !(await objectStorage.exists(key))) {
    await objectStorage.delete(target).catch(() => undefined);
    return;
  }
  rememberDisplay(target);
}

async function ensureDisplayCopy(key: string) {
  const target = displayKeyOf(key);
  if (!target) return null;
  if (knownDisplayKeys.has(target)) return target;
  if (objectStorage.exists && await objectStorage.exists(target)) {
    rememberDisplay(target);
    return target;
  }
  const object = await objectStorage.get(key);
  if (!object || !canDisplayResize(object.contentType)) return null;
  await storeDisplayCopy(key, await displayImage(key, object));
  return knownDisplayKeys.has(target) ? target : null;
}

async function ownedUploadKey(userId: string, target: { kind: "owner" | "record"; id: string }) {
  const rows = target.kind === "owner"
    ? await (await getDatabase()).query("SELECT storage_key FROM owner_photos WHERE id=$1 AND user_id=$2 AND deleted_at IS NULL", [target.id, userId])
    : await (await getDatabase()).query("SELECT storage_key FROM pet_record_attachments WHERE id=$1 AND user_id=$2", [target.id, userId]);
  const key = rows[0] ? String(rows[0].storage_key) : "";
  const prefix = `private/${userId}/${target.kind === "owner" ? "owner" : "records"}/`;
  return key.startsWith(prefix) ? key : null;
}

/**
 * 生成结果页的候选图：与 /api/ai-runs/[id]/candidates/[candidateId] 同一口径（已解锁的选中张取原图，其余取预览）。
 * 只签展示小图：原图交付要先过 AI 标识确认（428），不能被直连绕过。
 */
async function candidateKey(userId: string, target: { runId: string; candidateId: string }, display: boolean) {
  if (!display) return null;
  const run = await getAiRun(userId, target.runId).catch(() => null);
  const candidate = run?.candidates.find((item) => item.id === target.candidateId);
  if (!run || !candidate) return null;
  const key = run.selectedUnlocked && run.selectedId === target.candidateId ? candidate.outputKey : candidate.previewKey;
  return key && displayKeyOf(key) ? ensureDisplayCopy(key) : null;
}

async function resolveKey(userId: string, path: string, display: boolean) {
  const target = parseMediaPath(path);
  if (!target) return null;
  if (target.kind === "candidate") return candidateKey(userId, target, display);
  if (target.kind !== "media") return ownedUploadKey(userId, target);
  if (!(await canReadMediaKey(userId, target.key))) return null;
  // 展示：可缩放的图片走派生小图；视频等不缩的原样直连
  if (display && displayKeyOf(target.key)) return ensureDisplayCopy(target.key);
  // SVG 原文件端上不能直接显示（需要服务器转 PNG），回落原接口
  if (target.format || /\.svg$/i.test(target.key)) return null;
  return target.key;
}

/** 返回与 paths 等长的数组：预签名地址，或 null（端上回落原接口）。单条失败不影响其他条。 */
export async function createDirectLinks(userId: string, input: z.infer<typeof directLinksSchema>) {
  const signedUrl = objectStorage.signedUrl;
  if (!signedUrl) return { links: input.paths.map(() => null) };
  const sign = (key: string) => signedUrl.call(objectStorage, key);
  const links: Array<{ url: string; expiresAt: string } | null> = input.paths.map(() => null);
  let next = 0;
  async function worker() {
    while (next < input.paths.length) {
      const index = next++;
      try {
        const key = await resolveKey(userId, input.paths[index], input.display);
        links[index] = key ? sign(key) : null;
      } catch {
        links[index] = null;
      }
    }
  }
  await Promise.all(Array.from({ length: 6 }, worker));
  return { links };
}
