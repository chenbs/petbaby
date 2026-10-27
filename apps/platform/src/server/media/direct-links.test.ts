import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { POST as mediaLinks } from "@/app/api/media-links/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createDirectLinks, parseMediaPath } from "@/server/media/direct-links";
import { createPet } from "@/server/platform-service";
import { deletePhoto, savePhoto } from "@/server/photo-library-service";
import { objectStorage } from "@/server/storage";
import { displayKeyOf } from "@/server/storage/display-key";

vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-000000000081";
const OTHER = "00000000-0000-4000-8000-000000000082";
const mediaPath = (key: string) => `/api/media/${encodeURIComponent(key)}`;

/** 测试里的 LocalObjectStorage 没有预签名能力：装一个假的签名器，模拟 COS。 */
function fakeSigner() {
  const storage = objectStorage as typeof objectStorage & { signedUrl?: (key: string) => { url: string; expiresAt: string }; exists?: (key: string) => Promise<boolean> };
  storage.signedUrl = (key) => ({ url: `https://cos.example/${key}?sig`, expiresAt: "2026-10-27T09:00:00.000Z" });
  storage.exists = async (key) => Boolean(await objectStorage.get(key));
  return () => { delete storage.signedUrl; delete storage.exists; };
}

let restore = () => undefined as void;
let petId: string;
let photoKey: string;
let photoId: string;

beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  petId = (await createPet(USER, { name: "直连小猫", species: "cat" })).id;
  const image = await sharp({ create: { width: 2400, height: 3200, channels: 3, background: "orange" } }).png().toBuffer();
  photoKey = `private/${USER}/${crypto.randomUUID()}.png`;
  await objectStorage.put(photoKey, image, "image/png");
  photoId = (await savePhoto(USER, { petId, filename: "a.png", storageKey: photoKey, mimeType: "image/png", size: image.length })).id;
  restore = fakeSigner();
});
afterEach(() => { restore(); vi.unstubAllEnvs(); });

describe("图片直连 COS 预签名", () => {
  it("解析三类私有媒体路径，其余一律不认", () => {
    expect(parseMediaPath("/api/media/private%2Fa.svg?format=png")).toEqual({ kind: "media", key: "private/a.svg", format: "png" });
    expect(parseMediaPath(`/api/owner-photos/${USER}/media`)).toEqual({ kind: "owner", id: USER });
    expect(parseMediaPath("/api/record-attachments/not-a-uuid/media")).toBeNull();
    expect(parseMediaPath("/api/works/x/download")).toBeNull();
    expect(parseMediaPath("/api/media/%E0%A4%A")).toBeNull();
  });

  it("本人照片换到展示小图的直连地址，小图已落进对象存储且保持缩放；他人拿不到", async () => {
    const { links } = await createDirectLinks(USER, { paths: [mediaPath(photoKey)], display: true });
    const displayKey = displayKeyOf(photoKey)!;
    expect(links[0]?.url).toBe(`https://cos.example/${displayKey}?sig`);
    const stored = await objectStorage.get(displayKey);
    expect(stored?.contentType).toBe("image/jpeg");
    const meta = await sharp(Buffer.from(stored!.body)).metadata();
    expect(Math.max(meta.width || 0, meta.height || 0)).toBeLessThanOrEqual(1440);

    expect((await createDirectLinks(OTHER, { paths: [mediaPath(photoKey)], display: true })).links).toEqual([null]);
    // 原图直连（display=false）签原对象
    expect((await createDirectLinks(USER, { paths: [mediaPath(photoKey)], display: false })).links[0]?.url).toBe(`https://cos.example/${photoKey}?sig`);
  });

  it("删除照片后不再签发", async () => {
    await createDirectLinks(USER, { paths: [mediaPath(photoKey)], display: true });
    await deletePhoto(USER, photoId);
    expect((await createDirectLinks(USER, { paths: [mediaPath(photoKey)], display: true })).links).toEqual([null]);
  });

  it("锁定作品原图不签发；SVG 与无法解析的路径回落原接口（null）", async () => {
    const workId = crypto.randomUUID();
    const outputKey = `private/${USER}/works/${workId}.png`;
    const previewKey = `private/${USER}/works/${workId}-preview.png`;
    await objectStorage.put(outputKey, await sharp({ create: { width: 20, height: 20, channels: 3, background: "teal" } }).png().toBuffer(), "image/png");
    await (await getDatabase()).query("INSERT INTO works (id,user_id,plugin_id,pet_id,photo_id,title,subtitle,serial_number,authority,output_key,preview_key,locked,public,version,asset_kind,created_at) VALUES ($1,$2,'pet-id-card',$3,$4,'t','','s','a',$5,$6,true,false,1,'image',now())", [workId, USER, petId, photoId, outputKey, previewKey]);
    const { links } = await createDirectLinks(USER, { paths: [mediaPath(outputKey), "/api/media/private%2Fx.svg?format=png", "/api/works/x/download"], display: false });
    expect(links).toEqual([null, null, null]);
  });

  it("主人照片与记录附图只签给本人", async () => {
    const ownerId = crypto.randomUUID();
    const ownerKey = `private/${USER}/owner/${ownerId}.jpg`;
    const attachmentId = crypto.randomUUID();
    const attachmentKey = `private/${USER}/records/${attachmentId}.jpg`;
    const jpeg = await sharp({ create: { width: 20, height: 20, channels: 3, background: "teal" } }).jpeg().toBuffer();
    await objectStorage.put(ownerKey, jpeg, "image/jpeg");
    await objectStorage.put(attachmentKey, jpeg, "image/jpeg");
    const db = await getDatabase();
    await db.query("INSERT INTO owner_photos (id,user_id,filename,mime_type,size,storage_key,quality,authorization_confirmed_at,created_at) VALUES ($1,$2,'o.jpg','image/jpeg',1,$3,'clear',now(),now())", [ownerId, USER, ownerKey]);
    await db.query("INSERT INTO pet_record_attachments (id,user_id,pet_id,storage_key,mime_type,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',now())", [attachmentId, USER, petId, attachmentKey]);
    const paths = [`/api/owner-photos/${ownerId}/media`, `/api/record-attachments/${attachmentId}/media`];
    expect((await createDirectLinks(USER, { paths, display: false })).links.map((link) => link?.url)).toEqual([`https://cos.example/${ownerKey}?sig`, `https://cos.example/${attachmentKey}?sig`]);
    expect((await createDirectLinks(OTHER, { paths, display: false })).links).toEqual([null, null]);
  });

  it("存储没有预签名能力（本地磁盘）时整批返回 null", async () => {
    restore();
    expect((await createDirectLinks(USER, { paths: [mediaPath(photoKey)], display: true })).links).toEqual([null]);
  });

  it("接口要求登录与 JSON，返回与入参等长的数组", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("SESSION_SECRET", "direct-links-test-secret-over-32-characters");
    const call = (user?: string) => mediaLinks(new Request("http://localhost/api/media-links", {
      method: "POST",
      headers: { "content-type": "application/json", "x-petbaby-client": "miniprogram", ...(user ? { authorization: `Bearer ${signSession(user)}` } : {}) },
      body: JSON.stringify({ paths: [mediaPath(photoKey), "/api/nope"] }),
    }));
    expect((await call()).status).toBe(401);
    const response = await call(USER);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const { data } = await response.json();
    expect(data.links).toHaveLength(2);
    expect(data.links[0].url).toContain("display/");
    expect(data.links[1]).toBeNull();
  });
});
