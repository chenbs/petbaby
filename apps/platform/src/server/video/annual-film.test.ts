import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { createAnnualFilm } from "@/server/video/annual-film";

const USER = "00000000-0000-4000-8000-0000000000d1";
const PET = "00000000-0000-4000-8000-0000000000d2";

async function addPhoto(shotAt: string) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',100,$5,0,'clear',$6,$6)",
    [id, USER, PET, `${id}.jpg`, `private/${USER}/photos/${id}.jpg`, shotAt],
  );
  return id;
}

describe("createAnnualFilm", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM video_renders");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2024-01-01T00:00:00Z")]);
  });

  it("入队一条渲染任务，config 带上年份与时长", async () => {
    await addPhoto("2025-03-01T10:00:00Z");
    await addPhoto("2025-09-01T10:00:00Z");
    const film = await createAnnualFilm(USER, { year: 2025, durationSeconds: 30 });
    expect(film.status).toBe("queued");
    expect(film.shots).toBe(2);
    expect(film.petName).toBe("年糕");

    const rows = await (await getDatabase()).query<{ config: unknown; status: string }>("SELECT config,status FROM video_renders WHERE id=$1", [film.id]);
    const config = typeof rows[0].config === "string" ? JSON.parse(rows[0].config) : rows[0].config as Record<string, unknown>;
    expect(config.kind).toBe("annual-film");
    expect(config.year).toBe(2025);
    expect(config.durationSeconds).toBe(30);
    expect(rows[0].status).toBe("queued");
  });

  it("不传时长时落到缺省 20 秒", async () => {
    await addPhoto("2025-03-01T10:00:00Z");
    const film = await createAnnualFilm(USER, { year: 2025 });
    expect(film.durationSeconds).toBe(20);
  });

  /**
   * 一张照片都没有时明确报错，不产出只有开场和数据卡的空片子 ——
   * 那种片子里唯一属于用户的东西就是几个数字。
   */
  it("当年没有照片时报错，不产出空片子", async () => {
    await addPhoto("2024-03-01T10:00:00Z");
    await expect(createAnnualFilm(USER, { year: 2025 }))
      .rejects.toMatchObject({ code: "ANNUAL_PHOTOS_REQUIRED", status: 422 });
  });

  it("年份不合法时拒绝", async () => {
    await addPhoto("2025-03-01T10:00:00Z");
    await expect(createAnnualFilm(USER, { year: 1899 })).rejects.toMatchObject({ code: "ANNUAL_YEAR_INVALID" });
    await expect(createAnnualFilm(USER, { year: 2.5 })).rejects.toMatchObject({ code: "ANNUAL_YEAR_INVALID" });
  });

  /** 叙事段落最多 12 张：四段结构还要为开场/对比/数据卡留时间 */
  it("照片很多时截到 12 张", async () => {
    for (let month = 1; month <= 12; month += 1) {
      await addPhoto(`2025-${String(month).padStart(2, "0")}-05T10:00:00Z`);
      await addPhoto(`2025-${String(month).padStart(2, "0")}-20T10:00:00Z`);
    }
    const film = await createAnnualFilm(USER, { year: 2025, durationSeconds: 30 });
    expect(film.shots).toBe(12);
  });
});
