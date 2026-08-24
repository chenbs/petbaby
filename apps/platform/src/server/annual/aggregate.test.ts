import { beforeEach, describe, expect, it } from "vitest";

import { getDatabase, resetDatabaseForTest } from "@/server/db/client";
import { collectAnnualData, sampleEvenly } from "@/server/annual/aggregate";
import { daysSince } from "@/domain/companion";

const USER = "00000000-0000-4000-8000-0000000000c1";
const PET = "00000000-0000-4000-8000-0000000000c2";
const OTHER = "00000000-0000-4000-8000-0000000000c3";

async function addPhoto(options: { shotAt: string | null; createdAt: string; petId?: string }) {
  const database = await getDatabase();
  const id = crypto.randomUUID();
  await database.query(
    "INSERT INTO photos (id,user_id,pet_id,filename,mime_type,size,storage_key,position,quality,shot_at,created_at) VALUES ($1,$2,$3,$4,'image/jpeg',100,$5,0,'clear',$6,$7)",
    [id, USER, options.petId || PET, `${id}.jpg`, `private/${USER}/photos/${id}.jpg`, options.shotAt, options.createdAt],
  );
  return id;
}

describe("sampleEvenly", () => {
  /** 取前 N 张会让整条片子停在年初，「这一年」就只讲了一月份 */
  it("均匀抽样并保留首尾", () => {
    const items = Array.from({ length: 100 }, (_, index) => index);
    const picked = sampleEvenly(items, 5);
    expect(picked[0]).toBe(0);
    expect(picked.at(-1)).toBe(99);
    expect(picked).toHaveLength(5);
    // 间隔应大致均匀，不是前 5 个。
    expect(picked[1]).toBeGreaterThan(10);
  });

  it("数量不足上限时全取", () => {
    expect(sampleEvenly([1, 2, 3], 12)).toEqual([1, 2, 3]);
  });

  it("边界：limit 为 0 或 1", () => {
    expect(sampleEvenly([1, 2, 3], 0)).toEqual([]);
    expect(sampleEvenly([1, 2, 3], 1)).toEqual([1]);
    expect(sampleEvenly([], 5)).toEqual([]);
  });
});

describe("collectAnnualData", () => {
  beforeEach(async () => {
    await resetDatabaseForTest();
    const database = await getDatabase();
    await database.query("DELETE FROM memorial_spaces");
    await database.query("INSERT INTO users (id,created_at) VALUES ($1,now())", [USER]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'年糕','cat','unknown','2024-01-01','birthday','active',true,$3)", [PET, USER, new Date("2024-01-01T00:00:00Z")]);
    await database.query("INSERT INTO pets (id,user_id,name,species,gender,birthday,date_type,life_stage,is_default,created_at) VALUES ($1,$2,'汤圆','dog','unknown','2024-01-01','birthday','active',false,$3)", [OTHER, USER, new Date("2024-01-01T00:00:00Z")]);
  });

  /**
   * 主角只能有一只：多只宠物混在一条时间线上，「第 N 天」就没有意义
   * （各自起算日不同）。取当年照片最多的那只。
   */
  it("主角取当年照片最多的宠物", async () => {
    await addPhoto({ shotAt: "2025-03-01T10:00:00Z", createdAt: "2025-03-01T10:00:00Z", petId: OTHER });
    await addPhoto({ shotAt: "2025-04-01T10:00:00Z", createdAt: "2025-04-01T10:00:00Z", petId: OTHER });
    await addPhoto({ shotAt: "2025-05-01T10:00:00Z", createdAt: "2025-05-01T10:00:00Z", petId: OTHER });
    await addPhoto({ shotAt: "2025-06-01T10:00:00Z", createdAt: "2025-06-01T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.petName).toBe("汤圆");
    // 只取主角的照片，不混档
    expect(aggregate.photos).toHaveLength(3);
  });

  it("只取当年照片，往年的不进来", async () => {
    await addPhoto({ shotAt: "2024-06-01T10:00:00Z", createdAt: "2024-06-01T10:00:00Z" });
    await addPhoto({ shotAt: "2025-06-01T10:00:00Z", createdAt: "2025-06-01T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.photos).toHaveLength(1);
    expect(aggregate.photos[0].date.startsWith("2025")).toBe(true);
  });

  /** 每个数字都要能核对。计数按 created_at（当年行为），叙事日期按 shot_at（照片里的那天） */
  it("计数按当年新增，叙事日期按拍摄时间", async () => {
    await addPhoto({ shotAt: "2019-06-01T10:00:00Z", createdAt: "2025-06-01T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    // created_at 在 2025 → 计入当年照片数
    expect(aggregate.counts.photos).toBe(1);
    // 但叙事里的日期来自 shot_at，即照片里的那一天
    expect(aggregate.photos.map((item) => item.date)).toEqual([]);
    // shot_at 是 2019，所以不在 2025 的叙事段落里
    const older = await collectAnnualData(USER, 2019);
    expect(older.photos[0].date.startsWith("2019")).toBe(true);
  });

  it("超过 limit 时均匀抽样，首尾保留", async () => {
    for (let month = 1; month <= 12; month += 1) {
      const stamp = `2025-${String(month).padStart(2, "0")}-10T10:00:00Z`;
      await addPhoto({ shotAt: stamp, createdAt: stamp });
    }
    const aggregate = await collectAnnualData(USER, 2025, 4);
    expect(aggregate.photos).toHaveLength(4);
    expect(aggregate.photos[0].date.slice(5, 7)).toBe("01");
    expect(aggregate.photos.at(-1)?.date.slice(5, 7)).toBe("12");
  });

  /**
   * 陪伴天数按年末封口，不按今天。
   * 一条 2025 年度视频在 2026 年重看时天数不该跟着变大 ——
   * 那份视频讲的是 2025 年结束时的事实。
   */
  it("陪伴天数按年末封口，不算到今天", async () => {
    await addPhoto({ shotAt: "2025-06-01T10:00:00Z", createdAt: "2025-06-01T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.companionDays).toBe(daysSince("2024-01-01", new Date(2025, 11, 31).toISOString()));
    // 到今天（2026 年）的天数会更大，说明确实封口了。
    expect(aggregate.companionDays).toBeLessThan(daysSince("2024-01-01"));
  });

  it("已离开的宠物按离开日封口", async () => {
    const database = await getDatabase();
    await addPhoto({ shotAt: "2025-03-01T10:00:00Z", createdAt: "2025-03-01T10:00:00Z" });
    await database.query(
      "INSERT INTO memorial_spaces (id,user_id,pet_id,status,title,story,theme,photo_ids,visibility,lifecycle,created_at,updated_at) VALUES ($1,$2,$3,'private','年糕','','stardust','[]'::jsonb,'private','active',$4,$4)",
      [crypto.randomUUID(), USER, PET, new Date("2025-05-01T00:00:00Z")],
    );
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.memorialSince).toBeTruthy();
    expect(aggregate.companionDays).toBe(daysSince("2024-01-01", "2025-05-01T00:00:00Z"));
  });

  it("对比对取当年跨度最大的两张", async () => {
    await addPhoto({ shotAt: "2025-01-05T10:00:00Z", createdAt: "2025-01-05T10:00:00Z" });
    await addPhoto({ shotAt: "2025-07-05T10:00:00Z", createdAt: "2025-07-05T10:00:00Z" });
    await addPhoto({ shotAt: "2025-12-25T10:00:00Z", createdAt: "2025-12-25T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.pair?.earliest.date.slice(5, 7)).toBe("01");
    expect(aggregate.pair?.latest.date.slice(5, 7)).toBe("12");
    expect(aggregate.pair?.gapDays).toBe((aggregate.pair?.latest.day || 0) - (aggregate.pair?.earliest.day || 0));
  });

  it("只有一张照片时没有对比对", async () => {
    await addPhoto({ shotAt: "2025-06-01T10:00:00Z", createdAt: "2025-06-01T10:00:00Z" });
    expect((await collectAnnualData(USER, 2025)).pair).toBeUndefined();
  });

  it("完全没有宠物时返回零值，不抛异常", async () => {
    const database = await getDatabase();
    await database.query("UPDATE pets SET deleted_at=now() WHERE user_id=$1", [USER]);
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.petId).toBeUndefined();
    expect(aggregate.photos).toEqual([]);
    expect(aggregate.companionDays).toBe(0);
  });

  it("无 shot_at 的照片按上传时间归年，不排到 1970", async () => {
    await addPhoto({ shotAt: null, createdAt: "2025-08-08T10:00:00Z" });
    const aggregate = await collectAnnualData(USER, 2025);
    expect(aggregate.photos).toHaveLength(1);
    expect(aggregate.photos[0].dateSource).toBe("upload");
    expect(aggregate.photos[0].day).toBeGreaterThan(0);
  });
});
