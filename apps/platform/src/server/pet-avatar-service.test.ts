import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { PUT as setAvatar } from "@/app/api/pets/[id]/avatar/route";
import { signSession } from "@/server/auth/session";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { setPetAvatarFromPhoto } from "@/server/pet-avatar-service";
import { createPet, listPets } from "@/server/platform-service";
import { deletePhoto, savePhoto } from "@/server/photo-library-service";
import { objectStorage } from "@/server/storage";

// 仅提供 Next 请求上下文，保留真实签名校验与生产无匿名回退语义。
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
const USER = "00000000-0000-4000-8000-0000000000e1";
const OTHER = "00000000-0000-4000-8000-0000000000e2";
let png: Buffer;

function request(petId: string, body: unknown, userId = USER, contentType = "application/json") {
  return new Request(`http://localhost/api/pets/${petId}/avatar`, {
    method: "PUT",
    headers: { authorization: `Bearer ${signSession(userId)}`, "x-petbaby-client": "miniprogram", "content-type": contentType },
    body: JSON.stringify(body),
  });
}
const params = (id: string) => ({ params: Promise.resolve({ id }) });

async function photoOf(petId: string, userId = USER) {
  const storageKey = `private/${userId}/${crypto.randomUUID()}.png`;
  await objectStorage.put(storageKey, png, "image/png");
  return savePhoto(userId, { petId, filename: "pet.png", mimeType: "image/png", size: png.length, storageKey });
}

beforeEach(async () => {
  await resetDatabaseForTest();
  await (await getDatabase()).query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  png = await sharp({ create: { width: 40, height: 30, channels: 3, background: "white" } }).png().toBuffer();
  vi.stubEnv("NODE_ENV", "production");
  vi.stubEnv("SESSION_SECRET", "pet-avatar-route-test-secret-with-32-chars"); // gitleaks:allow -- 仅用于测试夹具签名，不是部署凭据。
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("用照片库里的照片设头像", () => {
  it("复制成独立的 512px webp 头像；换头像删旧头像对象，原照片不受影响", async () => {
    const pet = await createPet(USER, { name: "年糕", species: "cat" });
    const photo = await photoOf(pet.id);
    const response = await setAvatar(request(pet.id, { photoId: photo.id }), params(pet.id));
    expect(response.status).toBe(200);
    const saved = (await response.json()).data;
    expect(saved.id).toBe(pet.id);
    expect(saved.avatarKey).toMatch(new RegExp(`^private/${USER}/avatars/.+\\.webp$`));
    expect(saved.avatarKey).not.toBe(photo.storageKey);
    const stored = await objectStorage.get(saved.avatarKey);
    expect(stored?.contentType).toBe("image/webp");
    expect(await sharp(Buffer.from(stored!.body)).metadata()).toMatchObject({ width: 512, height: 512 });
    expect((await listPets(USER))[0].avatarUrl).toContain(encodeURIComponent(saved.avatarKey));

    const second = await photoOf(pet.id);
    const replaced = await setPetAvatarFromPhoto(USER, pet.id, second.id);
    expect(replaced.avatarKey).not.toBe(saved.avatarKey);
    expect(await objectStorage.get(saved.avatarKey)).toBeNull();
    expect(await objectStorage.get(photo.storageKey)).not.toBeNull();
  });

  it("别人的宠物、别的宠物的照片、已删除的照片一律 404，且不留下孤儿头像对象", async () => {
    const pet = await createPet(USER, { name: "年糕", species: "cat" });
    const sibling = await createPet(USER, { name: "汤圆", species: "dog" });
    const otherPet = await createPet(OTHER, { name: "乙的猫", species: "cat" });
    const photo = await photoOf(pet.id);
    const siblingPhoto = await photoOf(sibling.id);
    const otherPhoto = await photoOf(otherPet.id, OTHER);

    expect((await setAvatar(request(otherPet.id, { photoId: photo.id }), params(otherPet.id))).status).toBe(404);
    expect((await setAvatar(request(pet.id, { photoId: siblingPhoto.id }), params(pet.id))).status).toBe(404);
    expect((await setAvatar(request(pet.id, { photoId: otherPhoto.id }), params(pet.id))).status).toBe(404);
    await deletePhoto(USER, photo.id);
    expect((await setAvatar(request(pet.id, { photoId: photo.id }), params(pet.id))).status).toBe(404);

    expect((await listPets(USER)).every((item) => !item.avatarKey)).toBe(true);
    const avatars = await (await getDatabase()).query("SELECT avatar_key FROM pets WHERE avatar_key IS NOT NULL");
    expect(avatars).toHaveLength(0);
  });

  it("请求必须是 JSON 且 photoId 为 UUID；未登录拒绝", async () => {
    const pet = await createPet(USER, { name: "年糕", species: "cat" });
    expect((await setAvatar(request(pet.id, { photoId: "abc" }), params(pet.id))).status).toBe(422);
    expect((await setAvatar(request(pet.id, { photoId: crypto.randomUUID(), extra: 1 }), params(pet.id))).status).toBe(422);
    expect((await setAvatar(request(pet.id, { photoId: crypto.randomUUID() }, USER, "text/plain"), params(pet.id))).status).toBe(415);
    const anonymous = new Request(`http://localhost/api/pets/${pet.id}/avatar`, {
      method: "PUT", headers: { "x-petbaby-client": "miniprogram", "content-type": "application/json" }, body: JSON.stringify({ photoId: crypto.randomUUID() }),
    });
    expect((await setAvatar(anonymous, params(pet.id))).status).toBe(401);
  });
});
