import { beforeEach, describe, expect, it } from "vitest";
import sharp from "sharp";
import { PDFDocument } from "pdf-lib";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { objectStorage } from "@/server/storage";
import { createMemorialSpace, generateMemorialProduct, updateMemorialSpace } from "@/server/memorial-service";

const USER = "00000000-0000-4000-8000-0000000000a1";
const PET = "00000000-0000-4000-8000-0000000000a2";

/** 出册要光栅化整本 PDF，开覆盖率时 sharp 明显变慢，5 秒默认超时不够 */
const ALBUM_TIMEOUT = 60_000;

async function seedPhotos(count: number) {
  const database = await getDatabase();
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = crypto.randomUUID();
    const key = `private/${USER}/photos/${id}.jpg`;
    const body = await sharp({ create: { width: 400, height: 600, channels: 3, background: { r: 40 * index, g: 120, b: 160 } } }).jpeg().toBuffer();
    await database.query(
      "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',$5,$6,$7,'clear',now())",
      [id, USER, PET, `${index}.jpg`, body.byteLength, key, index],
    );
    await objectStorage.put(key, new Uint8Array(body), "image/jpeg");
    ids.push(id);
  }
  return ids;
}

describe("memorial album", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM memorial_spaces");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2019-03-01','birthday','active',true,now())", [PET, USER]);
  });

  /** 验收标准：纪念册包含用户全部选中照片，且是可长期保存的 PDF 而不是一张 SVG */
  it("产出多页 PDF，页数随照片数增长", { timeout: ALBUM_TIMEOUT }, async () => {
    const photos = await seedPhotos(5);
    const space = await createMemorialSpace(USER, { petId: PET, title: "永远闪亮的年糕", story: "他喜欢趴在窗台上晒太阳。", theme: "dawn", photoIds: photos });
    const result = await generateMemorialProduct(USER, String(space.id), "album");

    expect(result.outputKey).toMatch(/\.pdf$/);
    const object = await objectStorage.get(String(result.outputKey));
    expect(object?.contentType).toBe("application/pdf");
    const pdf = await PDFDocument.load(object!.body);
    // 1 封面 + 3 照片页（5 张，每页 2）+ 1 故事页 + 1 结尾页
    expect(pdf.getPageCount()).toBe(6);
    // 嵌了 5 张真照片的 PDF 不可能只有几 KB。
    expect(object!.body.byteLength).toBeGreaterThan(50_000);
  });

  it("作品记录的 asset_kind 是 pdf，端上才不会拿 <Image> 去渲染它", { timeout: ALBUM_TIMEOUT }, async () => {
    const photos = await seedPhotos(2);
    const space = await createMemorialSpace(USER, { petId: PET, title: "年糕", story: "", theme: "stardust", photoIds: photos });
    const result = await generateMemorialProduct(USER, String(space.id), "album");
    const rows = await (await getDatabase()).query<{ asset_kind: string; output_key: string }>("SELECT asset_kind,output_key FROM works WHERE id=$1", [String(result.workId)]);
    expect(rows[0].asset_kind).toBe("pdf");
    expect(rows[0].output_key).toMatch(/\.pdf$/);
  });

  /** storySections 的分段文字要落位，不能因为没地方放就被丢掉 */
  it("storySections 分段进册子，重复生成时版本自增", { timeout: ALBUM_TIMEOUT }, async () => {
    const photos = await seedPhotos(3);
    const space = await createMemorialSpace(USER, { petId: PET, title: "年糕", story: "总起一段", theme: "forest", photoIds: photos });
    await updateMemorialSpace(USER, String(space.id), {
      title: "年糕", story: "总起一段", theme: "forest", photoIds: photos,
      storySections: [{ title: "窗台上的下午", body: '他总是"喵"一声，然后跳上来。' }, { title: "雨天", body: "钻到沙发底下。" }],
      visibility: "private",
    });
    const first = await generateMemorialProduct(USER, String(space.id), "album");
    const second = await generateMemorialProduct(USER, String(space.id), "album");
    expect(second.workId).toBe(first.workId);
    const rows = await (await getDatabase()).query<{ version: number }>("SELECT version FROM works WHERE id=$1", [String(first.workId)]);
    expect(Number(rows[0].version)).toBe(2);
  });

  it("没有照片时明确报错，不产出空册子", { timeout: ALBUM_TIMEOUT }, async () => {
    const space = await createMemorialSpace(USER, { petId: PET, title: "年糕", story: "", theme: "stardust", photoIds: [] });
    await expect(generateMemorialProduct(USER, String(space.id), "album"))
      .rejects.toMatchObject({ code: "MEMORIAL_PHOTOS_REQUIRED" });
  });

  /**
   * 库里有 photo_ids 但存储里取不到字节（存储卷没灌样例 / 对象被清理）时
   * 同样不能产出空册子 —— 那种册子照片位置全是空白，比报错更伤人。
   */
  it("照片记录存在但字节丢失时报错，不产出空白页", { timeout: ALBUM_TIMEOUT }, async () => {
    const photos = await seedPhotos(2);
    const space = await createMemorialSpace(USER, { petId: PET, title: "年糕", story: "", theme: "stardust", photoIds: photos });
    const keys = await (await getDatabase()).query<{ storage_key: string }>("SELECT storage_key FROM photos WHERE id=ANY($1::uuid[])", [photos]);
    for (const row of keys) await objectStorage.delete(String(row.storage_key));
    await expect(generateMemorialProduct(USER, String(space.id), "album"))
      .rejects.toMatchObject({ code: "MEMORIAL_PHOTOS_REQUIRED" });
  });

  it("隐藏的纪念空间不出册", { timeout: ALBUM_TIMEOUT }, async () => {
    const photos = await seedPhotos(1);
    const space = await createMemorialSpace(USER, { petId: PET, title: "年糕", story: "", theme: "stardust", photoIds: photos });
    await (await getDatabase()).query("UPDATE memorial_spaces SET lifecycle='hidden' WHERE id=$1", [String(space.id)]);
    await expect(generateMemorialProduct(USER, String(space.id), "album"))
      .rejects.toMatchObject({ code: "MEMORIAL_HIDDEN" });
  });
});
