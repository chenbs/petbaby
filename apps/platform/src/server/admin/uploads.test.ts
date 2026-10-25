import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { getOptionalUserId, requireUserId, signSession } from "@/server/auth/session";
import { signInWechatUser } from "@/server/auth/wechat-account";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { saveRecordAttachment } from "@/server/daily-log-service";
import { saveOwnerPhoto } from "@/server/owner-photo-service";
import { savePhoto } from "@/server/photo-library-service";
import { createPet, updatePetAvatar } from "@/server/platform-service";
import { objectStorage } from "@/server/storage";
import { approveUploads, getUploadImage, listUploads, pendingUploadCount, removeUpload } from "./uploads";
import { setUserSuspension } from "./user-suspension";

// 只提供 Next 请求上下文；会话走真实签名校验。
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));

const ADMIN = "00000000-0000-4000-8000-0000000000a1";
const USER = "00000000-0000-4000-8000-0000000000a2";
let png: Buffer;

async function put(key: string) {
  await objectStorage.put(key, png, "image/png");
  return key;
}

async function seed() {
  const pet = await createPet(USER, { name: "团子", species: "cat" });
  const photo = await savePhoto(USER, { petId: pet.id, filename: "a.png", mimeType: "image/png", size: png.length, storageKey: await put(`private/${USER}/${crypto.randomUUID()}.png`) });
  await updatePetAvatar(USER, pet.id, await put(`private/${USER}/avatars/${crypto.randomUUID()}.png`));
  const owner = await saveOwnerPhoto(USER, { filename: "me.png", mimeType: "image/png", size: png.length, storageKey: await put(`private/${USER}/owners/${crypto.randomUUID()}.png`), quality: "clear" });
  const attachment = await saveRecordAttachment(USER, pet.id, { storageKey: await put(`private/${USER}/records/${crypto.randomUUID()}.png`), mimeType: "image/png" });
  return { pet, photo, owner, attachment };
}

const bearer = (userId: string) => new Request("http://localhost/api/pets", { headers: { authorization: `Bearer ${signSession(userId)}` } });

beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,display_name,created_at) VALUES ($1,'管理员',now()),($2,'小明',now())", [ADMIN, USER]);
  png = await sharp({ create: { width: 64, height: 48, channels: 3, background: "white" } }).png().toBuffer();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "upload-review-test-secret-with-32-characters"); // gitleaks:allow -- 测试夹具签名，不是部署凭据。
  vi.stubEnv("WECHAT_SESSION_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("图片审核队列", () => {
  it("四类上传都进待审核，通过后离开队列；换头像后新头像重新待审", async () => {
    const { pet, photo } = await seed();
    const pending = await listUploads({ status: "pending" });
    expect(pending.items.map((item) => item.kind).sort()).toEqual(["avatar", "owner", "photo", "record"]);
    expect(await pendingUploadCount()).toBe(4);

    await approveUploads(ADMIN, [{ kind: "photo", id: photo.id }, { kind: "avatar", id: pet.id }]);
    expect((await listUploads({ status: "pending" })).total).toBe(2);
    expect((await listUploads({ status: "approved" })).total).toBe(2);

    await updatePetAvatar(USER, pet.id, await put(`private/${USER}/avatars/${crypto.randomUUID()}.png`));
    expect((await listUploads({ status: "pending", kind: "avatar" })).total).toBe(1);
  });

  it("缩略图转成小 webp，原图按原格式给出", async () => {
    const { photo } = await seed();
    const thumb = await getUploadImage("photo", photo.id);
    expect(thumb.contentType).toBe("image/webp");
    expect((await getUploadImage("photo", photo.id, true)).contentType).toBe("image/png");
  });

  it("移除走正常删除链路，留下 removed 记录与审计；移除不存在的图片 404", async () => {
    const { pet, photo, attachment } = await seed();
    await removeUpload(ADMIN, { kind: "photo", id: photo.id, reason: "违规内容" });
    await removeUpload(ADMIN, { kind: "avatar", id: pet.id, reason: "违规内容" });
    await removeUpload(ADMIN, { kind: "record", id: attachment.id, reason: "违规内容" });
    const db = await getDatabase();
    expect((await db.query("SELECT deleted_at FROM photos WHERE id=$1", [photo.id]))[0].deleted_at).not.toBeNull();
    expect((await db.query("SELECT avatar_key FROM pets WHERE id=$1", [pet.id]))[0].avatar_key).toBeNull();
    expect(await db.query("SELECT 1 FROM pet_record_attachments WHERE id=$1", [attachment.id])).toHaveLength(0);
    const removed = await listUploads({ status: "removed" });
    expect(removed.total).toBe(3);
    expect(removed.items[0].reason).toBe("违规内容");
    expect(await db.query("SELECT 1 FROM audit_logs WHERE action='upload_remove'")).toHaveLength(3);
    await expect(removeUpload(ADMIN, { kind: "photo", id: photo.id, reason: "再删一次" })).rejects.toMatchObject({ status: 404 });
  });

  it("移除并封禁：账号不能再调接口，也不能重新微信登录；解封后恢复", async () => {
    const { owner } = await seed();
    await (await getDatabase()).query("UPDATE users SET wechat_openid='openid-banned' WHERE id=$1", [USER]);
    expect(await requireUserId(bearer(USER))).toBe(USER);

    await removeUpload(ADMIN, { kind: "owner", id: owner.id, reason: "上传违禁图片", suspend: true });
    await expect(requireUserId(bearer(USER))).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", status: 403 });
    expect(await getOptionalUserId(bearer(USER))).toBeNull();
    await expect(signInWechatUser({ openid: "openid-banned", session_key: "session-key-x" })).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", status: 403 });
    // 被封禁账号的剩余上传不再计入待审核角标
    expect(await pendingUploadCount()).toBe(0);

    await setUserSuspension(ADMIN, { action: "reactivate", userId: USER, reason: "申诉通过" });
    expect(await requireUserId(bearer(USER))).toBe(USER);
    expect(await signInWechatUser({ openid: "openid-banned", session_key: "session-key-y" })).toBe(USER);
  });

  it("不能封禁自己，也不能处理已注销的账号", async () => {
    await expect(setUserSuspension(ADMIN, { action: "suspend", userId: ADMIN, reason: "测试" })).rejects.toMatchObject({ code: "SELF_SUSPEND_FORBIDDEN" });
    await (await getDatabase()).query("UPDATE users SET deleted_at=now() WHERE id=$1", [USER]);
    await expect(setUserSuspension(ADMIN, { action: "suspend", userId: USER, reason: "测试" })).rejects.toMatchObject({ code: "DELETED_ACCOUNT_NOT_REACTIVATABLE" });
  });
});
