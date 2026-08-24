import { beforeEach, describe, expect, it, vi } from "vitest";
import sharp from "sharp";

import { deleteAccount } from "@/server/account-service";
import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import {
  deletePetHumanIdentities,
  ensurePetHumanIdentity,
  findPetHumanIdentity,
} from "@/server/pet-human-identity-service";
import { deletePet, deletePhoto } from "@/server/platform-service";
import { objectStorage } from "@/server/storage";

const USER = "10000000-0000-4000-8000-000000000001";
const PET = "10000000-0000-4000-8000-000000000002";
const PHOTO = "10000000-0000-4000-8000-000000000003";

async function generatedPng() {
  return new Uint8Array(await sharp({
    create: { width: 32, height: 32, channels: 3, background: "#456789" },
  }).png().toBuffer());
}

async function seedIdentitySource() {
  const database = await getDatabase();
  await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
  await database.query(
    "INSERT INTO pets (id,user_id,name,species,gender,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'Milo','cat','unknown','birthday','active',true,now())",
    [PET, USER],
  );
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,'milo.png','image/png',1,$4,0,'clear',now())",
    [PHOTO, USER, PET, `private/${USER}/photos/milo.png`],
  );
}

async function createIdentity(generate = vi.fn(async () => ({
  body: await generatedPng(),
  provider: "test-provider",
  modelVersion: "test-model",
}))) {
  return ensurePetHumanIdentity({ userId: USER, petId: PET, sourcePhotoId: PHOTO, generate });
}

describe("pet human identity cache", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    await seedIdentitySource();
  });

  it("首次生成私有 PNG，后续同键复用且不再次调用供应商", async () => {
    const generate = vi.fn(async () => ({ body: await generatedPng(), provider: "test-provider", modelVersion: "test-model" }));
    const first = await createIdentity(generate);
    const second = await createIdentity(generate);

    expect(first.generated).toBe(true);
    expect(second.generated).toBe(false);
    expect(second.identity.id).toBe(first.identity.id);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(first.reference.contentType).toBe("image/png");
    expect(await sharp(Buffer.from(first.reference.body)).metadata()).toMatchObject({ width: 720, height: 1280, format: "png" });
  });

  it("失败记录可以重新抢占并生成成功", async () => {
    await expect(createIdentity(vi.fn(async () => { throw new Error("IDENTITY_PROVIDER_FAILED"); }))).rejects.toThrow("IDENTITY_PROVIDER_FAILED");
    expect((await findPetHumanIdentity(USER, PET, PHOTO))?.status).toBe("failed");

    const retried = await createIdentity();
    expect(retried.generated).toBe(true);
    expect(retried.identity.status).toBe("ready");
    expect(retried.identity.errorCode).toBeUndefined();
  });

  it("拒绝无筛选条件清理，避免删除全部身份缓存", async () => {
    await createIdentity();
    await expect(deletePetHumanIdentities({})).rejects.toThrow("PET_HUMAN_IDENTITY_DELETE_FILTER_REQUIRED");
    expect(await findPetHumanIdentity(USER, PET, PHOTO)).toBeDefined();
  });

  it.each([
    ["源照片", () => deletePhoto(USER, PHOTO)],
    ["宠物", () => deletePet(USER, PET)],
    ["账户", () => deleteAccount(USER)],
  ])("删除%s时同步清理身份记录和私有对象", async (_label, remove) => {
    const created = await createIdentity();
    const storageKey = created.identity.storageKey;
    expect(await objectStorage.get(storageKey)).not.toBeNull();

    await remove();

    expect(await findPetHumanIdentity(USER, PET, PHOTO)).toBeUndefined();
    expect(await objectStorage.get(storageKey)).toBeNull();
  });
});
