import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { deleteOwnerPhoto, getOwnerPhotoObject, listOwnerPhotos, saveOwnerPhoto } from "@/server/owner-photo-service";
import { objectStorage } from "@/server/storage";

const USER = "00000000-0000-4000-8000-000000000031";
const OTHER = "00000000-0000-4000-8000-000000000032";

describe("owner photo service", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now()),($2,now())", [USER, OTHER]);
  });

  it("主人照片独立登记授权、校验归属并可删除原始对象", async () => {
    const key = `private/${USER}/owner/portrait.png`;
    await objectStorage.put(key, new Uint8Array([1, 2, 3]), "image/png");
    const photo = await saveOwnerPhoto(USER, { filename: "portrait.png", mimeType: "image/png", size: 3, storageKey: key, quality: "clear" });
    expect(photo.authorizationConfirmedAt).toBeTruthy();
    expect(await listOwnerPhotos(USER)).toHaveLength(1);
    await expect(getOwnerPhotoObject(OTHER, photo.id)).rejects.toMatchObject({ code: "OWNER_PHOTO_NOT_FOUND" });
    expect((await getOwnerPhotoObject(USER, photo.id)).body).toHaveLength(3);
    await deleteOwnerPhoto(USER, photo.id);
    expect(await listOwnerPhotos(USER)).toHaveLength(0);
    expect(await objectStorage.get(key)).toBeNull();
  });
});
